export interface LyricLineParts {
  times: number[]
  text: string
}

export interface SanitizeLyricOptions {
  /** 是否删除开头连续的制作名单，默认 true */
  stripMeta?: boolean
  /** 是否合并时间相邻的重复行，默认 true */
  dedupe?: boolean
  /** 重复行的判定时间窗（毫秒），默认 1000 */
  windowMs?: number
}

export interface LyricInspectResult {
  before: number
  after: number
  removedMeta: number
  removedDup: number
}

export declare const parseLyricLine: (line: string) => LyricLineParts
export declare const isMetadataLine: (text: string) => boolean
export declare const stripLeadingMetadata: (lines: string[]) => string[]
export declare const normalizeLyricText: (text: string) => string
export declare const dedupeAdjacentLines: (lines: string[], windowMs?: number) => string[]
export declare const sanitizeLyricText: (raw: string, options?: SanitizeLyricOptions) => string
export declare const inspectLyricText: (raw: string) => LyricInspectResult
