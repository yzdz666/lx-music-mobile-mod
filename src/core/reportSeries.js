/**
 * 听歌报告的展示层聚合（纯逻辑，不依赖 React Native）
 *
 * 抽出来的原因和 playStatsCore 一样：报告页「一年 / 全部」的柱子怎么合并
 * 必须能被 node 直接跑测试。放在 .tsx 里只能靠肉眼数柱子。
 */

/** Top 歌曲 / 歌手上限：报告页要能翻到完整榜单，不能只给前 10 条 */
export const REPORT_TOP_SONG_LIMIT = 50
export const REPORT_TOP_ARTIST_LIMIT = 20

/**
 * 把逐日数据聚合成图上能看清的粒度。
 *
 * - week / month：保持逐日（7 / 30 根柱子）；
 * - year：7 天一个桶（约 52 根）；
 * - all：30 天一个桶（按月的近似）；
 * - 数据本身不超过 31 天时原样返回，避免出现只有一根柱子的图。
 *
 * 桶从「最后一天」往前切，保证最近的一组永远是完整的，不会被截成半周。
 */
export const buildDailySeries = (daily, range) => {
  const list = Array.isArray(daily) ? daily : []
  if (range === 'week' || range === 'month' || list.length <= 31) return list

  const bucketDays = range === 'year' ? 7 : 30
  const out = []
  for (let end = list.length; end > 0; end -= bucketDays) {
    const start = Math.max(0, end - bucketDays)
    const slice = list.slice(start, end)
    if (!slice.length) continue
    const first = slice[0]
    const last = slice[slice.length - 1]
    out.unshift({
      date: slice.length === 1 ? first.date : `${first.date.slice(5)}~${last.date.slice(5)}`,
      sec: slice.reduce((sum, item) => sum + (Number(item.sec) || 0), 0),
      cnt: slice.reduce((sum, item) => sum + (Number(item.cnt) || 0), 0),
    })
  }
  return out
}
