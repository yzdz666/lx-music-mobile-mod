/**
 * 听歌记账内核回归测试
 *
 * 覆盖之前线上暴露的两个问题：
 *   1. 冷启动直接播放（没有切歌）时一秒都不记；
 *   2. 只在切歌时才结算，导致「一边放歌一边看报告」永远是 0 秒。
 *
 * 用假时钟，整段播放瞬间跑完，结果确定。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(__dirname, '../..')

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
    failures.push(`${name}: ${err.message}`)
    console.log(`  ✗ ${name}\n      ${err.message}`)
  }
}

const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${label ?? ''} 期望 ${e}，实际 ${a}`)
}

// package.json 没有 "type": "module"，直接 import .js 会按 CJS 解析。
// 复制一份到临时 .mjs，测的仍是同一份源码（一个字符都没改）。
const corePath = path.join(repo, 'src/core/playStatsCore.js')
const tmpPath = path.join('/tmp', `playStatsCore.${process.pid}.mjs`)
fs.writeFileSync(tmpPath, fs.readFileSync(corePath, 'utf8'))
const { createTracker } = await import(pathToFileURL(tmpPath).href)

const music = (id, extra = {}) => ({ id, name: `歌 ${id}`, singer: '歌手', source: 'tx', ...extra })

/** 假时钟：手动推进 */
const makeClock = (start = 1_700_000_000_000) => {
  let t = start
  return { now: () => t, advance: ms => { t += ms } }
}

console.log('\nA. 首次播放（冷启动，没有切歌）')
check('建会话后播放 40 秒即可落账，并计一次有效播放', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  if (!tracker.start(music('1'))) throw new Error('start 应返回 true')
  tracker.play()
  clock.advance(40_000)
  const r = tracker.flush()
  if (!r) throw new Error('40 秒应该有增量')
  eq(r.sec, 40, 'sec')
  eq(r.counted, true, 'counted')
  eq(r.key, 'tx:1', 'key')
})

check('没建会话时 flush 不报错也不产生数据', () => {
  const tracker = createTracker({ now: () => 1 })
  eq(tracker.flush(), null, 'flush')
  eq(tracker.finish(), null, 'finish')
})

console.log('\nB. 播放中分多次落账，只累加增量')
check('10s + 10s + 15s 三次 flush 分别为 10 / 10 / 15', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  tracker.start(music('2'))
  tracker.play()

  clock.advance(10_000)
  eq(tracker.flush().sec, 10, '第一次')

  clock.advance(10_000)
  const second = tracker.flush()
  eq(second.sec, 10, '第二次')
  eq(second.counted, false, '20 秒还没到 30 秒门槛')

  clock.advance(25_000)
  const third = tracker.flush()
  eq(third.sec, 25, '第三次')
  eq(third.counted, true, '累计 45 秒应计一次')
})

check('一次会话最多计一次有效播放', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  tracker.start(music('3'))
  tracker.play()
  clock.advance(30_000)
  eq(tracker.flush().counted, true, '第一次')
  clock.advance(60_000)
  eq(tracker.flush().counted, false, '第二次不应再计')
})

check('不足 1 秒不产出增量', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  tracker.start(music('4'))
  tracker.play()
  clock.advance(600)
  eq(tracker.flush(), null, '600ms')
  clock.advance(500)
  eq(tracker.flush().sec, 1, '累计 1.1 秒应落 1 秒')
})

console.log('\nC. 暂停与缓冲不计时')
check('暂停 60 秒后再 flush，只算播放的 10 秒', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  tracker.start(music('5'))
  tracker.play()
  clock.advance(10_000)
  tracker.pause()
  clock.advance(60_000)
  eq(tracker.flush().sec, 10, 'sec')
  eq(tracker.isPlaying(), false, '暂停后 isPlaying')
})

check('暂停中反复 flush 不重复累加', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  tracker.start(music('6'))
  tracker.play()
  clock.advance(8_000)
  tracker.pause()
  eq(tracker.flush().sec, 8, '首次')
  eq(tracker.flush(), null, '第二次')
})

console.log('\nD. 阈值：短音频按 50%')
check('20 秒的音频播放 10 秒即计一次', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now, minSeconds: 30, minRatio: 0.5 })
  tracker.start(music('7'), 20_000)
  tracker.play()
  clock.advance(10_000)
  eq(tracker.flush().counted, true, '10 秒 = 50%')
})

check('20 秒的音频播放 9 秒不计', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now, minSeconds: 30, minRatio: 0.5 })
  tracker.start(music('8'), 20_000)
  tracker.play()
  clock.advance(9_000)
  eq(tracker.flush().counted, false, '9 秒 < 50%')
})

check('不知道时长时退回 30 秒固定门槛', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  tracker.start(music('9'), 0)
  tracker.play()
  clock.advance(29_000)
  eq(tracker.flush().counted, false, '29 秒')
  clock.advance(1_000)
  eq(tracker.flush().counted, true, '30 秒')
})

console.log('\nE. 单曲循环识别')
check('从 60 秒回到 0.5 秒判定为重播', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  tracker.start(music('10'))
  tracker.play()
  eq(tracker.rewind(1_000), false, '开头不算回绕')
  eq(tracker.rewind(60_000), false, '正常前进')
  eq(tracker.rewind(500), true, '回绕')
})

check('重播后 finish + start 不会把上一轮秒数带到下一轮', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  tracker.start(music('11'))
  tracker.play()
  clock.advance(20_000)
  const first = tracker.finish()
  eq(first.sec, 20, '第一轮')

  tracker.start(music('11'))
  tracker.play()
  clock.advance(5_000)
  eq(tracker.flush().sec, 5, '第二轮只算自己的 5 秒')
})

console.log('\nF. 换歌不串数据')
check('歌 A 播 12 秒后换歌 B，B 的增量从 0 开始', () => {
  const clock = makeClock()
  const tracker = createTracker({ now: clock.now })
  tracker.start(music('A'))
  tracker.play()
  clock.advance(12_000)
  eq(tracker.finish().sec, 12, 'A')

  tracker.start(music('B'))
  tracker.play()
  clock.advance(3_000)
  const r = tracker.flush()
  eq(r.sec, 3, 'B 的秒数')
  eq(r.key, 'tx:B', 'B 的 key')
})

check('没有 id 的曲目不建会话', () => {
  const tracker = createTracker({ now: () => 1 })
  eq(tracker.start({ name: '无 id' }), false, 'start')
  eq(tracker.current(), null, 'current')
})

console.log('\nG. playStats.ts 接线检查（防止内核被绕过）')
check('markPlaying 在会话缺失或换歌时会重建', () => {
  const src = fs.readFileSync(path.join(repo, 'src/core/playStats.ts'), 'utf8')
  if (!src.includes('tracker.current()')) throw new Error('markPlaying 没有用 tracker.current() 校正会话')
  if (!src.includes('startSession(music)')) throw new Error('markPlaying 没有重建会话')
})

check('播放中定时落账（间隔 5 秒）', () => {
  const src = fs.readFileSync(path.join(repo, 'src/core/playStats.ts'), 'utf8')
  if (!/setInterval\(\(\) => \{\s*if \(tracker\.isPlaying\(\)\) void flushSession\(\)/.test(src)) {
    throw new Error('没有注册播放中的定时 flush')
  }
  if (!src.includes('}, 5000)')) throw new Error('定时 flush 间隔不是 5 秒')
})

check('报告读取前先 flush，播放中打开也有数', () => {
  const src = fs.readFileSync(path.join(repo, 'src/core/playStats.ts'), 'utf8')
  const start = src.indexOf('export const getPlayReport')
  const body = src.slice(start, start + 400)
  if (!body.includes('await flushSession()')) throw new Error('getPlayReport 没有先结算当前会话')
})


console.log('\nH. 报告聚合与榜单上限（PlayReport 展示层）')
const seriesPath = path.join(repo, 'src/core/reportSeries.js')
const seriesTmp = path.join('/tmp', `reportSeries.${process.pid}.mjs`)
fs.writeFileSync(seriesTmp, fs.readFileSync(seriesPath, 'utf8'))
const { buildDailySeries, REPORT_TOP_SONG_LIMIT, REPORT_TOP_ARTIST_LIMIT } = await import(pathToFileURL(seriesTmp).href)

/** 造 n 天连续数据，每天 60 秒 1 次 */
const makeDays = (n) => {
  const out = []
  const base = Date.UTC(2026, 0, 1)
  for (let i = 0; i < n; i++) {
    const d = new Date(base + i * 86400000)
    out.push({ date: d.toISOString().slice(0, 10), sec: 60, cnt: 1 })
  }
  return out
}
const sum = (list, key) => list.reduce((total, item) => total + item[key], 0)

check('周 / 月保持逐日，不聚合', () => {
  const week = makeDays(7)
  const month = makeDays(30)
  if (buildDailySeries(week, 'week').length !== 7) throw new Error('week 应保持 7 条')
  if (buildDailySeries(month, 'month').length !== 30) throw new Error('month 应保持 30 条')
})

check('一年按 7 天聚合，秒数与次数守恒', () => {
  const days = makeDays(365)
  const series = buildDailySeries(days, 'year')
  if (series.length !== Math.ceil(365 / 7)) throw new Error(`桶数应为 ${Math.ceil(365 / 7)}，实际 ${series.length}`)
  if (sum(series, 'sec') !== sum(days, 'sec')) throw new Error('聚合后总秒数对不上')
  if (sum(series, 'cnt') !== sum(days, 'cnt')) throw new Error('聚合后总次数对不上')
})

check('全部按 30 天聚合，柱子数量可控', () => {
  const days = makeDays(365)
  const series = buildDailySeries(days, 'all')
  if (series.length !== Math.ceil(365 / 30)) throw new Error(`桶数应为 ${Math.ceil(365 / 30)}，实际 ${series.length}`)
  if (sum(series, 'sec') !== sum(days, 'sec')) throw new Error('聚合后总秒数对不上')
})

check('不足 31 天时即使选「全部」也不聚合', () => {
  const days = makeDays(20)
  if (buildDailySeries(days, 'all').length !== 20) throw new Error('短数据不应被合并')
})

check('空数据与非法输入不抛异常', () => {
  if (buildDailySeries([], 'year').length !== 0) throw new Error('空数组应返回空')
  if (buildDailySeries(null, 'all').length !== 0) throw new Error('null 应返回空')
})

check('最近一组桶是完整的（从末尾往前切）', () => {
  const days = makeDays(100)
  const series = buildDailySeries(days, 'year')
  const last = series[series.length - 1]
  // 100 天按 7 天切，最后一桶必须是完整 7 天 = 420 秒
  if (last.sec !== 420) throw new Error(`最后一桶应为 420 秒，实际 ${last.sec}`)
})

check('榜单上限放宽到 50 首歌 / 20 位歌手', () => {
  if (REPORT_TOP_SONG_LIMIT !== 50) throw new Error('歌曲上限不是 50')
  if (REPORT_TOP_ARTIST_LIMIT !== 20) throw new Error('歌手上限不是 20')
  const src = fs.readFileSync(path.join(repo, 'src/core/playStats.ts'), 'utf8')
  if (!src.includes('slice(0, REPORT_TOP_SONG_LIMIT)')) throw new Error('playStats 没有使用统一上限常量')
})

check('报告页不再截断榜单', () => {
  const src = fs.readFileSync(path.join(repo, 'src/screens/Home/Views/Setting/settings/Other/PlayReport.tsx'), 'utf8')
  if (/topSongs\.slice\(/.test(src)) throw new Error('topSongs 仍被 slice 截断')
  if (/topArtists\.slice\(/.test(src)) throw new Error('topArtists 仍被 slice 截断')
  if (!src.includes('nestedScrollEnabled')) throw new Error('ScrollView 缺少 nestedScrollEnabled')
})

fs.rmSync(seriesTmp, { force: true })

fs.rmSync(tmpPath, { force: true })

console.log(`\n${fail === 0 ? '全部' : ''} ${pass} 个用例通过${fail ? `，${fail} 个失败` : ''}`)
if (fail) {
  console.log(failures.map(f => ` - ${f}`).join('\n'))
  process.exit(1)
}
