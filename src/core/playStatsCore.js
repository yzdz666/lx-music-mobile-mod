/**
 * 听歌记账内核（纯逻辑，不依赖 React Native / 存储 / 全局状态）
 *
 * 抽出来的原因：真正的记账口径（累计时长、有效播放阈值、单曲循环重开）必须
 * 能被 node 直接跑起来测试。之前在 playStats.ts 里和事件、存储混在一起，
 * 只能靠人工点 App 验证，结果「首次播放不记账」「播放中报告恒为 0」两个
 * 问题一直没被发现。
 *
 * 记账规则：
 *   - 累计播放 ≥ minSeconds（默认 30 秒），或 ≥ 歌曲时长 × minRatio（默认 0.5），
 *     才算「一次有效播放」；一次会话最多计一次。
 *   - 时长按「真正处于播放状态的时间」累计，暂停后不计。
 *   - flush() 可反复调用，每次只返回「上次 flush 之后新增的秒数」，
 *     所以播放中也能定期落账，不用等切歌。
 */

const thresholdMs = (maxPlayTime, minSeconds, minRatio) => {
  if (!(maxPlayTime > 0)) return minSeconds * 1000
  return Math.min(minSeconds, (maxPlayTime / 1000) * minRatio) * 1000
}

/**
 * @param {object} [options]
 * @param {() => number} [options.now] 取当前时间（测试可注入假时钟）
 * @param {number} [options.minSeconds] 有效播放的最短秒数
 * @param {number} [options.minRatio] 有效播放占整首歌的比例
 */
export const createTracker = ({ now = () => Date.now(), minSeconds = 30, minRatio = 0.5 } = {}) => {
  let session = null

  const start = (music, maxPlayTime = 0) => {
    if (!music || music.id == null || music.id === '') return false
    session = {
      key: `${music.source == null ? '' : music.source}:${music.id}`,
      name: music.name || '',
      singer: music.singer || '',
      source: music.source == null ? '' : music.source,
      accumMs: 0,
      settledMs: 0,
      counted: false,
      playing: false,
      startedAt: 0,
      maxPlayTime: maxPlayTime > 0 ? maxPlayTime : 0,
      lastPosition: 0,
    }
    return true
  }

  const current = () => session

  const isPlaying = () => !!session && session.playing

  /** 开始播放；已在播放中返回 false */
  const play = () => {
    if (!session || session.playing) return false
    session.playing = true
    session.startedAt = now()
    return true
  }

  /** 暂停：把这一段折进 accumMs */
  const pause = () => {
    if (!session || !session.playing) return false
    session.accumMs += now() - session.startedAt
    session.playing = false
    return true
  }

  /**
   * 取增量。返回 null 表示不足 1 秒、没有可落账的内容。
   * 返回的 sec 只包含「这次新增」的部分，调用方直接累加即可。
   */
  const flush = () => {
    if (!session) return null
    const total = session.accumMs + (session.playing ? now() - session.startedAt : 0)
    const deltaMs = total - session.settledMs
    if (deltaMs < 1000) return null

    const sec = Math.floor(deltaMs / 1000)
    session.settledMs += sec * 1000

    const counted = !session.counted && session.settledMs >= thresholdMs(session.maxPlayTime, minSeconds, minRatio)
    if (counted) session.counted = true

    return {
      sec,
      counted,
      key: session.key,
      name: session.name,
      singer: session.singer,
      source: session.source,
      at: now(),
    }
  }

  /** 结束会话：先结算，再丢弃 */
  const finish = () => {
    const result = flush()
    session = null
    return result
  }

  /**
   * 报告播放位置，返回 true 表示「从后段突然回到开头」= 单曲循环重播。
   * 只判断，不重开会话（重开要由调用方决定，避免丢掉上一轮的计数）。
   */
  const rewind = (position) => {
    if (!session) return false
    const prev = session.lastPosition
    session.lastPosition = position
    return prev > 3000 && position < 2000
  }

  /** 当前会话已结算 + 未结算的总秒数（测试与调试用） */
  const elapsedSec = () => session
    ? Math.floor((session.accumMs + (session.playing ? now() - session.startedAt : 0)) / 1000)
    : 0

  return { start, current, isPlaying, play, pause, flush, finish, rewind, elapsedSec }
}
