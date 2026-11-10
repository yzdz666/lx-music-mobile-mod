/**
 * 歌词测试夹具：可控时钟 + 模块加载
 *
 * 为什么要自己造时钟：
 * 歌词推进完全靠定时器 + wall clock（`getNow()`）。真等 30 秒跑一遍不可接受，
 * 而直接改 `_currentTime()` 又绕过了定时器链，测不到「卡住不推进」这类问题。
 * 这里用假的 performance.now + 可控 setTimeout，`advance(ms)` 一次把
 * 30 秒内的所有回调按时间顺序跑完，完全确定性。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname, '..')
export const DESKTOP_ROOT = path.resolve(ROOT, '..', 'lx-music-desktop-mod')

/** 可控时钟：虚拟时间 + 按到期顺序执行的回调队列 */
export function createClock() {
  let now = 0
  let seq = 0
  const timers = []

  return {
    now: () => now,
    setTimeout(fn, delay) {
      const id = ++seq
      timers.push({ id, at: now + Math.max(0, Number(delay) || 0), fn })
      return id
    },
    clearTimeout(id) {
      const index = timers.findIndex(timer => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
    /** 推进虚拟时间，期间按顺序执行所有到期回调 */
    advance(ms) {
      const target = now + ms
      let guard = 0
      while (true) {
        if (++guard > 500000) throw new Error('clock.advance 死循环：定时器在自身回调里无限重排')
        let next = null
        let nextIndex = -1
        for (let i = 0; i < timers.length; i++) {
          if (next === null || timers[i].at < next.at || (timers[i].at === next.at && timers[i].id < next.id)) {
            next = timers[i]
            nextIndex = i
          }
        }
        if (!next || next.at > target) break
        timers.splice(nextIndex, 1)
        now = next.at
        next.fn()
      }
      now = target
    },
  }
}

let shimInstalled = false
/** 给依赖 window / performance 的浏览器端模块装最小 shim */
export function installDomShim(clock) {
  if (shimInstalled) return
  shimInstalled = true
  const win = {
    performance: { now: () => clock.now() },
    requestAnimationFrame: (fn) => clock.setTimeout(() => fn(clock.now()), 16),
    cancelAnimationFrame: (id) => clock.clearTimeout(id),
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clearTimeout(id),
  }
  globalThis.window = win
  // Node 自带 performance 是只读的，用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    get: () => win.performance,
  })
}

/** 加载手机版打补丁后的 lrc-file-parser（App 内歌词解析） */
export async function loadPhoneParser() {
  const file = path.join(ROOT, 'node_modules/lrc-file-parser/dist/lrc-file-parser.esm.js')
  const url = `${pathToFileURL(file).href}?t=${Date.now()}`
  const mod = await import(url)
  return mod.default
}

/**
 * 加载电脑版 line-player（App 内 + 桌面歌词窗口共用）
 *
 * 原文件 `import { getNow, TimeoutTools } from './utils'` 没有扩展名，
 * Node 的 ESM 解析不了；这里把 import 换成测试桩，其余源码原样不动，
 * 保证测的是真实实现。
 */
export async function loadDesktopPlayer(clock) {
  const source = fs.readFileSync(path.join(DESKTOP_ROOT, 'src/common/utils/lyric-font-player/line-player.js'), 'utf8')
  const stubPath = path.join(os.tmpdir(), `lxlyric-stub-${process.pid}.mjs`)
  fs.writeFileSync(stubPath, `
let clock = null
export const setClock = (c) => { clock = c }
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
export const getNow = () => clock ? clock.now() : Date.now()
export class TimeoutTools {
  constructor() { this.timer = null; this.callback = null }
  start(callback, delay = 0) {
    this.clear()
    this.callback = callback
    const run = () => {
      const fire = () => {
        this.timer = null
        const fn = this.callback
        this.callback = null
        if (fn) fn()
      }
      if (clock) this.timer = clock.setTimeout(fire, Math.max(0, delay))
      else this.timer = realSetTimeout(fire, Math.max(0, delay))
    }
    run()
  }
  clear() {
    if (this.timer != null) {
      if (clock) clock.clearTimeout(this.timer)
      else realClearTimeout(this.timer)
      this.timer = null
    }
    this.callback = null
  }
}
setClock(null)
`)

  // 歌词清洗模块同样没有扩展名，复制成 .mjs 再用绝对路径引用
  const sanitizeSource = path.join(DESKTOP_ROOT, 'src/common/utils/lyric-font-player/lyricSanitize.js')
  const sanitizeTarget = path.join(os.tmpdir(), `lxlyric-sanitize-${process.pid}.mjs`)
  fs.copyFileSync(sanitizeSource, sanitizeTarget)

  const patched = source.replace(
    "import { getNow, TimeoutTools } from './utils'",
    `import { getNow, TimeoutTools, setClock } from ${JSON.stringify(pathToFileURL(stubPath).href)}`,
  ).replace(
    "from './lyricSanitize'",
    `from ${JSON.stringify(pathToFileURL(sanitizeTarget).href)}`,
  )
  const target = path.join(os.tmpdir(), `lxlyric-line-${process.pid}-${Date.now()}.mjs`)
  fs.writeFileSync(target, patched)

  // 必须先设置时钟再加载 player：stub 与 player 的 import 路径必须完全一致，
  // 否则会各自加载一份 stub，setClock 落在另一份实例上，getNow 永远是 0。
  const stubUrl = pathToFileURL(stubPath).href
  const { setClock } = await import(stubUrl)
  setClock(clock)
  const mod = await import(`${pathToFileURL(target).href}?t=${Date.now()}`)
  return mod.default
}

/**
 * Java 端 LyricPlayer 的算法镜像
 *
 * Android 原生歌词播放器无法在 Node 里直接跑（依赖 Handler/Context），
 * 这里按 `LyricPlayer.java` 的 `initLines` / `formatTimeLabel` / `normalizeTimeKey`
 * 逐行翻译成 JS，用来做「两端对拍」：同一份 LRC，JS 与 Java 算出的
 * 时间数组必须完全一致。任何一端再改动解析逻辑，对拍会立刻失败。
 */
export function mirrorJavaParser(lyric, extendedLyrics = []) {
  const timeFieldExp = /^(?:\[[\d:.]+\])+/g
  const timeExp = /\d{1,3}(:\d{1,3}){0,2}(?:\.\d{1,3})/g

  const formatTimeLabel = (label) => label.replace(/^0+(\d+)/, '$1').replace(/:0+(\d+)/g, ':$1')
  const normalizeTimeKey = (label) => {
    const dot = label.lastIndexOf('.')
    if (dot < 0) return `${label}.000`
    let frac = label.slice(dot + 1)
    if (frac.length > 3) frac = frac.slice(0, 3)
    while (frac.length < 3) frac += '0'
    return label.slice(0, dot + 1) + frac
  }
  const padEnd = (str, length, char) => str.length >= length ? str : str + String(char).repeat(length - str.length)

  const linesMap = new Map()
  for (const raw of lyric.split(/\r\n|\n|\r/)) {
    const line = raw.trim()
    const matched = timeFieldExp.exec(line)
    if (!matched) continue
    const timeField = matched[0]
    const text = line.replace(timeFieldExp, '').trim()
    if (!text) continue
    const times = timeField.match(timeExp)
    if (!times) continue
    for (const time of times) {
      const timeStr = normalizeTimeKey(formatTimeLabel(time))
      if (linesMap.has(timeStr)) {
        linesMap.get(timeStr).extendedLyrics.push(text)
        continue
      }
      const parts = timeStr.split(':')
      let hours, minutes, seconds
      if (parts.length === 3) [hours, minutes, seconds] = parts
      else if (parts.length === 2) { hours = '0'; [minutes, seconds] = parts }
      else if (parts.length === 1) { hours = '0'; minutes = '0'; seconds = parts[0] }
      else continue
      let ms = '0'
      if (seconds.includes('.')) {
        const split = seconds.split('.')
        seconds = split[0]
        let msStr = split[1] ?? '0'
        if (msStr.length > 3) msStr = msStr.slice(0, 3)
        ms = padEnd(msStr, 3, '0')
      }
      linesMap.set(timeStr, {
        time: parseInt(hours, 10) * 3600000 + parseInt(minutes, 10) * 60000 + parseInt(seconds, 10) * 1000 + parseInt(ms, 10),
        text,
        extendedLyrics: [],
      })
    }
  }

  for (const ext of extendedLyrics) {
    for (const raw of ext.split(/\r\n|\n|\r/)) {
      const line = raw.trim()
      const matched = timeFieldExp.exec(line)
      if (!matched) continue
      const timeField = matched[0]
      const text = line.replace(timeFieldExp, '').trim()
      if (!text || text === '//') continue
      const times = timeField.match(timeExp)
      if (!times) continue
      for (const time of times) {
        const key = normalizeTimeKey(formatTimeLabel(time))
        const target = linesMap.get(key)
        if (target) target.extendedLyrics.push(text)
      }
    }
  }

  return [...linesMap.values()].sort((a, b) => a.time - b.time)
}

export function readFixture(name) {
  return fs.readFileSync(path.join(new URL('.', import.meta.url).pathname, 'fixtures', name), 'utf8')
}
