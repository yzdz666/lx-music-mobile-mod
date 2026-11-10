/**
 * 歌词数据清洗（在交给 lrc-file-parser 之前执行）
 *
 * 解决两类「看起来像渲染坏了、其实是数据脏」的问题：
 *
 * 1. 元数据行被当成歌词逐句播放
 *    QQ 音乐等平台返回的 LRC 会把制作信息也打上时间戳，且时间戳是递增的：
 *      [00:00.00]曲：马嘉祺
 *      [00:00.60]编曲：钱雷
 *      [00:01.20]制作人：钱雷
 *    解析器无法区分「这是制作名单」和「这是歌词」，于是前 10 秒就在滚字幕。
 *    这里只删除**歌曲开头连续的一段**元数据，中段出现的同名行一律不动，
 *    避免误删「他说：……」这类正常歌词。
 *
 * 2. 同一句歌词重复出现两次
 *    音源有时把正文与译文拼进同一份 LRC，或把逐字稿再整行追加一遍，
 *    两行文本一字不差、时间戳只差几十到几百毫秒：
 *      [00:09.00]小时候相信一艘纸船就能到彼岸
 *      [00:09.35]小时候相信一艘纸船就能到彼岸
 *    解析器看成两条独立歌词，界面就是「红色当前句 + 紧跟一条一模一样的黑字」。
 *    译文去重管不到这种情况（它们是两条 line，不是 text + extendedLyrics）。
 *    这里按「规范化文本相同且时间差在一个窗口内」合并，窗口外的重复句
 *    （副歌隔 30 秒再唱一遍）保持原样。
 */

/** 制作名单里常见的字段名（精确匹配，冒号前的部分；含繁体与日文汉字写法） */
const META_KEYS = new Set([
  '作词', '作曲', '词', '曲', '词曲', '编曲', '制作', '制作人', '监制', '出品', '出品人',
  '发行', '发行公司', '录音', '录音师', '录音棚', '录音室', '混音', '混音师', '母带',
  '母带工程师', '吉他', '贝斯', '鼓', '键盘', '弦乐', '和声', '和声编写', '配唱',
  '配唱制作人', '人声', '人声编辑', '人声监制', '人声录音', '钢琴', '钢琴演奏',
  '小提琴', '大提琴', '长笛', '萨克斯', '二胡', '古筝', '琵琶', '笛子', '箫',
  '策划', '统筹', '企划', '营销', '推广', '宣传', '设计', '插画', '摄影', '导演',
  '特别鸣谢', '鸣谢', '版权', '版权所有', '专辑', '歌手', '演唱', '原唱', '制作统筹',
  '音乐总监', '艺术总监', '监唱', '配音', '后期', '混音助理', '录音助理', '助理',
  '器乐', '演奏', '合音', '伴唱', '编程', '编写', 'OP', 'SP', 'ISRC', 'MV',
  // 繁体 / 日文写法
  '作詞', '編曲', '製作', '製作人', '監製', '出品人', '發行', '發行公司', '錄音',
  '錄音師', '錄音棚', '錄音室', '混音', '混音師', '母帶', '母帶工程師', '貝斯',
  '鍵盤', '弦樂', '和聲', '和聲編寫', '配唱製作人', '人聲', '人聲編輯', '人聲監製',
  '人聲錄音', '鋼琴', '鋼琴演奏', '長笛', '薩克斯', '古箏', '簫', '策劃', '統籌',
  '企劃', '營銷', '推廣', '宣傳', '設計', '插畫', '攝影', '導演', '特別鳴謝', '鳴謝',
  '版權', '版權所有', '專輯', '歌手', '演唱', '原唱', '製作統籌', '音樂總監',
  '藝術總監', '監唱', '配音', '後期', '混音助理', '錄音助理', '助理', '器樂',
  '演奏', '合音', '伴唱', '編程', '編寫',
])

/**
 * 后缀白名单：应付「同期录音师」「钢琴演奏」「人声编辑」这类带前缀的写法。
 * 只认这几个足够长的词，短词（如「曲」）走精确匹配，避免误伤歌词。
 */
const META_SUFFIX = [
  '录音师', '录音棚', '录音室', '混音师', '母带师', '工程师', '制作人',
  '演奏', '编写', '监制', '统筹', '策划', '设计', '摄影', '导演',
  '鸣谢', '助理', '编辑', '企划', '推广', '宣传',
  '錄音師', '錄音棚', '錄音室', '混音師', '母帶師', '工程師', '製作人',
  '演奏', '編寫', '監製', '統籌', '策劃', '設計', '攝影', '導演',
  '鳴謝', '助理', '編輯', '企劃', '推廣', '宣傳',
]

/** 行首连续的 [mm:ss.xx] 标签 */
const TIME_TAG_HEAD = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
/** LRC 的 ID 标签行：[ti:xxx] [ar:xxx] [offset:0] */
const ID_TAG_LINE = /^\[[a-zA-Z#]+:/
/** 只在这个时间点之前识别制作名单；之后的「曲：」一律当歌词 */
const META_SCAN_MS = 45_000

const toMs = (min, sec, frac) => {
  const m = parseInt(min, 10)
  const s = parseInt(sec, 10)
  // 与 lrc-file-parser 的 formatTimeLabel 保持一致：小数位右补到 3 位
  const f = frac ? parseInt(String(frac).padEnd(3, '0').slice(0, 3), 10) : 0
  return m * 60_000 + s * 1000 + f
}

/**
 * 拆出一行的全部时间标签与正文
 * @param {string} line
 * @returns {{ times: number[], text: string }}
 */
export const parseLyricLine = (line) => {
  const times = []
  let rest = line
  for (;;) {
    const m = TIME_TAG_HEAD.exec(rest)
    if (!m) break
    times.push(toMs(m[1], m[2], m[3]))
    rest = rest.slice(m[0].length)
  }
  return { times, text: rest.trim() }
}

/**
 * 判断一行正文是否是制作名单
 * @param {string} text 已经去掉时间标签的正文
 */
export const isMetadataLine = (text) => {
  if (!text) return false
  const m = /^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·\s]{0,11})[：:]\s*(.{1,60})$/.exec(text)
  if (!m) return false
  const key = m[1].replace(/\s+/g, '')
  const value = m[2].trim()
  if (!value) return false
  // 带句末标点的更像歌词（「他说：我不知道。」），制作名单不会这么写
  if (/[。！？!?]/.test(value)) return false
  if (META_KEYS.has(key)) return true
  return META_SUFFIX.some(suffix => key.endsWith(suffix) && key.length <= suffix.length + 6)
}

/**
 * 删除歌曲开头区域（默认前 45 秒）的制作名单
 *
 * 不能只看「第一行」：QQ 音乐常见结构是把第一句歌词打在 0 秒，紧接着才是
 * 词 / 曲 / 编曲 / 制作人 / 混音 / 母带 / 出品，然后又回到正文。只看开头
 * 连续块的话，第一句正文会把后面 8 行制作名单全保住，前奏照样在滚字幕。
 * 这里扫描前 45 秒（最多 200 行）内的所有行，命中白名单就删；
 * 45 秒之后即使出现「曲：」也不再处理，避免误删中段歌词。
 *
 * [ti:] / [ar:] / [offset:] 这类元信息标签解析器还要用，原样保留。
 * @param {string[]} lines
 */
export const stripLeadingMetadata = (lines) => {
  const drop = new Set()
  const limit = Math.min(lines.length, 200)
  for (let i = 0; i < limit; i++) {
    const { times, text } = parseLyricLine(lines[i])
    if (!text) continue
    if (ID_TAG_LINE.test(text)) continue
    if (!times.length) continue
    if (Math.min(...times) > META_SCAN_MS) continue
    if (!isMetadataLine(text)) continue
    drop.add(i)
  }
  if (!drop.size) return lines
  return lines.filter((_, i) => !drop.has(i))
}

/**
 * 规范化用于比较的文本：去掉空白、标点与大小写差异
 *
 * 只用于「判断两行是不是同一句」，不参与展示。
 */
export const normalizeLyricText = (text) => text
  .replace(/[\s\u3000]/g, '')
  .replace(/[，。！？、,.!?~～…—－·"'“”‘’()（）\u005B\u005D【】《》<>「」『』]/g, '')
  .toLowerCase()

/**
 * 合并时间相邻的重复行
 *
 * @param {string[]} lines
 * @param {number} windowMs 只看这个时间窗内的重复；窗口外的重复句保留
 */
export const dedupeAdjacentLines = (lines, windowMs = 1000) => {
  const out = []
  let last = null
  for (const line of lines) {
    const { times, text } = parseLyricLine(line)
    if (!text || !times.length) {
      out.push(line)
      continue
    }
    const key = normalizeLyricText(text)
    const time = times[0]
    if (last && key && key === last.key && Math.abs(time - last.time) <= windowMs) {
      // 丢弃后一条；若它带多个时间标签，说明是副歌复用行，保留第一个时间点即可
      continue
    }
    out.push(line)
    last = { key, time }
  }
  return out
}

/**
 * 清洗整份歌词文本
 * @param {string} raw
 * @param {{ stripMeta?: boolean, dedupe?: boolean, windowMs?: number }} [options]
 */
export const sanitizeLyricText = (raw, options = {}) => {
  if (!raw) return raw ?? ''
  const { stripMeta = true, dedupe = true, windowMs = 1000 } = options
  let lines = String(raw).split(/\r\n|\n|\r/)
  if (stripMeta) lines = stripLeadingMetadata(lines)
  if (dedupe) lines = dedupeAdjacentLines(lines, windowMs)
  return lines.join('\n')
}

/**
 * 返回清洗前后的统计，供测试与日志使用
 * @param {string} raw
 */
export const inspectLyricText = (raw) => {
  if (!raw) return { before: 0, after: 0, removedMeta: 0, removedDup: 0 }
  const lines = String(raw).split(/\r\n|\n|\r/)
  const noMeta = stripLeadingMetadata(lines)
  const final = dedupeAdjacentLines(noMeta)
  return {
    before: lines.length,
    after: final.length,
    removedMeta: lines.length - noMeta.length,
    removedDup: noMeta.length - final.length,
  }
}
