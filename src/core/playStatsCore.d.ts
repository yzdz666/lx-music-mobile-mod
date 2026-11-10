export interface TrackerMusic {
  id?: string | number
  name?: string
  singer?: string
  source?: string
}

export interface TrackerSession {
  key: string
  name: string
  singer: string
  source: string
  accumMs: number
  settledMs: number
  counted: boolean
  playing: boolean
  startedAt: number
  maxPlayTime: number
  lastPosition: number
}

export interface FlushResult {
  /** 本次新增的秒数（不含之前已结算的部分） */
  sec: number
  /** 本次是否刚好凑满「一次有效播放」 */
  counted: boolean
  key: string
  name: string
  singer: string
  source: string
  /** 落账时刻（毫秒时间戳） */
  at: number
}

export interface Tracker {
  start: (music: TrackerMusic | null | undefined, maxPlayTime?: number) => boolean
  current: () => TrackerSession | null
  isPlaying: () => boolean
  play: () => boolean
  pause: () => boolean
  flush: () => FlushResult | null
  finish: () => FlushResult | null
  rewind: (position: number) => boolean
  elapsedSec: () => number
}

export declare const createTracker: (options?: {
  now?: () => number
  minSeconds?: number
  minRatio?: number
}) => Tracker
