/**
 * 听歌统计 / 听歌报告
 *
 * 只统计「本机真的播出来了」的内容，全部落本地存储，不上传任何服务器。
 *
 * 记账规则（避免刷数据，也避免误记）：
 * - 一次有效播放 = 累计播放 ≥ 30 秒，或 ≥ 歌曲时长的 50%（短音频、试听片段都适用）；
 * - 时长按「实际处于播放状态的时间」累计，暂停、缓冲、拖动进度都不重复计；
 * - 单曲循环重播算新的一次；切歌时结账上一首。
 *
 * 存储按天聚合，避免把每次播放都存成一条记录（一年几万条会拖慢启动）：
 *   days[yyyy-mm-dd] = { sec, cnt, hours[24], songs: { key: 次数 } }
 *   catalog[key]     = { n: 歌名, s: 歌手, src: 音源 }
 */
import { getData, saveData } from '@/plugins/storage'
import playerState from '@/store/player/state'
import { createTracker } from './playStatsCore'

const STORAGE_KEY = 'playstats:v1'
const KEEP_DAYS = 400
const MIN_SECONDS = 30
const MIN_RATIO = 0.5

export type ReportRange = 'week' | 'month' | 'year' | 'all'

export interface DayStat {
  sec: number
  cnt: number
  hours: number[]
  songs: Record<string, number>
}

interface CatalogEntry {
  n: string
  s: string
  src: string
}

interface StatsData {
  v: number
  days: Record<string, DayStat>
  catalog: Record<string, CatalogEntry>
}

export interface PlayReport {
  range: ReportRange
  from: number
  totalSec: number
  totalPlays: number
  songCount: number
  artistCount: number
  topSongs: Array<{ key: string, name: string, singer: string, source: string, plays: number }>
  topArtists: Array<{ name: string, plays: number, songs: number }>
  sources: Array<{ source: string, plays: number }>
  hours: number[]
  streak: number
  daily: Array<{ date: string, sec: number, cnt: number }>
}

let data: StatsData | null = null
let loadPromise: Promise<StatsData> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null

/**
 * 记账内核放在 playStatsCore.js 里（纯逻辑、无平台依赖），这样可以脱离
 * React Native 直接用 node 跑回归测试。这里只负责「把增量写进按天聚合的存储」。
 */
const tracker = createTracker({ minSeconds: MIN_SECONDS, minRatio: MIN_RATIO })

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const emptyData = (): StatsData => ({ v: 1, days: {}, catalog: {} })

const load = async(): Promise<StatsData> => {
  if (data) return data
  if (!loadPromise) {
    loadPromise = (async() => {
      const raw = await getData<StatsData>(STORAGE_KEY).catch(() => null)
      if (!raw || typeof raw != 'object' || !raw.days) return emptyData()
      const days: Record<string, DayStat> = {}
      const limit = Date.now() - KEEP_DAYS * 86400 * 1000
      for (const [key, value] of Object.entries(raw.days)) {
        const time = new Date(`${key}T00:00:00`).getTime()
        if (!Number.isFinite(time) || time < limit) continue
        days[key] = {
          sec: Math.max(0, Number(value?.sec) || 0),
          cnt: Math.max(0, Number(value?.cnt) || 0),
          hours: Array.isArray(value?.hours) && value.hours.length == 24
            ? value.hours.map(n => Math.max(0, Number(n) || 0))
            : new Array(24).fill(0),
          songs: value?.songs && typeof value.songs == 'object' ? value.songs : {},
        }
      }
      return { v: 1, days, catalog: raw.catalog && typeof raw.catalog == 'object' ? raw.catalog : {} }
    })()
  }
  data = await loadPromise
  loadPromise = null
  return data
}

const scheduleSave = () => {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!data) return
    // 清理不再被任何一天引用过的歌曲元数据，避免 catalog 无限膨胀
    const used = new Set<string>()
    for (const day of Object.values(data.days)) {
      for (const key of Object.keys(day.songs)) used.add(key)
    }
    for (const key of Object.keys(data.catalog)) {
      if (!used.has(key)) delete data.catalog[key]
    }
    void saveData(STORAGE_KEY, data)
  }, 1200)
}

const ensureDay = (store: StatsData, key: string): DayStat => {
  let day = store.days[key]
  if (!day) {
    day = { sec: 0, cnt: 0, hours: new Array(24).fill(0), songs: {} }
    store.days[key] = day
  }
  return day
}

/**
 * 把「还没写进当天统计」的播放时长增量落账，并处理「这一次播放算不算数」。
 *
 * 不是只在切歌时结算：播放中每 5 秒也会走一次，否则一边放歌一边打开听歌
 * 报告永远是 0 秒（之前的实现就是这样）。会话本身不销毁，继续计时。
 */
const flushSession = async() => {
  const delta = tracker.flush()
  if (!delta) return
  const store = await load()
  const now = new Date(delta.at)
  const day = ensureDay(store, dayKey(now))
  day.sec += delta.sec
  if (delta.counted) {
    day.cnt++
    day.hours[now.getHours()]++
    day.songs[delta.key] = (day.songs[delta.key] || 0) + 1
    if (!store.catalog[delta.key]) {
      store.catalog[delta.key] = { n: delta.name, s: delta.singer, src: delta.source }
    }
  }
  scheduleSave()
}

/** 结束当前会话：先结算，再丢弃 */
const commit = async() => {
  const delta = tracker.finish()
  if (!delta) return
  const store = await load()
  const now = new Date(delta.at)
  const day = ensureDay(store, dayKey(now))
  day.sec += delta.sec
  if (delta.counted) {
    day.cnt++
    day.hours[now.getHours()]++
    day.songs[delta.key] = (day.songs[delta.key] || 0) + 1
    if (!store.catalog[delta.key]) {
      store.catalog[delta.key] = { n: delta.name, s: delta.singer, src: delta.source }
    }
  }
  scheduleSave()
}

interface SessionMusic {
  id?: string | number
  name?: string
  singer?: string
  source?: string
}

const startSession = (music: SessionMusic | null) => tracker.start(music, playerState.progress.maxPlayTime)

/**
 * 开始播放。
 *
 * 不能假设会话一定已经由切歌建好了：用户从冷启动直接点播放、或者播放被系统
 * 中断后恢复，都不会再走 musicToggled。这里按「当前曲目 key」校正，对不上
 * 就重建，否则整段播放一秒都不会记。
 */
const markPlaying = async() => {
  const music = playerState.playMusicInfo.musicInfo
  if (!music?.id) return
  const session = tracker.current()
  const key = `${(music as SessionMusic).source ?? ''}:${music.id}`
  if (session?.key != key) {
    await commit()
    if (!startSession(music)) return
  }
  tracker.play()
}

const markPaused = () => {
  if (!tracker.pause()) return
  void flushSession()
}

/** 播放位置更新：用于识别单曲循环回绕，不参与时长累计 */
const handlePosition = (position: number) => {
  // 从后段突然回到开头 = 单曲循环重播，把上一轮结账后重新开一轮
  if (!tracker.rewind(position)) return
  const music = playerState.playMusicInfo.musicInfo
  markPaused()
  void commit().then(() => {
    if (!startSession(music)) return
    // 重播不会再触发一次 playerPlaying，得自己把计时接上
    tracker.play()
  })
}

/**
 * 注册播放事件。
 *
 * 幂等：重复调用只生效一次，避免热重载时同一首歌被记两遍。
 */
let inited = false
export const initPlayStats = () => {
  if (inited) return
  inited = true

  // 冷启动后直接播放不会触发 musicToggled，先把当前曲目的会话建好
  if (playerState.playMusicInfo.musicInfo) {
    startSession(playerState.playMusicInfo.musicInfo)
    if (playerState.isPlay) tracker.play()
  }

  global.app_event.on('musicToggled', () => {
    markPaused()
    void commit().then(() => {
      startSession(playerState.playMusicInfo.musicInfo)
    })
  })
  global.app_event.on('playerPlaying', () => { void markPlaying() })
  global.app_event.on('playerPause', markPaused)
  global.app_event.on('stop', () => {
    markPaused()
    void commit()
  })
  global.app_event.on('error', () => {
    markPaused()
  })
  global.app_event.on('setProgress', handlePosition)

  // 播放中每 5 秒把增量落账，报告页随时打开都有数
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      if (tracker.isPlaying()) void flushSession()
    }, 5000)
  }
}

const rangeStart = (range: ReportRange) => {
  const now = Date.now()
  switch (range) {
    case 'week': return now - 7 * 86400 * 1000
    case 'month': return now - 30 * 86400 * 1000
    case 'year': return now - 365 * 86400 * 1000
    default: return 0
  }
}

/** 生成一份统计报告 */
export const getPlayReport = async(range: ReportRange = 'month'): Promise<PlayReport> => {
  // 把「正在播、还没落账」的那一段先算进去
  await flushSession()
  const store = await load()
  const from = rangeStart(range)
  const songPlays: Record<string, number> = {}
  const hours = new Array(24).fill(0)
  let totalSec = 0
  let totalPlays = 0
  const daily: Array<{ date: string, sec: number, cnt: number }> = []

  const keys = Object.keys(store.days).sort()
  for (const key of keys) {
    const day = store.days[key]
    const time = new Date(`${key}T00:00:00`).getTime()
    if (range != 'all' && time < from) continue
    totalSec += day.sec
    totalPlays += day.cnt
    for (let i = 0; i < 24; i++) hours[i] += day.hours[i] || 0
    for (const [id, count] of Object.entries(day.songs)) {
      songPlays[id] = (songPlays[id] || 0) + count
    }
    daily.push({ date: key, sec: day.sec, cnt: day.cnt })
  }

  const topSongs = Object.entries(songPlays)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, plays]) => {
      const info = store.catalog[key] ?? { n: key, s: '', src: '' }
      return { key, name: info.n, singer: info.s, source: info.src, plays }
    })

  const artistMap: Record<string, { plays: number, songs: Set<string> }> = {}
  const sourceMap: Record<string, number> = {}
  for (const [key, plays] of Object.entries(songPlays)) {
    const info = store.catalog[key]
    if (!info) continue
    const artists = String(info.s || '未知歌手').split(/[、/&,;]/).map(s => s.trim()).filter(Boolean)
    for (const artist of artists) {
      const entry = artistMap[artist] ??= { plays: 0, songs: new Set() }
      entry.plays += plays
      entry.songs.add(key)
    }
    const src = info.src || '未知'
    sourceMap[src] = (sourceMap[src] || 0) + plays
  }

  const topArtists = Object.entries(artistMap)
    .sort((a, b) => b[1].plays - a[1].plays)
    .slice(0, 10)
    .map(([name, entry]) => ({ name, plays: entry.plays, songs: entry.songs.size }))

  const sources = Object.entries(sourceMap)
    .sort((a, b) => b[1] - a[1])
    .map(([source, plays]) => ({ source, plays }))

  // 连续天数：从今天（或昨天，允许今天还没听）往前数
  let streak = 0
  const cursor = new Date()
  if (!store.days[dayKey(cursor)] || store.days[dayKey(cursor)].cnt == 0) cursor.setDate(cursor.getDate() - 1)
  for (let i = 0; i < 400; i++) {
    const key = dayKey(cursor)
    const day = store.days[key]
    if (!day || day.cnt == 0) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  // 近 30 天补齐空缺日期，画图时不会因为缺天而把线连错
  if (range == 'week' || range == 'month') {
    const days = range == 'week' ? 7 : 30
    const map = new Map(daily.map(item => [item.date, item]))
    const filled: typeof daily = []
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const key = dayKey(date)
      filled.push(map.get(key) ?? { date: key, sec: 0, cnt: 0 })
    }
    daily.length = 0
    daily.push(...filled)
  }

  return {
    range,
    from,
    totalSec,
    totalPlays,
    songCount: Object.keys(songPlays).length,
    artistCount: Object.keys(artistMap).length,
    topSongs,
    topArtists,
    sources,
    hours,
    streak,
    daily,
  }
}

/** 清空统计（设置页提供入口） */
export const clearPlayStats = async() => {
  data = { v: 1, days: {}, catalog: {} }
  tracker.finish()
  await saveData(STORAGE_KEY, data)
}

/** 有没有任何记录（决定是否显示入口徽标） */
export const hasPlayStats = async() => {
  const store = await load()
  return Object.keys(store.days).length > 0
}
