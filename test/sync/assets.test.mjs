/**
 * 云同步：自定义音源 / 主题资产的协议测试
 *
 * 起一个真的同步服务（独立数据目录、随机端口），用 HTTP 走完整链路：
 * 创建空间 → 推送音源与主题 → 另一台设备拉取 → 改脚本再推 → 校验 LWW。
 *
 * 运行：node test/sync/assets.test.mjs
 */
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname, '..')
const SERVER = path.join(ROOT, 'listen-together-server/index.js')
const PORT = 3900 + Math.floor(Math.random() * 80)
const BASE = `http://127.0.0.1:${PORT}`
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lts-assets-'))

let pass = 0
let fail = 0
const failures = []
const check = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, err })
    console.log(`  ✗ ${name}\n    ${err.message}`)
  }
}
const checkAsync = async(name, fn) => {
  try {
    await fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, err })
    console.log(`  ✗ ${name}\n    ${err.message}`)
  }
}

const post = async(pathname, body) => {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

const sleep = (ms) => new Promise(resolve => { setTimeout(resolve, ms) })

const waitHealthy = async() => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return true
    } catch {}
    await sleep(200)
  }
  return false
}

const child = spawn(process.execPath, [SERVER], {
  cwd: path.join(ROOT, 'listen-together-server'),
  env: { ...process.env, PORT: String(PORT), SYNC_DATA_DIR: DATA_DIR },
  stdio: 'ignore',
})

const cleanup = () => {
  try { child.kill('SIGKILL') } catch {}
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }) } catch {}
}

let code = ''
let secret = 'asset-secret-123456'

console.log('\nA. 服务可用')

await checkAsync('服务启动并能创建空间', async() => {
  assert.ok(await waitHealthy(), '同步服务没有起来')
  const r = await post('/api/sync/create', { deviceId: 'dev-A', deviceName: '测试设备', secret })
  assert.strictEqual(r.status, 200, r.text)
  code = r.json.code
  secret = r.json.secret || secret
  assert.ok(code && code.length >= 6, `同步码异常：${code}`)
})

const longScript = `/*!
 * @name 长脚本音源
 * @description 用来验证大文本不被截断
 * @version 2.1.0
 * @author tester
 */
${'// 填充注释，模拟真实混淆源\n'.repeat(2000)}globalThis.lx.on('request', function () {})`

const theme = {
  id: 'theme_a',
  name: '夜色',
  isDark: true,
  isCustom: true,
  config: { themeColors: { 'c-primary': '#ff3355', 'c-000': '#101010' } },
}

const now = Date.now()

console.log('\nB. 推送音源与主题')

await checkAsync('推送 userApi / theme 两类资产成功', async() => {
  const r = await post('/api/sync/push', {
    code, secret, deviceId: 'dev-A', deviceName: '手机',
    items: [
      { key: 'userApi:user_api_1', kind: 'userApi', id: 'user_api_1', name: '长脚本音源', data: { info: { name: '长脚本音源', version: '2.1.0' }, script: longScript }, updatedAt: now, deviceId: 'dev-A' },
      { key: 'theme:theme_a', kind: 'theme', id: 'theme_a', name: '夜色', data: { theme }, updatedAt: now, deviceId: 'dev-A' },
      { key: 'list:1', kind: 'list', id: '1', name: '歌单', data: { list: [{ id: 's1', name: '歌', singer: '手', source: 'tx' }] }, updatedAt: now, deviceId: 'dev-A' },
    ],
    settings: {},
  })
  assert.strictEqual(r.status, 200, r.text)
})

await checkAsync('拉取后脚本逐字节完整，没有被截断', async() => {
  const r = await post('/api/sync/pull', { code, secret })
  assert.strictEqual(r.status, 200)
  const item = r.json.items['userApi:user_api_1']
  assert.ok(item, '音源条目丢了')
  assert.strictEqual(item.kind, 'userApi')
  assert.strictEqual(item.data.script.length, longScript.length, `脚本长度 ${item.data.script.length} != ${longScript.length}`)
  assert.strictEqual(item.data.script, longScript)
})

await checkAsync('主题结构完整保留', async() => {
  const r = await post('/api/sync/pull', { code, secret })
  const item = r.json.items['theme:theme_a']
  assert.ok(item, '主题条目丢了')
  assert.strictEqual(item.kind, 'theme')
  assert.strictEqual(item.data.theme.config.themeColors['c-primary'], '#ff3355')
})

console.log('\nC. 第二台设备')

await checkAsync('新设备拉取后能拿到音源 + 主题 + 歌单', async() => {
  const r = await post('/api/sync/pull', { code, secret })
  const kinds = Object.values(r.json.items).map(i => i.kind).sort()
  assert.deepStrictEqual(kinds, ['list', 'theme', 'userApi'])
})

await checkAsync('新设备不推任何东西也不会把别人的资产删掉', async() => {
  const r = await post('/api/sync/push', {
    code, secret, deviceId: 'dev-B', deviceName: '电脑',
    items: [], settings: {},
  })
  assert.strictEqual(r.status, 200)
  const after = await post('/api/sync/pull', { code, secret })
  assert.ok(after.json.items['userApi:user_api_1'], '空推送把音源删了')
  assert.ok(after.json.items['theme:theme_a'], '空推送把主题删了')
})

console.log('\nD. 冲突与错误')

await checkAsync('后写的脚本覆盖先写的（LWW）', async() => {
  const newer = now + 60_000
  await post('/api/sync/push', {
    code, secret, deviceId: 'dev-B', deviceName: '电脑',
    items: [{ key: 'userApi:user_api_1', kind: 'userApi', id: 'user_api_1', name: '长脚本音源', data: { info: { name: '长脚本音源', version: '3.0.0' }, script: '/*! @name 新脚本 */' }, updatedAt: newer, deviceId: 'dev-B' }],
    settings: {},
  })
  const r = await post('/api/sync/pull', { code, secret })
  assert.strictEqual(r.json.items['userApi:user_api_1'].data.info.version, '3.0.0')
})

await checkAsync('旧时间戳的推送不会回滚内容', async() => {
  await post('/api/sync/push', {
    code, secret, deviceId: 'dev-A', deviceName: '手机',
    items: [{ key: 'userApi:user_api_1', kind: 'userApi', id: 'user_api_1', name: '旧', data: { script: 'old' }, updatedAt: now - 10_000, deviceId: 'dev-A' }],
    settings: {},
  })
  const r = await post('/api/sync/pull', { code, secret })
  assert.strictEqual(r.json.items['userApi:user_api_1'].data.info.version, '3.0.0', '旧推送把新脚本覆盖了')
})

await checkAsync('错误密钥被拒绝', async() => {
  const r = await post('/api/sync/pull', { code, secret: 'wrong-secret' })
  assert.notStrictEqual(r.status, 200)
})

await checkAsync('不存在的同步码返回错误而不是空数据', async() => {
  const r = await post('/api/sync/pull', { code: 'ZZZZZZZZ', secret })
  assert.notStrictEqual(r.status, 200)
})

cleanup()
console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) {
  for (const f of failures) console.error(`\n[${f.name}]\n${f.err.stack}`)
  process.exit(1)
}
