/**
 * 歌词回归测试
 *
 * 覆盖四件事：
 * 1. LRC 时间解析：0.0x 秒打轴、混用精度、小时制、无小数；
 * 2. 多重歌词：正文 + 翻译 + 罗马音 + 逐字行，精度不同也要能对上；
 * 3. 桌面歌词渲染：电脑版 line-player 用假时钟跑完整首歌，逐行核对触发时间与文本；
 * 4. 两端一致性：手机 JS 解析器 / 电脑版 line-player / Android 原生算法镜像
 *    对同一份 LRC 必须得到完全相同的时间与文本。
 *
 * 运行：node test/lyric/run.mjs
 */
import assert from 'node:assert'
import fs from 'node:fs'

import {
  createClock,
  installDomShim,
  loadPhoneParser,
  loadDesktopPlayer,
  mirrorJavaParser,
  readFixture,
  ROOT,
} from './harness.mjs'

const clock = createClock()
installDomShim(clock)

const PhoneLyric = await loadPhoneParser()
const DesktopPlayer = await loadDesktopPlayer(clock)

let passed = 0
let failed = 0
const failures = []
let currentGroup = ''

const group = (name) => {
  currentGroup = name
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

const check = (label, fn) => {
  try {
    fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  } catch (err) {
    failed++
    failures.push({ group: currentGroup, label, error: err })
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    console.log(`    ${String(err.message).split('\n').join('\n    ')}`)
  }
}

const parsePhone = (lyric, extended) => {
  const parser = new PhoneLyric({ lyric, extendedLyrics: extended ?? [], offset: 0 })
  return parser
}

const times = lines => lines.map(line => line.time)
const texts = lines => lines.map(line => line.text)

// ---------------------------------------------------------------------------
group('A. 时间解析（手机 App 内歌词）')

const basic = readFixture('basic.lrc')
const basicLines = parsePhone(basic).lines

check('0.0x 秒打轴按毫秒解析，不再放大 10 倍', () => {
  assert.deepStrictEqual(times(basicLines), [
    0, 60, 130, 210, 500, 1050, 1500, 2000, 3000, 7500, 12000, 18250, 24000, 30100, 36800,
  ])
})

check('[00:01.05] 与 [00:01.50] 不撞行，两行文本都在', () => {
  const line = basicLines.find(item => item.time === 1050)
  const next = basicLines.find(item => item.time === 1500)
  assert.ok(line, '缺少 1050ms 行')
  assert.ok(next, '缺少 1500ms 行')
  assert.strictEqual(line.text, '混音：王五')
  assert.strictEqual(next.text, '母带：赵六')
  assert.deepStrictEqual(line.extendedLyrics, [])
})

const mixedLines = parsePhone(readFixture('mixed.lrc')).lines
check('同一文件混用 1 / 2 / 3 位小数时逐行正确', () => {
  assert.deepStrictEqual(times(mixedLines), [500, 1050, 2500, 3050, 4500, 5005, 6060, 7500])
})

check('三位小数与两位小数不会被重复补零', () => {
  assert.strictEqual(mixedLines.find(item => item.time === 5005).text, '三位小数 5005ms')
  assert.strictEqual(mixedLines.find(item => item.time === 6060).text, '两位小数 6060ms')
})

check('小时制 [01:00:00.06] 解析为 3600060ms', () => {
  const parser = parsePhone('[01:00:00.06]一小时处\n[00:01.00]一秒处')
  assert.deepStrictEqual(times(parser.lines), [1000, 3600060])
})

// ---------------------------------------------------------------------------
group('B. 多重歌词（正文 + 翻译 + 罗马音）')

const multiLyric = readFixture('multi.lrc')
const multiTrans = readFixture('multi.tlrc')
const multiLines = parsePhone(multiLyric, [multiTrans]).lines

check('翻译行挂到对应正文行上', () => {
  assert.strictEqual(multiLines.length, 5)
  assert.deepStrictEqual(multiLines[1].extendedLyrics, ['The wind blows over the hills'])
  assert.deepStrictEqual(multiLines[2].extendedLyrics, ['Moonlight falls on my shoulders'])
})

check('翻译行与正文精度不同也能匹配（.06 对齐 60ms）', () => {
  const first = multiLines[0]
  assert.strictEqual(first.time, 60)
  assert.deepStrictEqual(first.extendedLyrics, ['Lyrics: Li Siyuan'])
})

check('同时挂翻译与罗马音时不互相覆盖', () => {
  const parser = parsePhone(readFixture('jp.lrc'), [readFixture('jp.rlrc'), '[00:01.20]shizumu you ni'])
  const line = parser.lines.find(item => item.time === 1200)
  assert.deepStrictEqual(line.extendedLyrics, ['shizumu you ni tokete yuku you ni', 'shizumu you ni'])
})

check('逐字行保留时间标签且正文时间正确', () => {
  const parser = parsePhone(readFixture('word.lxlrc'))
  assert.deepStrictEqual(times(parser.lines), [3000, 7500])
  assert.ok(parser.lines[0].text.startsWith('<00:03.00>风'), parser.lines[0].text)
})

// ---------------------------------------------------------------------------
group('C. 边界情况')

const torture = readFixture('torture.lrc')
const tortureLines = parsePhone(torture).lines

check('重复时间戳的第二行进 extendedLyrics，不丢也不覆盖', () => {
  const line = tortureLines.find(item => item.time === 1000)
  assert.strictEqual(line.text, '正常一句')
  assert.deepStrictEqual(line.extendedLyrics, ['同一时间戳的第二行'])
})

check('翻译文件里的 // 占位被丢弃，不会挂到正文行', () => {
  const parser = parsePhone('[00:01.00]正文一\n[00:02.00]正文二', ['[00:01.00]//\n[00:02.00]译文二'])
  assert.strictEqual(parser.lines[0].text, '正文一')
  assert.deepStrictEqual(parser.lines[0].extendedLyrics, [])
  assert.deepStrictEqual(parser.lines[1].extendedLyrics, ['译文二'])
})

check('正文里的空行被丢弃，不留空行占位', () => {
  assert.ok(!texts(tortureLines).some(text => text === ''))
})

check('行内第二个时间标签不会当成新行', () => {
  const line = tortureLines.find(item => item.time === 3000)
  assert.strictEqual(line.text, '一行两个标签[00:04.00]第二标签')
  assert.ok(!tortureLines.some(item => item.time === 4000))
})

check('offset 元信息被读出', () => {
  const parser = parsePhone(torture)
  assert.strictEqual(parser.tags.offset, 100)
})

// ---------------------------------------------------------------------------
group('D. 行定位（渲染数据源）')

const locator = parsePhone(basic)
const expectLineAt = (time, index) => {
  const actual = locator._findCurLineNum(time)
  assert.strictEqual(actual, index, `t=${time}ms 期望第 ${index} 行，实际第 ${actual} 行`)
}

check('时间轴上每一行的边界都落在正确的行号', () => {
  expectLineAt(0, 0)
  expectLineAt(59, 0)
  expectLineAt(60, 0)
  expectLineAt(61, 1)
  // 正好等于某行时间点时，仍算上一行（该行从这一毫秒才开始）
  expectLineAt(1050, 4)
  expectLineAt(1051, 5)
  expectLineAt(1500, 5)
  expectLineAt(1501, 6)
  expectLineAt(3000, 7)
  expectLineAt(3001, 8)
  expectLineAt(36800, 13)
  expectLineAt(36801, 14)
  expectLineAt(99999, 14)
})

// ---------------------------------------------------------------------------
group('E. 桌面歌词渲染（电脑版 line-player，假时钟）')

/** 用假时钟完整播放一遍，收集 onPlay 调用 */
const renderDesktop = (lyric, extended, duration) => {
  const played = []
  const player = new DesktopPlayer({
    offset: 0,
    onPlay: (lineNum, text, time) => { played.push({ lineNum, text, time }) },
  })
  player.setLyric(lyric, extended ?? [])
  player.play(0)
  clock.advance(duration)
  return { player, played }
}

check('逐行按时触发，行号与文本完全正确', () => {
  const { played } = renderDesktop(basic, [], 40000)
  const visible = played.filter(item => item.lineNum >= 0)
  assert.deepStrictEqual(visible.map(item => item.lineNum), basicLines.map((_, index) => index))
  assert.deepStrictEqual(visible.map(item => item.text), texts(basicLines))
})

check('每行的触发时间与标签时间的误差在 1 帧内', () => {
  const { played } = renderDesktop(basic, [], 40000)
  for (const item of played.filter(entry => entry.lineNum >= 0)) {
    const expected = basicLines[item.lineNum].time
    assert.ok(
      Math.abs(item.time - expected) <= 16,
      `第 ${item.lineNum} 行（${item.text}）触发于 ${item.time}ms，标签 ${expected}ms`,
    )
  }
})

check('桌面歌词不会卡在 0.0x 行：60ms 行在 60ms 左右出现', () => {
  const { played } = renderDesktop(basic, [], 4000)
  const target = played.find(item => item.text === '词：李思源')
  assert.ok(target, '60ms 的制作信息行没有触发')
  assert.ok(target.time <= 80, `60ms 行拖到了 ${target.time}ms`)
})

check('最后一行播完后自动暂停，不会继续空跑', () => {
  const { player } = renderDesktop(basic, [], 40000)
  assert.strictEqual(player.isPlay, false)
  assert.strictEqual(player.curLineNum, player.maxLine)
})

check('桌面歌词渲染时带上翻译行', () => {
  const { player } = renderDesktop(multiLyric, [multiTrans], 20000)
  const line = player.lines.find(item => item.time === 7500)
  assert.deepStrictEqual(line.extendedLyrics, ['Moonlight falls on my shoulders'])
})

check('中途 seek 后从新位置继续，不重复播旧行', () => {
  const played = []
  const player = new DesktopPlayer({
    offset: 0,
    onPlay: (lineNum, text, time) => { played.push({ lineNum, text, time }) },
  })
  player.setLyric(basic, [])
  player.play(12000)
  clock.advance(1000)
  const afterSeek = played[played.length - 1]
  assert.strictEqual(afterSeek.text, '带走了谁的惆怅')
  played.length = 0
  clock.advance(7000)
  assert.strictEqual(played[0].text, '我站在路口张望')
})

// ---------------------------------------------------------------------------
group('F. 重复歌词（同一句只显示一次）')

check('译文与正文相同时不挂载，不同时才挂', () => {
  const parser = parsePhone(readFixture('dup.lrc'), [readFixture('dup.tlrc')])
  const lines = parser.lines
  // [00:00.00] 的译文与正文相同 → 丢掉
  assert.deepStrictEqual(lines[0].extendedLyrics, [], '与正文相同的译文不该出现')
  // [00:00.50] 有真正的翻译 → 保留
  assert.deepStrictEqual(lines[1].extendedLyrics, ["Love can't be held full"])
  // [00:01.00] 译文是 // 占位 → 丢掉
  assert.deepStrictEqual(lines[2].extendedLyrics, [])
  // [00:01.50] / [00:02.00] 译文又抄了一遍正文 → 丢掉
  assert.deepStrictEqual(lines[3].extendedLyrics, [])
  assert.deepStrictEqual(lines[4].extendedLyrics, [])
})

check('同一句带两个相同时间标签时不会变成「正文 + 译文」', () => {
  const lines = parsePhone(readFixture('dup2.lrc')).lines
  assert.strictEqual(lines.length, 2)
  assert.strictEqual(lines[0].text, '锐利伤悲')
  assert.deepStrictEqual(lines[0].extendedLyrics, [], '重复时间标签不该产生译文')
})

check('重复挂载同一句译文时只保留一条', () => {
  const parser = parsePhone('[00:00.00]正文', ['[00:00.00]同一个翻译\n[00:00.00]同一个翻译'])
  assert.deepStrictEqual(parser.lines[0].extendedLyrics, ['同一个翻译'])
})

check('电脑版 line-player 同样不重复挂载', () => {
  const player = new DesktopPlayer({ offset: 0 })
  player.setLyric(readFixture('dup.lrc'), [readFixture('dup.tlrc')])
  assert.deepStrictEqual(player.lines[0].extendedLyrics, [])
  assert.deepStrictEqual(player.lines[1].extendedLyrics, ["Love can't be held full"])
})

check('Android 源码对译文做了去重', () => {
  const src = fs.readFileSync(`${ROOT}/android/app/src/main/java/com/lxmod/music/lyric/LyricPlayer.java`, 'utf8')
  assert.ok(src.includes('!text.equals(lineText)'), 'parseExtendedLyric 没有比对正文')
  assert.ok(src.includes('!extended.contains(text)'), 'parseExtendedLyric 没有对已挂译文去重')
  assert.ok(src.includes('!text.equals(existText)'), 'initLines 没有处理重复时间标签')
})

// ---------------------------------------------------------------------------
group('G. 三端解析一致性')

const compare = (label, lyric, extended) => {
  check(label, () => {
    const phone = parsePhone(lyric, extended).lines
    const java = mirrorJavaParser(lyric, extended)
    assert.deepStrictEqual(times(java), times(phone))
    assert.deepStrictEqual(texts(java), texts(phone))
    assert.deepStrictEqual(java.map(l => l.extendedLyrics), phone.map(l => l.extendedLyrics))
  })
}

compare('basic：手机 JS 与 Android 算法一致', basic)
compare('mixed：混用精度两端一致', readFixture('mixed.lrc'))
compare('multi：翻译挂载两端一致', multiLyric, [multiTrans])
compare('jp：罗马音两端一致', readFixture('jp.lrc'), [readFixture('jp.rlrc')])
compare('torture：边界情况两端一致', torture)

check('电脑版 line-player 与手机版解析结果一致', () => {
  const player = new DesktopPlayer({ offset: 0 })
  player.setLyric(basic, [])
  assert.deepStrictEqual(times(player.lines), times(basicLines))
  assert.deepStrictEqual(texts(player.lines), texts(basicLines))
})

check('Android 源码仍在用「补到 3 位」的写法，没有回退到剥离前导 0', () => {
  const src = fs.readFileSync(`${ROOT}/android/app/src/main/java/com/lxmod/music/lyric/LyricPlayer.java`, 'utf8')
  // 只检查 formatTimeLabel 方法体：文件里还留着解释旧 bug 的注释，全文匹配会误报
  const start = src.indexOf('private String formatTimeLabel')
  const end = src.indexOf('private String normalizeTimeKey')
  assert.ok(start > 0 && end > start, '找不到 formatTimeLabel 方法')
  const body = src.slice(start, end)
  assert.ok(!body.includes('t_rxp_3'), 'formatTimeLabel 又在剥离小数位前导 0')
  assert.ok(!src.includes('String t_rxp_3'), '源码里又定义了 t_rxp_3')
  assert.ok(!/boolean isMsTime/.test(src), 'LyricPlayer.java 又依赖整首歌是否含 3 位小数')
  assert.ok(src.includes('padEnd(msStr, 3'), 'LyricPlayer.java 没有按 3 位补零')
})

// ---------------------------------------------------------------------------
console.log('')
if (failed > 0) {
  console.log(`\x1b[31m${failed} 个用例失败\x1b[0m，${passed} 个通过\n`)
  for (const item of failures) {
    console.log(`\x1b[31m[${item.group}] ${item.label}\x1b[0m`)
    console.log(item.error.stack?.split('\n').slice(0, 4).join('\n'))
    console.log('')
  }
  process.exitCode = 1
} else {
  console.log(`\x1b[32m全部 ${passed} 个用例通过\x1b[0m\n`)
}
