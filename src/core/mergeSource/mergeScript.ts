// 「合并优质源」单文件生成器
//
// 目标：把多个自定义音源脚本合成 **一个** user_api 脚本，对外只注册一个 request handler、
// 只发送一次 inited，从而完全绕开「同一时刻只有一个 QuickJS 实例 / 一个 events.request 槽」的限制。
//
// 做法（已在 Node vm 里用 8 个真实内置源全部验证通过）：
//   1. 每个原脚本整段包进独立 IIFE，不做任何「按平台切片」（多数脚本是单体/混淆的，切不开）；
//   2. IIFE 的形参就叫 globalThis，实参是 Object.create(globalThis) 的隔离对象，
//      其上用 defineProperty 覆盖 lx 为 shim —— 于是脚本里的 globalThis.lx 自动指向 shim，
//      而 JSON/Date/Math/Promise 等裸标识符仍走真实全局作用域；
//   3. shim 的 on('request') 只把 handler 存进本地数组，send('inited') 只记录声明，
//      绝不触碰真实 preload 的单槽 events 与一次性 isInitedApi；
//   4. 外层注册唯一的真实 on('request')，按 platform → 源下标 分发；
//   5. 等所有内嵌脚本注册完成（部分混淆源是异步注册）后，只发一次合并后的 inited。
//
// 这样生成的脚本就是一个普通自定义源：单个 id、单份 QuickJS context、零原生改动、
// 不需要任何路由表设置项（合并脚本本身就是配置）。

export const MERGED_API_NAME = '合并优质源'
export const MERGE_PLATFORMS = ['wy', 'tx', 'kw', 'kg'] as const
export type MergePlatform = typeof MERGE_PLATFORMS[number]

export interface MergeScriptEntry {
  /** 内嵌源下标，对应 route 里的值 */
  index: number
  name: string
  script: string
}

export interface MergeRoute {
  wy: number
  tx: number
  kw: number
  kg: number
}

/** 取脚本开头的注释块，供依赖 currentScriptInfo.rawScript 解析头部注解的源使用 */
const pickHeader = (script: string): string => /^\/\*[\s\S]+?\*\//.exec(script)?.[0] ?? ''

export const buildMergedScript = (
  entries: MergeScriptEntry[],
  route: MergeRoute,
  qualityCeiling: Record<MergePlatform, string[]>,
  meta: { quality: string, at: string },
): string => {
  const out: string[] = []
  out.push(`/*!
 * @name ${MERGED_API_NAME}
 * @description 由「合并优质源」自动生成；按平台取用实测最优的自定义源，请勿手动编辑
 * @version ${meta.at}
 * @author LX
 */`)
  out.push('')
  out.push(';(function () {')
  out.push('  var REAL_LX = globalThis.lx')
  out.push(`  var ROUTE = ${JSON.stringify(route)}`)
  out.push(`  var CEILING = ${JSON.stringify(qualityCeiling)}`)
  out.push(`  var META = ${JSON.stringify(meta)}`)
  out.push('  var PLATFORMS = [\'wy\', \'tx\', \'kw\', \'kg\']')
  out.push('  var handlers = []')
  out.push('  var declared = []')
  out.push('  var loadErrors = []')
  out.push('  var SHIMS = []')
  out.push('  var sent = false')
  out.push('')
  out.push('  // 为单个内嵌源构造隔离环境：继承真实全局，但把 lx 换成可捕获 on/send 的 shim')
  out.push('  function makeShim(index, name, rawScript) {')
  out.push('    var fakeGlobal = Object.create(globalThis)')
  out.push('    var lxShim = Object.assign({}, REAL_LX)')
  out.push('    lxShim.on = function (eventName, handler) {')
  out.push('      if (eventName === \'request\') handlers[index] = handler')
  out.push('      return Promise.resolve()')
  out.push('    }')
  out.push('    lxShim.send = function (eventName, data) {')
  out.push('      if (eventName === \'inited\') declared[index] = data')
  out.push('      return Promise.resolve()')
  out.push('    }')
  out.push('    lxShim.currentScriptInfo = Object.assign({}, REAL_LX.currentScriptInfo, { name: name, rawScript: rawScript })')
  out.push('    Object.defineProperty(fakeGlobal, \'lx\', { value: lxShim, writable: true, configurable: true })')
  out.push('    return { fakeGlobal: fakeGlobal, lxShim: lxShim }')
  out.push('  }')
  out.push('')
  for (const entry of entries) {
    out.push(`  SHIMS[${entry.index}] = makeShim(${entry.index}, ${JSON.stringify(entry.name)}, ${JSON.stringify(pickHeader(entry.script))})`)
  }
  out.push('')
  for (const entry of entries) {
    out.push(`  // ===== ${entry.index}: ${entry.name.replace(/\*\//g, '* /')} =====`)
    out.push('  try {')
    out.push('    ;(function (globalThis) {')
    out.push(entry.script)
    out.push(`    }).call(SHIMS[${entry.index}].fakeGlobal, SHIMS[${entry.index}].fakeGlobal)`)
    out.push('  } catch (err) {')
    out.push(`    loadErrors[${entry.index}] = String((err && err.message) || err)`)
    out.push('  }')
  }
  out.push('')
  out.push('  // 唯一对外的请求入口：按歌曲所属平台路由到对应内嵌源的 handler')
  out.push('  Promise.resolve(REAL_LX.on(\'request\', function (payload) {')
  out.push('    var source = payload && payload.source')
  out.push('    var idx = ROUTE[source]')
  out.push('    var handler = idx == null ? null : handlers[idx]')
  out.push('    // 兜底：目标源尚未注册完时，借用其它已就绪的源，避免直接失败')
  out.push('    if (!handler) {')
  out.push('      for (var k = 0; k < handlers.length; k++) { if (handlers[k]) { idx = k; handler = handlers[k]; break } }')
  out.push('    }')
  out.push('    if (!handler) return Promise.reject(new Error(\'merged source: no handler for \' + source))')
  out.push('    var shim = SHIMS[idx] || SHIMS[0]')
  out.push('    return Promise.resolve(handler.call(shim ? shim.lxShim : REAL_LX, payload))')
  out.push('  })).catch(function () {})')
  out.push('')
  out.push('  // 只发送一次 inited；音质档位以用户所选档为上限，并与内嵌源自身声明求交')
  out.push('  function finish() {')
  out.push('    if (sent) return')
  out.push('    sent = true')
  out.push('    var sources = {}')
  out.push('    for (var i = 0; i < PLATFORMS.length; i++) {')
  out.push('      var p = PLATFORMS[i]')
  out.push('      var idx = ROUTE[p]')
  out.push('      if (idx == null) continue')
  out.push('      var ceiling = CEILING[p] || [\'128k\']')
  out.push('      var own = declared[idx] && declared[idx].sources && declared[idx].sources[p]')
  out.push('      var qs = own && Array.isArray(own.qualitys) && own.qualitys.length ? own.qualitys : ceiling')
  out.push('      var merged = ceiling.filter(function (q) { return qs.indexOf(q) > -1 })')
  out.push('      if (!merged.length) merged = [\'128k\']')
  out.push('      sources[p] = { type: \'music\', actions: [\'musicUrl\'], qualitys: merged }')
  out.push('    }')
  out.push('    Promise.resolve(REAL_LX.send(\'inited\', { status: true, sources: sources })).catch(function () {})')
  out.push('  }')
  out.push('')
  out.push('  // 部分源（如混淆的「独家音源」）会异步注册，轮询等待后再发 inited；最长 2.5 秒')
  out.push('  var waited = 0')
  out.push('  function poll() {')
  out.push('    var ready = true')
  out.push('    for (var i = 0; i < SHIMS.length; i++) {')
  out.push('      if (!handlers[i]) { ready = false; break }')
  out.push('    }')
  out.push('    if (ready || waited >= 2500) { finish(); return }')
  out.push('    waited += 100')
  out.push('    setTimeout(poll, 100)')
  out.push('  }')
  out.push('  // 外层不启用 strict：让每个内嵌脚本保留自己原本的严格/非严格语义')
  out.push('  poll()')
  out.push('})()')
  return out.join('\n')
}
