/**
 * 同步接口地址拼接回归测试
 *
 * 线上事故：默认地址自带 `?sharecode=xxx`，旧实现把 action 直接接在整串后面，
 * 拼成 `/api/sync?sharecode=xxx/create`。网关读到的 sharecode 变成
 * `xxx/create`，校验不过直接回 403（HTML），客户端只报「同步服务返回了非
 * JSON 内容（HTTP 403）」。
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(__dirname, '../..')

let pass = 0
let fail = 0
const failures = []

const check = async(name, fn) => {
  try {
    await fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    fail++
    failures.push(`${name}: ${err.message}`)
    console.log(`  ✗ ${name}\n      ${err.message}`)
  }
}

const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label ?? ''} 期望 ${expected}，实际 ${actual}`)
}

/**
 * 从真实源码里取出 buildUrl。
 *
 * 不复制一份实现来测 —— 那样改了源码测试还是绿的。这里按「顶格 } 结束」截取，
 * 模板字符串里的 ${} 不会干扰。
 */
const extractBuildUrl = () => {
  const file = path.join(repo, 'src/core/sync/cloudSync.ts')
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex(line => line.startsWith('const buildUrl = '))
  if (start === -1) throw new Error('没找到 buildUrl')
  let end = start
  while (end < lines.length && lines[end] !== '}') end++
  const body = lines.slice(start, end + 1).join('\n')
    .replace('const buildUrl = (base: string, action: string) =>', 'const buildUrl = (base, action) =>')
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn buildUrl`)()
}

const buildUrl = extractBuildUrl()
const parse = url => new URL(url)
const DEFAULT_BASE = 'https://af384ee6deb6e09e2.app.workbuddy.host/api/sync?sharecode=MKPWEVLBUS'

console.log('\nA. 路径与查询串')
await check('默认地址（自带 sharecode）：action 落在 path 末尾', () => {
  const u = parse(buildUrl(DEFAULT_BASE, 'create'))
  eq(u.pathname, '/api/sync/create', 'pathname')
  eq(u.searchParams.get('sharecode'), 'MKPWEVLBUS', 'sharecode')
  if (!u.searchParams.get('_')) throw new Error('缺少防缓存参数 _')
})

await check('默认地址：sharecode 后面不会粘上 /create', () => {
  const u = parse(buildUrl(DEFAULT_BASE, 'pull'))
  if (u.searchParams.get('sharecode').includes('/')) throw new Error('sharecode 被污染')
})

await check('带尾斜杠的基地址', () => {
  const u = parse(buildUrl('https://h/api/sync/?sharecode=ABC', 'push'))
  eq(u.pathname, '/api/sync/push', 'pathname')
  eq(u.searchParams.get('sharecode'), 'ABC', 'sharecode')
})

await check('不带查询串的基地址', () => {
  const u = parse(buildUrl('https://h/api/sync', 'info'))
  eq(u.pathname, '/api/sync/info', 'pathname')
  eq(u.searchParams.get('sharecode'), null, '不该凭空多出 sharecode')
})

await check('多个查询参数原样保留', () => {
  const u = parse(buildUrl('https://h/api/sync?sharecode=ABC&region=cn', 'create'))
  eq(u.pathname, '/api/sync/create', 'pathname')
  eq(u.searchParams.get('sharecode'), 'ABC', 'sharecode')
  eq(u.searchParams.get('region'), 'cn', 'region')
})

await check('带 hash 的基地址（hash 不参与请求）', () => {
  const u = parse(buildUrl('https://h/api/sync?sharecode=ABC#frag', 'pull'))
  eq(u.pathname, '/api/sync/pull', 'pathname')
  eq(u.hash, '', 'hash')
})

await check('两个 action 之间互不影响（无状态）', () => {
  const a = parse(buildUrl(DEFAULT_BASE, 'create')).pathname
  const b = parse(buildUrl(DEFAULT_BASE, 'push')).pathname
  eq(a, '/api/sync/create', 'create')
  eq(b, '/api/sync/push', 'push')
})

console.log('\nB. 电脑版 buildUrl 与手机版行为一致')
await check('同一个基地址、同一个 action，两端输出完全相同', () => {
  const file = path.join(repo, '../lx-music-desktop-mod/src/renderer/core/mod/cloudSync.js')
  if (!fs.existsSync(file)) {
    console.log('      （跳过：同级目录没有电脑版仓库）')
    return
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex(line => line.startsWith('const buildUrl = '))
  if (start === -1) throw new Error('电脑版没找到 buildUrl')
  let end = start
  while (end < lines.length && lines[end] !== '}') end++
  const body = lines.slice(start, end + 1).join('\n')
  // eslint-disable-next-line no-new-func
  const desktopBuildUrl = new Function(`${body}\nreturn buildUrl`)()

  const bases = [
    DEFAULT_BASE,
    'https://h/api/sync/?sharecode=ABC',
    'https://h/api/sync',
    'https://h/api/sync?sharecode=ABC&region=cn',
  ]
  for (const base of bases) {
    const a = parse(buildUrl(base, 'push'))
    const b = parse(desktopBuildUrl(base, 'push'))
    eq(b.pathname, a.pathname, `pathname（${base}）`)
    eq(b.searchParams.get('sharecode'), a.searchParams.get('sharecode'), `sharecode（${base}）`)
    eq(b.searchParams.get('region'), a.searchParams.get('region'), `region（${base}）`)
  }
})

console.log('\nC. 假网关：sharecode 必须原样到达')
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://placeholder')
  if (u.searchParams.get('sharecode') !== 'MKPWEVLBUS') {
    res.writeHead(403, { 'content-type': 'text/html' })
    res.end('<html><body>403 Forbidden</body></html>')
    return
  }
  if (!/^\/api\/sync\/(create|push|pull|info)$/.test(u.pathname)) {
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end('<html><body>404</body></html>')
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: true, action: u.pathname.split('/').pop() }))
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}/api/sync?sharecode=MKPWEVLBUS`

await check('新实现：create 返回 200 + JSON', async() => {
  const res = await fetch(buildUrl(base, 'create'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  eq(res.status, 200, 'status')
  const data = await res.json()
  eq(data.action, 'create', 'action')
})

await check('新实现：四个接口都能正常路由', async() => {
  for (const action of ['create', 'push', 'pull', 'info']) {
    const res = await fetch(buildUrl(base, action), { method: 'POST', body: '{}' })
    eq(res.status, 200, `${action} status`)
  }
})

await check('旧实现（action 接在整串后面）会被网关 403 —— 证明这条用例抓得住', async() => {
  const broken = `${base}/${'create'}?_=${Date.now()}`
  const res = await fetch(broken, { method: 'POST', body: '{}' })
  eq(res.status, 403, 'status')
})

server.close()

console.log(`\n${fail === 0 ? '全部' : ''} ${pass} 个用例通过${fail ? `，${fail} 个失败` : ''}`)
if (fail) {
  console.log(failures.map(f => ` - ${f}`).join('\n'))
  process.exit(1)
}
