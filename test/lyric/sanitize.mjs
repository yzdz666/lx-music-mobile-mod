/**
 * 歌词数据清洗回归测试
 *
 * 全部用**真实的 lrc-file-parser** 做端到端校验，不是只比字符串：
 * 脏歌词 → sanitize → 解析 → 用可控时钟播到指定时刻 → 断言当前行。
 *
 * 运行：node test/lyric/sanitize.mjs
 */
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createClock, installDomShim, loadPhoneParser, ROOT } from './harness.mjs'

const clock = createClock()
installDomShim(clock)
const Lyric = await loadPhoneParser()

// 纯逻辑模块是 ESM 写法但扩展名是 .js（RN 侧靠 Metro 处理），
// 这里复制成临时 .mjs 再 import，和 test/stats 的做法保持一致
const sanSrc = path.join(ROOT, 'src/core/lyricSanitize.js')
const sanTmp = path.join('/tmp', `lyricSanitize.${process.pid}.mjs`)
fs.writeFileSync(sanTmp, fs.readFileSync(sanSrc, 'utf8'))
const {
  sanitizeLyricText,
  stripLeadingMetadata,
  isMetadataLine,
  parseLyricLine,
  normalizeLyricText,
  inspectLyricText,
} = await import(pathToFileURL(sanTmp).href)

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

/** 用真实解析器解析，返回 lines（不启动定时器） */
const parse = (text) => {
  const parser = new Lyric({ onPlay: () => {}, onSetLyric: () => {}, offset: 0 })
  let lines = []
  parser.onSetLyric = (l) => { lines = l }
  parser.setLyric(text, [])
  return lines
}

/** 解析后用假时钟播到 at 毫秒，返回当前行文本 */
const playTo = (text, at) => {
  let current = { line: -1, text: '' }
  const parser = new Lyric({
    onPlay: (line, t) => { current = { line, text: t } },
    onSetLyric: () => {},
    offset: 0,
  })
  parser.setLyric(text, [])
  parser.play(0)
  clock.advance(at)
  parser.pause()
  return current
}

const QQ_META = [
  '[00:00.00]曲：马嘉祺',
  '[00:00.60]编曲：钱雷',
  '[00:01.20]制作人：钱雷',
  '[00:01.80]钢琴演奏：钱雷',
  '[00:02.40]人声监制：马嘉祺/钱雷',
  '[00:03.00]同期录音师：李宗远@Studio 21A',
  '[00:03.60]同期录音棚：Studio 21A',
  '[00:04.20]人声编辑：李宗远@Studio 21A',
  '[00:04.80]混音：钱雷',
  '[00:09.00]小时候相信一艘纸船就能到彼岸',
  '[00:12.00]那时你多无畏敢同世界掰手腕',
  '[00:15.00]可抵达梦想的路哪会一程都平坦',
].join('\n')

console.log('\nA. 制作名单（元数据行）')

check('QQ 风格开头 9 行制作名单全部删除', () => {
  const lines = parse(sanitizeLyricText(QQ_META))
  assert.strictEqual(lines.length, 3, `应只剩 3 句歌词，实际 ${lines.length}`)
  assert.strictEqual(lines[0].text, '小时候相信一艘纸船就能到彼岸')
  assert.strictEqual(lines[0].time, 9000)
})

check('播放到 9 秒时当前行是第一句歌词，而不是「混音：钱雷」', () => {
  const clean = sanitizeLyricText(QQ_META)
  const cur = playTo(clean, 9200)
  assert.strictEqual(cur.text, '小时候相信一艘纸船就能到彼岸')
})

check('带前缀的工种（同期录音师 / 钢琴演奏 / 人声编辑）都识别', () => {
  for (const t of ['同期录音师：李宗远', '同期录音棚：Studio 21A', '钢琴演奏：钱雷', '人声编辑：李宗远', '人声监制：马嘉祺']) {
    assert.ok(isMetadataLine(t), `未识别：${t}`)
  }
})

check('45 秒之后出现的「曲：」不删除（那位置不可能是制作名单）', () => {
  const raw = [
    '[00:01.00]第一句歌词',
    '[01:00.00]曲：马嘉祺', // 1 分钟处，超出扫描窗口
    '[01:03.00]第三句歌词',
  ].join('\n')
  const lines = parse(sanitizeLyricText(raw))
  assert.strictEqual(lines.length, 3, `应保留 3 条，实际 ${lines.length}`)
})

check('真实样本 basic.lrc：第一句正文 + 8 行制作名单 + 正文重复', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'test/lyric/fixtures/basic.lrc'), 'utf8')
  const clean = sanitizeLyricText(raw)
  const lines = parse(clean)
  assert.ok(!clean.includes('词：李思源'), '词没删')
  assert.ok(!clean.includes('出品：某某工作室'), '出品没删')
  assert.strictEqual(lines[0].text, '我听人说思念像风一样', '第一句被误删')
  assert.strictEqual(lines[0].time, 0)
  // 0 秒的第一句与 3 秒的那句相隔 3 秒，属于歌曲本身的结构，必须保留
  assert.ok(lines.some(l => l.time === 3000), '3 秒处的重复句被误删')
  assert.strictEqual(lines.filter(l => l.text === '我听人说思念像风一样').length, 2)
})

check('真实样本 jp.lrc：日文歌的 作詞 / 作曲 也删除', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'test/lyric/fixtures/jp.lrc'), 'utf8')
  const clean = sanitizeLyricText(raw)
  assert.ok(!clean.includes('作詞'), '作詞没删')
  assert.ok(!clean.includes('作曲'), '作曲没删')
  assert.ok(clean.includes('沈むように溶けてゆくように'))
})

check('真实样本 torture.lrc 的边界行不被误删', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'test/lyric/fixtures/torture.lrc'), 'utf8')
  const clean = sanitizeLyricText(raw)
  // 「制作信息」没有冒号，不是 key:value 结构，不能当成制作名单
  assert.ok(clean.includes('制作信息'), '「制作信息」被误删')
  assert.ok(clean.includes('正常一句'))
})

check('[ti:] [ar:] [offset:] 标签不打断扫描，也不会被删', () => {
  const raw = ['[ti:致年少的自己]', '[ar:马嘉祺]', '[by:QQ音乐]', '[00:00.00]词：马嘉祺', '[00:01.00]曲：马嘉祺', '[00:09.00]正文'].join('\n')
  const clean = sanitizeLyricText(raw)
  assert.ok(clean.includes('[ti:致年少的自己]'), 'ti 标签被删了')
  assert.ok(clean.includes('[ar:马嘉祺]'), 'ar 标签被删了')
  assert.ok(!clean.includes('词：马嘉祺'), '制作名单没删干净')
  assert.ok(clean.includes('[00:09.00]正文'))
})

check('正常歌词里的「他说：我不知道。」不误判', () => {
  assert.ok(!isMetadataLine('他说：我不知道。'))
  assert.ok(!isMetadataLine('她说：走吧'))
  assert.ok(!isMetadataLine('男：你好'))
  assert.ok(!isMetadataLine('女：再见'))
})

check('整份只有制作名单时返回空文本，不抛异常', () => {
  const raw = ['[00:00.00]曲：马嘉祺', '[00:01.00]编曲：钱雷'].join('\n')
  const clean = sanitizeLyricText(raw)
  assert.strictEqual(clean.trim(), '')
  assert.strictEqual(parse(clean).length, 0)
})

console.log('\nB. 重复行（红字 + 一模一样的黑字）')

check('相邻同文本、时间差 350ms：合并成一条', () => {
  const raw = [
    '[00:09.00]小时候相信一艘纸船就能到彼岸',
    '[00:09.35]小时候相信一艘纸船就能到彼岸',
    '[00:12.00]那时你多无畏敢同世界掰手腕',
  ].join('\n')
  const lines = parse(sanitizeLyricText(raw))
  assert.strictEqual(lines.length, 2, `应剩 2 条，实际 ${lines.length}`)
  assert.strictEqual(lines[0].text, '小时候相信一艘纸船就能到彼岸')
})

check('时间差 5000ms 的副歌重复必须保留', () => {
  const raw = [
    '[00:09.00]副歌第一句',
    '[00:14.00]副歌第一句',
  ].join('\n')
  const lines = parse(sanitizeLyricText(raw))
  assert.strictEqual(lines.length, 2, '副歌重复被误删了')
})

check('只差空格 / 标点也算同一句', () => {
  const raw = [
    '[00:09.00]小时候相信 一艘纸船，就能到彼岸',
    '[00:09.20]小时候相信一艘纸船就能到彼岸。',
  ].join('\n')
  const lines = parse(sanitizeLyricText(raw))
  assert.strictEqual(lines.length, 1)
})

check('三连重复只保留第一条', () => {
  const raw = [
    '[00:09.00]同一句',
    '[00:09.10]同一句',
    '[00:09.20]同一句',
  ].join('\n')
  assert.strictEqual(parse(sanitizeLyricText(raw)).length, 1)
})

check('重复行带多个时间戳（副歌复用）时保留第一条的多时间戳', () => {
  const raw = [
    '[00:09.00][00:30.00]副歌句',
    '[00:09.30]副歌句',
    '[00:20.00]过渡句',
  ].join('\n')
  const lines = parse(sanitizeLyricText(raw))
  assert.strictEqual(lines.length, 3, `副歌的两个时间点都该保留，实际 ${lines.length}`)
  assert.ok(lines.some(l => l.time === 30000), '第二个时间点丢了')
})

check('正文与译文完全相同时，译文不再挂到正文下面', () => {
  const parser = new Lyric({ onPlay: () => {}, onSetLyric: () => {}, offset: 0 })
  let lines = []
  parser.onSetLyric = (l) => { lines = l }
  const lrc = sanitizeLyricText('[00:09.00]小时候相信一艘纸船就能到彼岸')
  const tlrc = sanitizeLyricText('[00:09.00]小时候相信一艘纸船就能到彼岸', { dedupe: false })
  parser.setLyric(lrc, [tlrc])
  assert.strictEqual(lines.length, 1)
  assert.strictEqual(lines[0].extendedLyrics.length, 0, '相同译文仍被挂载')
})

check('正常的双语歌词：译文与正文不同，必须保留', () => {
  const parser = new Lyric({ onPlay: () => {}, onSetLyric: () => {}, offset: 0 })
  let lines = []
  parser.onSetLyric = (l) => { lines = l }
  parser.setLyric('[00:09.00]I believe in paper boats', ['[00:09.00]我相信纸船'])
  assert.strictEqual(lines[0].extendedLyrics[0], '我相信纸船')
})

console.log('\nC. 不误伤正常歌词')

check('干净歌词逐字节原样返回', () => {
  const raw = '[00:01.00]第一句\n[00:02.00]第二句\n[00:03.00]第三句'
  assert.strictEqual(sanitizeLyricText(raw), raw)
})

check('纯文本歌词（无时间戳）原样返回', () => {
  const raw = '第一句\n第二句\n第三句'
  assert.strictEqual(sanitizeLyricText(raw), raw)
})

check('空字符串 / null / undefined 不抛异常', () => {
  assert.strictEqual(sanitizeLyricText(''), '')
  assert.strictEqual(sanitizeLyricText(null), '')
  assert.strictEqual(sanitizeLyricText(undefined), '')
})

check('开头空行与 [00:00.00] 占位行不影响裁剪', () => {
  const raw = ['', '[00:00.00]', '[00:00.00]词：马嘉祺', '[00:09.00]正文'].join('\n')
  const clean = sanitizeLyricText(raw)
  assert.ok(!clean.includes('词：马嘉祺'))
  assert.ok(clean.includes('[00:09.00]正文'))
})

check('小时制时间标签不会被误判成制作名单', () => {
  const raw = '[01:02:03.45]长时间歌词\n[01:02:10.00]第二句'
  const clean = sanitizeLyricText(raw)
  assert.ok(clean.includes('长时间歌词'))
})

console.log('\nD. 端到端：真实解析器 + 可控时钟')

check('脏歌词播到每一秒都不出现制作名单', () => {
  const clean = sanitizeLyricText(QQ_META)
  const bad = ['曲：', '编曲：', '制作人：', '钢琴演奏：', '人声监制：', '录音师：', '录音棚：', '人声编辑：', '混音：']
  for (let t = 0; t <= 16000; t += 250) {
    const cur = playTo(clean, t)
    for (const k of bad) {
      assert.ok(!cur.text.startsWith(k), `第 ${t}ms 出现制作名单：${cur.text}`)
    }
  }
})

check('重复句在整首歌播放过程中只出现一次', () => {
  const clean = sanitizeLyricText([
    '[00:01.00]A 句',
    '[00:01.40]A 句',
    '[00:05.00]B 句',
    '[00:05.30]B 句',
    '[00:09.00]C 句',
  ].join('\n'))
  const seen = []
  let last = ''
  for (let t = 0; t <= 10000; t += 100) {
    const cur = playTo(clean, t)
    if (cur.text && cur.text !== last) { seen.push(cur.text); last = cur.text }
  }
  assert.deepStrictEqual(seen, ['A 句', 'B 句', 'C 句'], `实际播放顺序：${seen.join(' → ')}`)
})

check('inspectLyricText 统计与清洗结果一致', () => {
  const info = inspectLyricText(QQ_META)
  assert.strictEqual(info.before, 12)
  assert.strictEqual(info.after, 3)
  assert.strictEqual(info.removedMeta + info.removedDup, 9)
})

check('parseLyricLine 正确拆分多时间戳', () => {
  const r = parseLyricLine('[00:01.00][00:10.50]副歌')
  assert.deepStrictEqual(r.times, [1000, 10500])
  assert.strictEqual(r.text, '副歌')
})

check('normalizeLyricText 抹平空白与标点', () => {
  assert.strictEqual(normalizeLyricText(' 你 好，世界！ '), normalizeLyricText('你好世界'))
})

check('stripLeadingMetadata 返回新数组，不修改入参', () => {
  const input = ['[00:00.00]曲：马嘉祺', '[00:09.00]正文']
  const snapshot = [...input]
  const out = stripLeadingMetadata(input)
  assert.deepStrictEqual(input, snapshot)
  assert.strictEqual(out.length, 1)
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) {
  for (const f of failures) console.error(`\n[${f.name}]\n${f.err.stack}`)
  process.exit(1)
}
fs.rmSync(sanTmp, { force: true })
