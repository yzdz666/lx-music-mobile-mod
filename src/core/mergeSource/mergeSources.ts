// 「合并优质源」扫描与生成
//
// 规则（与需求一致）：
//   1. 优质 = 在「设置-播放设置-优先播放的音质」所选档位取链成功（返回合法 http(s) URL）
//           且响应耗时 < 用户设定的阈值（500~3000ms，默认 1000ms）；高于所选档位的音质一律不请求、不声明。
//      每个平台只用它自己平台歌单里随机抽出的歌，绝不拿当前播放歌曲去测其它平台。
//   2. 按自定义源列表顺序逐个检查（当前正在用的源排第一）；每个源只测「还没拿下」的平台；
//      4 个平台全部拿下立即停止，后续源一概不测 —— 这是速度最优、请求数最少的顺序早停。
//   3. 把被选中的若干源整段内嵌，生成一个全新的单个 JS 并设为唯一音源；
//      不新增路由表设置项、不改原生层、不需要多个 QuickJS 实例。
import { setApiSource } from '@/core/apiSource'
import { getUserApiScript, addUserApi } from '@/utils/data'
import { state as userApiState, action as userApiAction } from '@/store/userApi'
import { removeUserApi } from '@/core/userApi'
import settingState from '@/store/setting/state'
import { getData as readStorage, saveData as writeStorage, removeData } from '@/plugins/storage'
import { buildMergedScript, MERGED_API_NAME, MERGE_PLATFORMS, type MergePlatform, type MergeRoute, type MergeScriptEntry } from './mergeScript'
import { prepareProbeSongs, type ProbePick } from './mergeProbeSongs'

export { MERGED_API_NAME, MERGE_PLATFORMS, type MergePlatform } from './mergeScript'

/** APK preload 白名单恰好就是这 4 档，且 player.playQuality 也只能取这 4 档 */
export const QUALITY_LADDER = ['128k', '320k', 'flac', 'flac24bit'] as const
/** 达标耗时阈值可选档位：500 起每 500 一档，最高 3000 */
export const SPEED_LIMIT_OPTIONS = [500, 1000, 1500, 2000, 2500, 3000] as const
export const DEFAULT_SPEED_LIMIT = 1000
export const getSpeedLimit = (): number => {
  const v = settingState.setting['player.mergeSpeedLimit']
  return SPEED_LIMIT_OPTIONS.includes(v as typeof SPEED_LIMIT_OPTIONS[number]) ? v : DEFAULT_SPEED_LIMIT
}
// 取链本身的网络超时上限：比阈值宽裕一些，避免阈值选 3000 时提前被掐断
const PROBE_TIMEOUT_MS = 6000
const INIT_TIMEOUT_MS = 8000
const MERGE_RESULT_KEY = '@merge_quality_sources_result_v1'

export const PLATFORM_LABELS: Record<MergePlatform, string> = {
  wy: '网易云',
  tx: 'QQ音乐',
  kw: '酷我',
  kg: '酷狗',
}

export interface MergeProgress {
  text: string
  done: number
  total: number
}

export interface MergeOutcome {
  platform: MergePlatform
  apiId: string
  apiName: string
  quality: string
  ms: number
  kind: 'hit' | 'fallback' | 'none'
  note?: string
}

export interface MergeResult {
  quality: string
  speedLimit: number
  at: string
  outcomes: MergeOutcome[]
  embedded: string[]
  mergedApiId: string
  originalApiId: string
  attempts: number
  /** 实际检查过的自定义源数量（早停会让它小于列表总数） */
  scannedSources: number
  /** 列表里参与排序的自定义源总数 */
  totalSources: number
  /** 达标（命中）的平台数 */
  hitCount: number
  /** 本轮每个平台使用的探测歌曲及来源 */
  probeSongs: Array<{ platform: MergePlatform, songName: string, from: 'board' | 'local', detail: string }>
  /** 由旧版本写入、缺少新字段的结果，UI 需降级展示（只读标记，不参与逻辑） */
  legacy?: boolean
}

export interface MergeOptions {
  onProgress?: (p: MergeProgress) => void
  isCancelled?: () => boolean
}

interface ProbeApi {
  getMusicUrl: (info: Record<string, unknown>, quality: LX.Quality) => {
    promise: Promise<{ type: LX.Quality, url: string }>
    canceleFn: () => void
  }
}

const sleep = async(ms: number): Promise<void> => {
  await new Promise<void>(resolve => { setTimeout(resolve, ms) })
}

const withTimeout = async<T>(p: Promise<T>, ms: number, label: string): Promise<T> => new Promise<T>((resolve, reject) => {
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    reject(new Error(`${label} timeout`))
  }, ms)
  p.then(val => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(val)
  }, err => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    reject(err)
  })
})

export class MergeCancelledError extends Error {
  constructor() {
    super('merge cancelled')
    this.name = 'MergeCancelledError'
  }
}

const getApis = (): Record<string, ProbeApi> => global.lx.apis as unknown as Record<string, ProbeApi>

/** 切到指定自定义源并等它 init 完成（切源会销毁/重建唯一的 QuickJS 实例） */
const switchTo = async(id: string): Promise<boolean> => {
  // 必须清空：init 失败时 handleStateChange 不会重设 apis，否则会拿上一个源的 handler 误判本源
  global.lx.apis = {}
  global.lx.qualityList = {}
  setApiSource(id)
  // setApiSource 里会重建 apiInitPromise，稍等一拍再取，避免读到上一轮的 promise
  await sleep(40)
  const ok = await withTimeout(global.lx.apiInitPromise[0], INIT_TIMEOUT_MS, 'init').catch(() => false)
  // 再给异步注册 handler 的源（以及 apiSourceUpdated 事件的 rAF）一点余量
  await sleep(180)
  return ok
}

const probePlatform = async(platform: MergePlatform, quality: LX.Quality, song: ProbePick): Promise<{ ok: boolean, ms: number, error?: string }> => {
  const api = getApis()[platform]
  if (!api?.getMusicUrl) return { ok: false, ms: 0, error: '该源未声明此平台' }
  const start = Date.now()
  try {
    const result = await withTimeout(
      api.getMusicUrl(song.info, quality).promise,
      PROBE_TIMEOUT_MS,
      'musicUrl',
    )
    const url = result?.url
    const ms = Date.now() - start
    if (typeof url !== 'string' || !/^https?:/.test(url)) return { ok: false, ms, error: '返回的链接非法' }
    return { ok: true, ms }
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err instanceof Error ? err.message : String(err) }
  }
}

const nameOf = (id: string) => userApiState.list.find(a => a.id === id)?.name ?? id

const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * 兼容旧版本落盘结果：v1.9.33 及更早版本没有 probeSongs / scannedSources / totalSources / hitCount。
 * 直接把旧对象交给 UI 渲染会触发 `result.probeSongs.map is not a function`，进而让整个音源设置页白屏。
 * 这里统一补齐默认值并做字段校验，无法识别的数据直接丢弃。
 */
export const normalizeMergeResult = (raw: unknown): MergeResult | null => {
  if (!isRecord(raw) || !Array.isArray(raw.outcomes)) return null
  const r = raw as Partial<MergeResult>
  const legacy = !Array.isArray(r.probeSongs) || typeof r.scannedSources !== 'number'
  const outcomes: MergeOutcome[] = r.outcomes!
    .filter(isRecord)
    .map(o => ({
      platform: (MERGE_PLATFORMS.includes(o.platform) ? o.platform : 'wy') as MergePlatform,
      apiId: String(o.apiId ?? ''),
      apiName: String(o.apiName ?? '未知音源'),
      quality: String(o.quality ?? '128k'),
      ms: Number(o.ms) || 0,
      kind: o.kind === 'hit' ? 'hit' : 'fallback',
      note: o.note,
    }))
  return {
    quality: String(r.quality ?? '128k'),
    speedLimit: Number(r.speedLimit) || DEFAULT_SPEED_LIMIT,
    at: String(r.at ?? ''),
    outcomes,
    embedded: Array.isArray(r.embedded) ? r.embedded.map(String) : [],
    mergedApiId: String(r.mergedApiId ?? ''),
    originalApiId: String(r.originalApiId ?? ''),
    attempts: Number(r.attempts) || 0,
    scannedSources: Number(r.scannedSources) || 0,
    totalSources: Number(r.totalSources) || 0,
    hitCount: Number(r.hitCount) || outcomes.filter(o => o.kind === 'hit').length,
    probeSongs: Array.isArray(r.probeSongs)
      ? r.probeSongs.filter(isRecord).map(s => ({
        platform: (MERGE_PLATFORMS.includes(s.platform) ? s.platform : 'wy') as MergePlatform,
        songName: String(s.songName ?? '未知歌曲'),
        from: s.from === 'board' ? 'board' : 'local',
        detail: String(s.detail ?? ''),
      }))
      : [],
    legacy,
  }
}

export const loadMergeResult = async(): Promise<MergeResult | null> => {
  try {
    return normalizeMergeResult(await readStorage<unknown>(MERGE_RESULT_KEY))
  } catch (err) {
    console.log('loadMergeResult failed:', err)
    return null
  }
}
export const saveMergeResult = async(result: MergeResult) => writeStorage(MERGE_RESULT_KEY, { ...result, legacy: false })
/** 清除落盘的合并结果（设置页渲染异常时的恢复手段） */
export const clearMergeResult = async() => removeData(MERGE_RESULT_KEY)

/**
 * 执行一次「合并优质源」。
 * 会临时把 common.apiSource 切到各个候选源（可能打断正在播放的歌），结束后切到新生成的合并源；
 * 出错或取消时还原到合并前的源。
 */
export const runMergeSources = async(options: MergeOptions = {}): Promise<MergeResult> => {
  const { onProgress, isCancelled } = options
  const speedLimit = getSpeedLimit()
  const activeId = settingState.setting['common.apiSource'] || ''
  // 重复合并时，当前源就是上一次生成的合并源（稍后会被删除），还原目标应追溯到真正的原始源
  const isActiveMerged = userApiState.list.find(a => a.id === activeId)?.name === MERGED_API_NAME
  const prevResult = isActiveMerged ? await loadMergeResult() : null
  const originalId = isActiveMerged && prevResult?.originalApiId && prevResult.originalApiId !== activeId
    ? prevResult.originalApiId
    : activeId
  const quality = (settingState.setting['player.playQuality'] || '128k') as LX.Quality
  const topIndex = QUALITY_LADDER.findIndex(q => q === quality)
  const ceiling = QUALITY_LADDER.slice(0, (topIndex < 0 ? QUALITY_LADDER.length - 1 : topIndex) + 1)

  const all = userApiState.list.filter(a => /^user_api/.test(a.id) && a.name !== MERGED_API_NAME)
  if (!all.length) throw new Error('没有可用的自定义源，请先导入音源')

  // 当前正在用的源排第一（默认场景就是安妮独家音源），其余按列表顺序
  const current = all.find(a => a.id === originalId)
  const candidates = current ? [current, ...all.filter(a => a.id !== current.id)] : all
  const fallback = candidates[0]

  const winners: Partial<Record<MergePlatform, MergeOutcome>> = {}
  let attempts = 0
  let done = 0
  let scannedSources = 0
  const report = (text: string) => onProgress?.({ text, done, total: MERGE_PLATFORMS.length })

  try {
    report('正在从各平台内置歌单随机抽取探测歌曲…')
    const songs = await prepareProbeSongs()

    for (const api of candidates) {
      const pending = MERGE_PLATFORMS.filter(p => !winners[p])
      if (!pending.length) break
      if (isCancelled?.()) throw new MergeCancelledError()

      report(`切换并检查：${api.name}（待定 ${pending.length} 个平台）`)
      const inited = await switchTo(api.id)
      if (isCancelled?.()) throw new MergeCancelledError()
      scannedSources++
      if (!inited) {
        report(`✘ ${api.name} 初始化失败，跳过`)
        continue
      }

      for (const platform of pending) {
        if (isCancelled?.()) throw new MergeCancelledError()
        const r = await probePlatform(platform, quality, songs[platform])
        attempts++
        report(`${api.name} · ${PLATFORM_LABELS[platform]} ${quality} → ${r.ok ? `${r.ms}ms` : `失败（${r.error ?? '未知'}）`}`)
        if (r.ok && r.ms < speedLimit) {
          winners[platform] = {
            platform,
            apiId: api.id,
            apiName: api.name,
            quality,
            ms: r.ms,
            kind: 'hit',
          }
          done++
          report(`✔ ${PLATFORM_LABELS[platform]} 采用 ${api.name}（${r.ms}ms）`)
        }
      }
    }

    if (isCancelled?.()) throw new MergeCancelledError()

    // 没有源达标的平台回退到列表首个源，保证 4 个平台都有解析能力，不劣化现状
    const outcomes: MergeOutcome[] = MERGE_PLATFORMS.map(platform => winners[platform] ?? {
      platform,
      apiId: fallback.id,
      apiName: fallback.name,
      quality,
      ms: 0,
      kind: 'fallback',
      note: '无源达标，回退',
    })

    // 去重：只内嵌真正被用到的源（通常 1~3 个），合并脚本更小、启动更快
    const usedIds: string[] = []
    for (const o of outcomes) if (!usedIds.includes(o.apiId)) usedIds.push(o.apiId)
    const indexOf = new Map(usedIds.map((id, i) => [id, i]))
    const entries: MergeScriptEntry[] = []
    for (const [i, id] of usedIds.entries()) {
      const script = await getUserApiScript(id)
      if (!script) throw new Error(`读取音源脚本失败：${nameOf(id)}`)
      entries.push({ index: i, name: nameOf(id), script })
    }

    const route: MergeRoute = {
      wy: indexOf.get(outcomes[0].apiId) ?? 0,
      tx: indexOf.get(outcomes[1].apiId) ?? 0,
      kw: indexOf.get(outcomes[2].apiId) ?? 0,
      kg: indexOf.get(outcomes[3].apiId) ?? 0,
    }
    const ceilings = {
      wy: [...ceiling], tx: [...ceiling], kw: [...ceiling], kg: [...ceiling],
    }
    // 用本机时间，避免 toISOString() 显示成 UTC（会比北京时间少 8 小时）
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    const script = buildMergedScript(entries, route, ceilings, { quality, at })

    report(`生成合并源（内嵌 ${entries.length} 个源）…`)
    const oldIds = userApiState.list.filter(a => a.name === MERGED_API_NAME).map(a => a.id)
    if (oldIds.length) await removeUserApi(oldIds)
    const info = await addUserApi(script)
    userApiAction.addUserApi(info)
    global.lx.apis = {}
    global.lx.qualityList = {}
    setApiSource(info.id)
    await sleep(40)
    await withTimeout(global.lx.apiInitPromise[0], INIT_TIMEOUT_MS, 'init').catch(() => false)

    const result: MergeResult = {
      quality,
      speedLimit,
      at,
      outcomes,
      embedded: usedIds.map(nameOf),
      mergedApiId: info.id,
      originalApiId: originalId,
      attempts,
      scannedSources,
      totalSources: candidates.length,
      hitCount: outcomes.filter(o => o.kind === 'hit').length,
      probeSongs: MERGE_PLATFORMS.map(platform => ({
        platform,
        songName: songs[platform].songName,
        from: songs[platform].from,
        detail: songs[platform].detail,
      })),
    }
    await saveMergeResult(result)
    report(`完成：检查 ${scannedSources}/${candidates.length} 个源，${result.hitCount}/4 个平台达标，共 ${attempts} 次探测`)
    return result
  } catch (err) {
    // 失败/取消都还原到合并前的音源
    try {
      if (originalId && originalId !== settingState.setting['common.apiSource']) setApiSource(originalId)
    } catch { /* ignore */ }
    throw err
  }
}

/** 回到合并前的音源（合并源本身保留在列表里，可随时切回） */
export const restoreBeforeMerge = async() => {
  const result = await loadMergeResult()
  if (!result?.originalApiId) return false
  setApiSource(result.originalApiId)
  return true
}
