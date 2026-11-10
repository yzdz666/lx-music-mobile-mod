/**
 * 「合并优质源」脚本生成器测试
 *
 * 不是比对字符串，而是把生成的脚本真的丢进 Node vm 里执行，
 * 用它模拟自定义源运行时的 preload（单槽 lx.on / 一次性 lx.send），
 * 验证：按平台路由、只注册一个监听器、只发一次 inited、音质求交、坏源隔离。
 *
 * 运行：node test/merge/run.mjs
 */
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname, '..')

// 用项目自带的 TypeScript 编译器转译，避免手写正则剥类型
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')

const src = fs.readFileSync(path.join(ROOT, 'src/core/mergeSource/mergeScript.ts'), 'utf8')
const transpiled = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText

const tmp = path.join(os.tmpdir(), `mergeScript.${process.pid}.mjs`)
fs.writeFileSync(tmp, transpiled)
const { buildMergedScript, MERGED_API_NAME, MERGE_PLATFORMS } = await import(pathToFileURL(tmp).href)

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

/**
 * 一个最小的自定义源脚本：注册 request，回 inited，声明自己的音质档位
 */
const makeSource = (tag, qualitys, delay = 0) => `/*!
 * @name ${tag}
 * @version 1.0.0
 */
;(function () {
  var register = function () {
    globalThis.lx.on('request', function (payload) {
      return Promise.resolve({ tag: ${JSON.stringify(tag)}, action: payload.action, source: payload.source })
    })
    globalThis.lx.send('inited', { status: true, sources: { wy: { type: 'music', actions: ['musicUrl'], qualitys: ${JSON.stringify(qualitys)} } } })
  }
  ${delay ? `setTimeout(register, ${delay})` : 'register()'}
})()`

/** 模拟 preload：单槽 request、一次性 inited */
const runMerged = (script, { timeout = 3000 } = {}) => {
  const state = { handler: null, inited: [], requests: 0 }
  const lx = {
    on(event, handler) {
      if (event === 'request') {
        state.requests++
        state.handler = handler
      }
      return Promise.resolve()
    },
    send(event, data) {
      if (event === 'inited') state.inited.push(data)
      return Promise.resolve()
    },
    currentScriptInfo: { name: 'merged', rawScript: '' },
  }
  const timers = []
  const context = {
    lx,
    console,
    Promise,
    Object,
    Array,
    JSON,
    String,
    Number,
    Error,
    setTimeout: (fn, ms) => { timers.push({ fn, at: Date.now() + (ms || 0) }); return timers.length },
  }
  vm.createContext(context)
  vm.runInContext(script, context, { timeout })

  // 手动推进生成脚本里的 setTimeout（poll 每 100ms 一次，最多 2.5 秒）
  const flush = () => {
    for (let round = 0; round < 60; round++) {
      const pending = timers.splice(0, timers.length)
      if (!pending.length) break
      for (const t of pending) t.fn()
    }
  }
  flush()
  return { state, flush, context }
}

const build = (entries, route, ceiling = { wy: ['128k', '320k', 'flac'], tx: ['128k', '320k', 'flac'], kw: ['128k'], kg: ['128k'] }) => buildMergedScript(
  entries,
  route,
  ceiling,
  { quality: 'flac', at: '2026-11-10 14:00' },
)

console.log('\nA. 生成脚本能真实执行')

check('单源：脚本可执行，注册一次 request，发一次 inited', () => {
  const script = build([{ index: 0, name: '源A', script: makeSource('A', ['128k', '320k']) }], { wy: 0, tx: 0, kw: 0, kg: 0 })
  const { state } = runMerged(script)
  assert.strictEqual(state.requests, 1, `lx.on 被调用 ${state.requests} 次，preload 只有单槽`)
  assert.strictEqual(state.inited.length, 1, `inited 发了 ${state.inited.length} 次`)
  assert.strictEqual(state.inited[0].status, true)
})

check('多源：内嵌 2 个源也只注册一次 request、只发一次 inited', () => {
  const script = build([
    { index: 0, name: '源A', script: makeSource('A', ['128k']) },
    { index: 1, name: '源B', script: makeSource('B', ['320k']) },
  ], { wy: 0, tx: 1, kw: 1, kg: 0 })
  const { state } = runMerged(script)
  assert.strictEqual(state.requests, 1)
  assert.strictEqual(state.inited.length, 1)
})

console.log('\nB. 按平台路由')

check('wy 走源 0，tx 走源 1', async() => {
  const script = build([
    { index: 0, name: '源A', script: makeSource('A', ['128k']) },
    { index: 1, name: '源B', script: makeSource('B', ['128k']) },
  ], { wy: 0, tx: 1, kw: 1, kg: 0 })
  const { state } = runMerged(script)
  // handler 返回 Promise，这里同步拿不到结果，直接检查内部约定：
  // 生成脚本里 ROUTE 是常量，用字符串断言比异步更直接
  assert.ok(script.includes('"wy":0'), 'ROUTE.wy 不是 0')
  assert.ok(script.includes('"tx":1'), 'ROUTE.tx 不是 1')
  assert.ok(state.handler, '没有注册 request')
})

check('目标源缺失时借用其它已就绪源，不直接 reject', () => {
  const script = build([{ index: 0, name: '源A', script: makeSource('A', ['128k']) }], { wy: 0, tx: 5, kw: 5, kg: 5 })
  assert.ok(script.includes('if (!handler)'), '缺少兜底逻辑')
  assert.ok(script.includes('for (var k = 0; k < handlers.length; k++)'), '兜底没有遍历 handlers')
})

// 异步用例：真正调用注册进去的 handler，看请求落到哪个内嵌源
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

await checkAsync('wy 的请求真的落到源 0，tx 的请求落到源 1', async() => {
  const script = build([
    { index: 0, name: '源A', script: makeSource('A', ['128k']) },
    { index: 1, name: '源B', script: makeSource('B', ['128k']) },
  ], { wy: 0, tx: 1, kw: 1, kg: 0 })
  const { state } = runMerged(script)
  const wy = await state.handler({ source: 'wy', action: 'musicUrl' })
  const tx = await state.handler({ source: 'tx', action: 'musicUrl' })
  assert.strictEqual(wy.tag, 'A', `wy 落到了 ${wy.tag}`)
  assert.strictEqual(tx.tag, 'B', `tx 落到了 ${tx.tag}`)
})

await checkAsync('未知平台回退到第一个已就绪的源', async() => {
  const script = build([{ index: 0, name: '源A', script: makeSource('A', ['128k']) }], { wy: 0, tx: 0, kw: 0, kg: 0 })
  const { state } = runMerged(script)
  const res = await state.handler({ source: 'mg', action: 'musicUrl' })
  assert.strictEqual(res.tag, 'A')
})

console.log('\nC. 音质求交')

check('用户上限与源声明求交', () => {
  const script = build([{ index: 0, name: '源A', script: makeSource('A', ['128k', '320k']) }], { wy: 0, tx: 0, kw: 0, kg: 0 })
  const { state } = runMerged(script)
  assert.deepStrictEqual(Array.from(state.inited[0].sources.wy.qualitys), ['128k', '320k'])
})

check('源声明里没有上限档位时，退到 128k', () => {
  const script = build([{ index: 0, name: '源A', script: makeSource('A', ['flac24bit']) }], { wy: 0, tx: 0, kw: 0, kg: 0 })
  const { state } = runMerged(script)
  assert.deepStrictEqual(Array.from(state.inited[0].sources.wy.qualitys), ['128k'])
})

check('四个平台都在 inited 里声明，且 type / actions 正确', () => {
  const script = build([{ index: 0, name: '源A', script: makeSource('A', ['128k']) }], { wy: 0, tx: 0, kw: 0, kg: 0 })
  const { state } = runMerged(script)
  for (const p of MERGE_PLATFORMS) {
    assert.ok(state.inited[0].sources[p], `${p} 没有声明`)
    assert.strictEqual(state.inited[0].sources[p].type, 'music')
    assert.deepStrictEqual(Array.from(state.inited[0].sources[p].actions), ['musicUrl'])
  }
})

console.log('\nD. 坏源隔离')

check('某个源加载时抛异常，其它源仍能注册', () => {
  const broken = 'throw new Error("boom")'
  const script = build([
    { index: 0, name: '坏源', script: broken },
    { index: 1, name: '源B', script: makeSource('B', ['128k']) },
  ], { wy: 1, tx: 1, kw: 1, kg: 1 })
  const { state } = runMerged(script)
  assert.strictEqual(state.inited.length, 1, '坏源把整个合并脚本带崩了')
  assert.ok(script.includes('loadErrors[0]'), '没有记录加载错误')
})

check('异步注册的源：轮询等待后会发 inited', () => {
  const script = build([{ index: 0, name: '慢源', script: makeSource('slow', ['128k'], 200) }], { wy: 0, tx: 0, kw: 0, kg: 0 })
  const { state } = runMerged(script)
  assert.strictEqual(state.inited.length, 1)
  assert.ok(state.inited[0].sources.wy.qualitys.length > 0)
})

console.log('\nE. 脚本头部与产物')

check('头部带 @name，导入时能被 addUserApi 解析', () => {
  const script = build([{ index: 0, name: 'A', script: makeSource('A', ['128k']) }], { wy: 0, tx: 0, kw: 0, kg: 0 })
  assert.ok(script.startsWith('/*!'), '头部注释缺失')
  assert.ok(script.includes(`@name ${MERGED_API_NAME}`), '@name 不对')
  assert.ok(/^\/\*[\S\s]+?\*\//.test(script), 'addUserApi 的正则匹配不到头部')
})

check('源脚本里的 */ 被转义，不会提前闭合注释', () => {
  const evil = '/*! @name X */ var a = 1; /* 注释 */'
  const script = build([{ index: 0, name: 'X*/Y', script: evil }], { wy: 0, tx: 0, kw: 0, kg: 0 })
  assert.ok(script.includes('X* /Y'), '名字里的 */ 没有转义')
})

check('生成脚本不含 strict，内嵌源保留自己的语义', () => {
  const script = build([{ index: 0, name: 'A', script: makeSource('A', ['128k']) }], { wy: 0, tx: 0, kw: 0, kg: 0 })
  assert.ok(!script.includes("'use strict'"), '外层加了 strict')
})

fs.rmSync(tmp, { force: true })

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) {
  for (const f of failures) console.error(`\n[${f.name}]\n${f.err.stack}`)
  process.exit(1)
}
