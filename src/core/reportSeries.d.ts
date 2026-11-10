export interface DayPoint {
  date: string
  sec: number
  cnt: number
}

export const REPORT_TOP_SONG_LIMIT: number
export const REPORT_TOP_ARTIST_LIMIT: number
export function buildDailySeries(daily: DayPoint[], range: 'week' | 'month' | 'year' | 'all'): DayPoint[]
