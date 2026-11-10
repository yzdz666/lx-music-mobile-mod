/**
 * 三端同步回归测试
 *
 * 直接对着服务端存储层（sync-store.js）跑合并逻辑，再用一次真实 HTTP 请求
 * 验证路由与鉴权，避免「逻辑对但接口挂错」。
 *
 * 覆盖：
 * - LWW：时间戳大的赢、相同时间戳按 deviceId 决胜；
 * - 墓碑：删除后别的设备拉不到旧数据，也不会把旧数据推回去；
 * - 幂等：同一份数据重复推送 rev 不增长；
 * - 鉴权：错码错密钥一律 401，且不泄露空间是否存在；
 * - 容量：超过 8MB 拒绝写入。
 *
 * 运行：node test/sync/run.mjs
 */
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(new URL('..', import.meta.url).pathname, '..')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lxmod-sync-test-'))
process.env.SYNC_DATA_DIR = dataDir
const store = require(path.join(ROOT, 'listen-together-server/sync-store.js'))

let passed = 0
let failed = 0
const failures = []
let currentGroup = ''

const group = (name) => {
  currentGroup = name
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

const check = async(label, fn) => {
  try {
    await fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  } catch (err) {
    failed++
    failures.push({ group: currentGroup, label, error: err })
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    console.log(`    ${String(err.message).split('\n').join('\n    ')}`)
  }
}

const listItem = (id, name, songs, updatedAt, deviceId, deleted = false) => ({
  key: `list:${id}`,
  kind: 'list',
  id,
  name,
  data: { list: songs.map(song => ({ id: song, name: `歌 ${song}`, singer: '测试' })) },
  updatedAt,
  deviceId,
  deleted,
})

const settingEntry = (value, updatedAt, deviceId) => ({ value, updatedAt, deviceId })

// ---------------------------------------------------------------------------
group('A. 合并规则')

const space = store.createSpace({ deviceId: 'dev-a', deviceName: 'Pixel' })

await check('新空间初始 rev=0、无条目', () => {
  const info = store.statSpace(space.code, space.secret)
  assert.strictEqual(info.rev, 0)
  assert.strictEqual(info.lists, 0)
  assert.strictEqual(info.songs, 0)
})

await check('首次推送写入全部条目', async() => {
  const result = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-a',
    items: [
      listItem('default', '试听列表', ['a1', 'a2'], 1000, 'dev-a'),
      listItem('love', '我的收藏', ['b1'], 1000, 'dev-a'),
      listItem('user1', '我喜欢的', ['c1', 'c2', 'c3'], 1000, 'dev-a'),
    ],
    settings: { 'theme.id': settingEntry('green', 1000, 'dev-a') },
  })
  assert.strictEqual(result.applied, 4)
  assert.strictEqual(result.rev, 1)
  assert.strictEqual(Object.keys(result.items).length, 3)
})

await check('更新的时间戳覆盖旧值', async() => {
  const result = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-b',
    items: [listItem('user1', '我喜欢的', ['c1', 'c2', 'c3', 'c4'], 2000, 'dev-b')],
  })
  assert.strictEqual(result.applied, 1)
  assert.strictEqual(result.items['list:user1'].data.list.length, 4)
})

await check('较旧的时间戳被拒绝，不覆盖新值', async() => {
  const result = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-a',
    items: [listItem('user1', '我喜欢的', [], 1500, 'dev-a')],
  })
  assert.strictEqual(result.applied, 0)
  assert.strictEqual(result.skipped, 1)
  assert.strictEqual(result.items['list:user1'].data.list.length, 4)
})

await check('时间戳相同时按 deviceId 字典序决胜，结果稳定', async() => {
  const first = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-c',
    items: [listItem('user1', '我喜欢的', ['c1', 'c2', 'c3', 'c4', 'c5'], 2000, 'dev-d')],
  })
  // 当前条目属于 dev-b，dev-d > dev-b，应该被接受
  assert.strictEqual(first.applied, 1)
  const second = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-a',
    items: [listItem('user1', '我喜欢的', ['z'], 2000, 'dev-a')],
  })
  // 反过来推同一时间戳、更小的 deviceId，必须被拒
  assert.strictEqual(second.applied, 0)
  assert.strictEqual(second.items['list:user1'].data.list.length, 5)
})

await check('设置项按 key 独立合并，互不影响', async() => {
  const result = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-b',
    settings: {
      'theme.id': settingEntry('blue', 3000, 'dev-b'),
      'player.togglePlayMethod': settingEntry('random', 3000, 'dev-b'),
    },
  })
  assert.strictEqual(result.applied, 2)
  assert.strictEqual(result.settings['theme.id'].value, 'blue')
  assert.strictEqual(result.settings['player.togglePlayMethod'].value, 'random')
})

// ---------------------------------------------------------------------------
group('B. 删除与墓碑')

await check('删除写入墓碑，列表计数下降但条目仍在', async() => {
  const result = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-b',
    items: [listItem('user1', '我喜欢的', [], 4000, 'dev-b', true)],
  })
  assert.strictEqual(result.items['list:user1'].deleted, true)
  const info = store.statSpace(space.code, space.secret)
  assert.strictEqual(info.lists, 2)
})

await check('另一台设备用旧数据推回墓碑会被拒绝', async() => {
  const result = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-a',
    items: [listItem('user1', '我喜欢的', ['c1', 'c2'], 3000, 'dev-a')],
  })
  assert.strictEqual(result.applied, 0)
  assert.strictEqual(result.items['list:user1'].deleted, true)
})

await check('墓碑可以靠更新的时间戳「复活」', async() => {
  const result = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-a',
    items: [listItem('user1', '重新建的我喜欢', ['n1'], 5000, 'dev-a')],
  })
  assert.strictEqual(result.applied, 1)
  assert.strictEqual(result.items['list:user1'].deleted, false)
  assert.strictEqual(result.items['list:user1'].name, '重新建的我喜欢')
})

// ---------------------------------------------------------------------------
group('C. 幂等与鉴权')

await check('同一份数据重复推送，rev 不再增长', async() => {
  const payload = {
    deviceId: 'dev-a',
    items: [listItem('user1', '重新建的我喜欢', ['n1'], 5000, 'dev-a')],
    settings: { 'theme.id': settingEntry('blue', 3000, 'dev-b') },
  }
  const before = store.pullSpace(space.code, space.secret).rev
  await store.pushSpace(space.code, space.secret, payload)
  const after = store.pullSpace(space.code, space.secret).rev
  assert.strictEqual(after, before)
})

await check('错误密钥返回 401，且与「空间不存在」表现一致', () => {
  assert.throws(() => store.pullSpace(space.code, 'wrong-secret'), /auth_failed/)
  assert.throws(() => store.pullSpace('ZZZZZZZZ', 'whatever-secret'), /auth_failed/)
})

await check('非法同步码被拒绝', () => {
  assert.throws(() => store.pullSpace('abc', space.secret), /auth_failed/)
  assert.throws(() => store.pushSpace('bad code', space.secret, { items: [] }), /auth_failed/)
})

await check('创建时指定已存在的同步码报冲突', () => {
  assert.throws(() => store.createSpace({ code: space.code, secret: 'another-secret' }), /code_exists/)
})

await check('自定义同步码与密钥可直接创建', () => {
  const custom = store.createSpace({ code: 'MYSYNC99', secret: 'my-strong-secret' })
  assert.strictEqual(custom.code, 'MYSYNC99')
  assert.strictEqual(custom.secret, 'my-strong-secret')
  assert.strictEqual(store.pullSpace('MYSYNC99', 'my-strong-secret').rev, 0)
})

// ---------------------------------------------------------------------------
group('D. 容量与边界')

await check('超过 8MB 的同步空间被拒绝', async() => {
  const big = 'x'.repeat(1024 * 1024)
  const items = []
  for (let i = 0; i < 10; i++) {
    items.push({
      key: `list:big${i}`,
      kind: 'list',
      id: `big${i}`,
      name: `大列表${i}`,
      data: { list: [{ id: 's', name: big, singer: big }] },
      updatedAt: Date.now(),
      deviceId: 'dev-big',
    })
  }
  await assert.rejects(
    store.pushSpace(space.code, space.secret, { deviceId: 'dev-big', items }),
    /space_too_large/,
  )
})

await check('缺少 updatedAt 的条目被丢弃而不是写入 0', async() => {
  const result = await store.pushSpace(space.code, space.secret, {
    deviceId: 'dev-a',
    items: [{ key: 'list:bad', kind: 'list', id: 'bad', data: { list: [] } }],
  })
  assert.strictEqual(result.skipped, 1)
  assert.ok(!result.items['list:bad'])
})

await check('空间数据落盘，重启后仍可读取', () => {
  const file = path.join(dataDir, `${space.code}.json`)
  assert.ok(fs.existsSync(file), '没有生成数据文件')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.strictEqual(raw.code, space.code)
  assert.ok(!JSON.stringify(raw).includes(space.secret), '明文密钥被写进了磁盘')
})

// ---------------------------------------------------------------------------
group('E. HTTP 接口冒烟')

const { startServer } = await (async() => {
  // 复用真实服务端，只把端口与数据目录换成测试用的
  const serverPath = path.join(ROOT, 'listen-together-server/index.js')
  const { spawn } = await import('node:child_process')
  const port = 39300 + Math.floor(Math.random() * 200)
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), SYNC_DATA_DIR: dataDir, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const waitReady = async() => {
    for (let i = 0; i < 60; i++) {
      const ok = await new Promise(resolve => {
        const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 500 }, res => {
          res.resume()
          resolve(res.statusCode === 200)
        })
        req.on('error', () => resolve(false))
        req.on('timeout', () => { req.destroy(); resolve(false) })
      })
      if (ok) return true
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return false
  }
  const ready = await waitReady()
  return { startServer: { child, port, ready } }
})()

const { child, port, ready } = startServer

const api = async(pathname, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}

await check('服务端启动并暴露同步能力', async() => {
  assert.ok(ready, '服务端没有在 6 秒内就绪')
  const res = await fetch(`http://127.0.0.1:${port}/api/info`)
  const data = await res.json()
  assert.strictEqual(data.ok, true)
  assert.deepStrictEqual(data.sync.endpoints, ['create', 'push', 'pull', 'info'])
})

await check('通过 HTTP 创建空间 → 推送 → 拉取', async() => {
  const created = await api('/api/sync/create', { deviceId: 'http-a', deviceName: 'Phone' })
  assert.strictEqual(created.status, 200)
  assert.ok(created.data.code)

  const pushed = await api('/api/sync/push', {
    code: created.data.code,
    secret: created.data.secret,
    deviceId: 'http-a',
    items: [listItem('h1', 'HTTP 列表', ['x1', 'x2'], Date.now(), 'http-a')],
  })
  assert.strictEqual(pushed.status, 200)
  assert.strictEqual(pushed.data.applied, 1)

  const pulled = await api('/api/sync/pull', { code: created.data.code, secret: created.data.secret })
  assert.strictEqual(pulled.status, 200)
  assert.strictEqual(pulled.data.items['list:h1'].data.list.length, 2)
})

await check('HTTP 层错误密钥返回 401 且响应体不泄露细节', async() => {
  const res = await api('/api/sync/pull', { code: space.code, secret: 'nope' })
  assert.strictEqual(res.status, 401)
  assert.deepStrictEqual(res.data, { ok: false, error: 'auth_failed' })
})

await check('GET 访问同步接口返回 405', async() => {
  const res = await fetch(`http://127.0.0.1:${port}/api/sync/pull`)
  assert.strictEqual(res.status, 405)
})

child.kill('SIGTERM')
fs.rmSync(dataDir, { recursive: true, force: true })

// ---------------------------------------------------------------------------
console.log('')
if (failed > 0) {
  console.log(`\x1b[31m${failed} 个用例失败\x1b[0m，${passed} 个通过\n`)
  for (const item of failures) {
    console.log(`\x1b[31m[${item.group}] ${item.label}\x1b[0m`)
    console.log(item.error.stack?.split('\n').slice(0, 4).join('\n'))
    console.log('')
  }
  process.exitCode = 1
} else {
  console.log(`\x1b[32m全部 ${passed} 个用例通过\x1b[0m\n`)
}
