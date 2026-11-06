import { useEffect, useState } from 'react'
import Lyric, { type Lines } from 'lrc-file-parser'
import { parseWordLyric, type WordLyricLine } from '@/utils/wordLyric'
// import { getStore, subscribe } from '@/store'
export type Line = Lines[number]
type PlayHook = (line: number, text: string) => void
type SetLyricHook = (lines: Lines) => void

const lrcTools = {
  isInited: false,
  lrc: null as Lyric | null,
  currentLineData: { line: 0, text: '' },
  currentLines: [] as Lines,
  /** 逐字歌词（解析后的行+字时间），无逐字数据为空数组（1.16.0） */
  currentWordLines: [] as WordLyricLine[],
  playHooks: [] as PlayHook[],
  setLyricHooks: [] as SetLyricHook[],
  isPlay: false,
  isShowTranslation: false,
  isShowRoma: false,
  lyricText: '',
  translationText: '' as string | null | undefined,
  romaText: '' as string | null | undefined,
  lxlyricText: '' as string | null | undefined,
  init() {
    if (this.isInited) return
    this.isInited = true
    this.lrc = new Lyric({
      onPlay: this.onPlay.bind(this),
      onSetLyric: this.onSetLyric.bind(this),
      offset: 100, // offset time(ms), default is 150 ms
    })
  },
  onPlay(line: number, text: string) {
    this.currentLineData.line = line
    // console.log(line)
    this.currentLineData.text = text
    for (const hook of this.playHooks) hook(line, text)
  },
  onSetLyric(lines: Lines) {
    this.currentLines = lines
    this.currentLineData.line = 0
    this.currentLineData.text = ''
    for (const hook of this.playHooks) hook(-1, '')
    for (const hook of this.setLyricHooks) hook(lines)
  },
  addPlayHook(hook: PlayHook) {
    this.playHooks.push(hook)
    hook(this.currentLineData.line, this.currentLineData.text)
  },
  removePlayHook(hook: PlayHook) {
    this.playHooks.splice(this.playHooks.indexOf(hook), 1)
  },
  addSetLyricHook(hook: SetLyricHook) {
    this.setLyricHooks.push(hook)
    hook(this.currentLines)
  },
  removeSetLyricHook(hook: SetLyricHook) {
    this.setLyricHooks.splice(this.setLyricHooks.indexOf(hook), 1)
  },
  setLyric() {
    const extendedLyrics = [] as string[]
    if (this.isShowTranslation && this.translationText) extendedLyrics.push(this.translationText)
    if (this.isShowRoma && this.romaText) extendedLyrics.push(this.romaText)
    this.lrc!.setLyric(this.lyricText, extendedLyrics)
  },
}


export const init = async() => {
  lrcTools.init()
}

export const setLyric = (lyric: string, translation?: string, romalrc?: string, lxlyric?: string) => {
  lrcTools.isPlay = false
  lrcTools.lyricText = lyric
  lrcTools.translationText = translation
  lrcTools.romaText = romalrc
  lrcTools.lxlyricText = lxlyric
  lrcTools.currentWordLines = parseWordLyric(lxlyric)
  lrcTools.setLyric()
}

/** 订阅当前播放行变化（非 hook，供 core 层锁屏歌词等使用） */
export const onLrcLinePlay = (hook: PlayHook) => {
  lrcTools.addPlayHook(hook)
  return () => {
    lrcTools.removePlayHook(hook)
  }
}
/** 当前逐字歌词（无逐字数据时为空数组，UI 回退整行渲染） */
export const useWordLyricLines = () => {
  const [lines, setLines] = useState(lrcTools.currentWordLines)
  useEffect(() => {
    const callback: SetLyricHook = () => {
      setLines(lrcTools.currentWordLines)
    }
    lrcTools.addSetLyricHook(callback)
    return () => {
      lrcTools.removeSetLyricHook(callback)
    }
  }, [])
  return lines
}
export const setPlaybackRate = (playbackRate: number) => {
  lrcTools.lrc!.setPlaybackRate(playbackRate)
}
export const toggleTranslation = (isShow: boolean) => {
  lrcTools.isShowTranslation = isShow
  if (!lrcTools.lyricText) return
  lrcTools.setLyric()
}
export const toggleRoma = (isShow: boolean) => {
  lrcTools.isShowRoma = isShow
  if (!lrcTools.lyricText) return
  lrcTools.setLyric()
}
export const play = (time: number) => {
  // console.log(time)
  lrcTools.isPlay = true
  lrcTools.lrc!.play(time)
}

/**
 * 用指定位置重排歌词（不做「先暂停再播放」的中间态）
 *
 * `lrc.play()` 内部第一件事是 `pause()`，而 `pause()` 会用「当前内部时钟」算一次
 * 行号并回调 onPlay。音频缓冲过之后内部时钟是超前的，这一下会先跳到后面那句，
 * 再被 play 拉回来 —— 用户看到歌词闪一下。把 isPlay 先置 false，pause() 会直接
 * return，跳过的只是这次多余的回调，时间轴仍然由 play(time) 完整重置。
 */
export const resync = (time: number) => {
  const lrc = lrcTools.lrc
  if (!lrc) return
  lrc.isPlay = false
  lrcTools.isPlay = true
  lrc.play(time)
}
export const pause = () => {
  // console.log('pause')
  lrcTools.isPlay = false
  lrcTools.lrc!.pause()
}

/**
 * 暂停状态下把歌词定位到指定位置（不启动播放）
 *
 * lrc-file-parser 没有「只 seek 不播放」的接口。play(time) 会按新位置重排行号
 * 并回调 onPlay，紧接着 pause() 把刚排上的定时器清掉即可 —— 行号已经落位，
 * 而且不会让歌词在暂停时自己往前跑。
 * 拖动进度条后，App 内歌词不需要等下一次播放事件才跳行。
 */
export const seekPaused = (time: number) => {
  const lrc = lrcTools.lrc
  if (!lrc) return
  lrcTools.isPlay = false
  lrc.play(time)
  lrc.pause()
}

// on lyric play hook
export const useLrcPlay = (autoUpdate = true) => {
  const [lrcInfo, setLrcInfo] = useState(lrcTools.currentLineData)
  useEffect(() => {
    if (!autoUpdate) return
    const setLrcCallback: SetLyricHook = () => {
      setLrcInfo({ line: 0, text: '' })
    }
    const playCallback: PlayHook = (line, text) => {
      setLrcInfo({ line, text })
    }
    lrcTools.addSetLyricHook(setLrcCallback)
    lrcTools.addPlayHook(playCallback)
    setLrcInfo(lrcTools.currentLineData)
    return () => {
      lrcTools.removeSetLyricHook(setLrcCallback)
      lrcTools.removePlayHook(playCallback)
    }
  }, [autoUpdate])

  return lrcInfo
}

// on lyric set hook
export const useLrcSet = () => {
  const [lines, setLines] = useState<Lines>(lrcTools.currentLines)
  useEffect(() => {
    const callback = (lines: Lines) => {
      setLines(lines)
    }
    lrcTools.addSetLyricHook(callback)
    return () => { lrcTools.removeSetLyricHook(callback) }
  }, [])

  return lines
}

