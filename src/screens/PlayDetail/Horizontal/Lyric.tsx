import { memo, useMemo, useEffect, useRef, useCallback, useState } from 'react'
import { View, FlatList, type FlatListProps, type NativeSyntheticEvent, type NativeScrollEvent, type LayoutChangeEvent } from 'react-native'
// import { useLayout } from '@/utils/hooks'
import { type Line, useLrcPlay, useLrcSet, useWordLyricLines } from '@/plugins/lyric'
import { createStyle } from '@/utils/tools'
// import { useComponentIds } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { AnimatedColorText } from '@/components/common/Text'
import WordLyricText from '@/components/common/WordLyricText'
import type { WordLyricLine } from '@/utils/wordLyric'
import { findWordLine } from '@/utils/wordLyric'
import { setSpText } from '@/utils/pixelRatio'
import playerState from '@/store/player/state'
import { scrollTo } from '@/utils/scroll'
import { getApproxLineOffset, getLineOffset, getScrollTop } from '@/utils/lyricScroll'
import PlayLine, { type PlayLineType } from '../components/PlayLine'
// import { screenkeepAwake } from '@/utils/nativeModules/utils'
// import { log } from '@/utils/log'
// import { toast } from '@/utils/tools'

type FlatListType = FlatListProps<Line>

interface LineProps {
  line: Line
  lineNum: number
  activeLine: number
  wordLine?: WordLyricLine
  onLayout: (lineNum: number, height: number, width: number) => void
}
const LrcLine = memo(({ line, lineNum, activeLine, wordLine, onLayout }: LineProps) => {
  const theme = useTheme()
  const lrcFontSize = useSettingValue('playDetail.horizontal.style.lrcFontSize')
  const textAlign = useSettingValue('playDetail.style.align')
  const size = lrcFontSize / 10
  const lineHeight = setSpText(size) * 1.3

  const colors = useMemo(() => {
    const active = activeLine == lineNum
    return active ? [
      theme['c-primary'],
      theme['c-primary-alpha-200'],
      1,
    ] as const : [
      theme['c-350'],
      theme['c-300'],
      0.6,
    ] as const
  }, [activeLine, lineNum, theme])

  const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    onLayout(lineNum, nativeEvent.layout.height, nativeEvent.layout.width)
  }

  // textBreakStrategy="simple" 用于解决某些设备上字体被截断的问题
  // https://stackoverflow.com/a/72822360
  return (
    <View style={styles.line} onLayout={handleLayout}>
      {
        activeLine == lineNum && wordLine
          ? (
            <WordLyricText
              wordLine={wordLine}
              size={size}
              lineHeight={lineHeight}
              textAlign={textAlign}
              activeColor={colors[0]}
              inactiveColor={theme['c-350']}
            />
            )
          : (
            <AnimatedColorText style={{
              ...styles.lineText,
              textAlign,
              lineHeight,
            }} textBreakStrategy="simple" color={colors[0]} opacity={colors[2]} size={size} duration={220}>{line.text}</AnimatedColorText>
            )
      }
      {
        line.extendedLyrics.map((lrc, index) => {
          // 译文与正文是同一句时不重复渲染（数据层已去重，这里兜底）
          if (lrc == line.text) return null
          return (<AnimatedColorText style={{
            ...styles.lineTranslationText,
            textAlign,
            lineHeight: lineHeight * 0.8,
          }} textBreakStrategy="simple" key={index} color={colors[1]} opacity={colors[2]} size={size * 0.8} duration={220}>{lrc}</AnimatedColorText>)
        })
      }
    </View>
  )
}, (prevProps, nextProps) => {
  return prevProps.line === nextProps.line &&
    prevProps.wordLine === nextProps.wordLine &&
    prevProps.activeLine != nextProps.lineNum &&
    nextProps.activeLine != nextProps.lineNum
})

export default () => {
  const lyricLines = useLrcSet()
  const wordLines = useWordLyricLines()
  // 与 Vertical/Lyric.tsx 一致：按时间就近匹配，而不是 ±10ms 的严格查表
  /**
   * 按行找对应的逐字数据，并校验「确实是同一句」。
   *
   * 主歌词（lrc）和逐字（lxlyric）是两份文本，切歌瞬间两套 hook 的更新不是原子的，
   * 时间又刚好落在 ±400ms 容差内，就会把上一首（或上一段）的逐字贴到这一句上，
   * 表现为歌词串行、叠字、句子内容对不上。
   */
  const wordLineFor = (item: Line) => {
    const wl = findWordLine(wordLines, item.time)
    if (!wl) return
    const a = wl.text.replace(/\s/g, '')
    const b = item.text.replace(/\s/g, '')
    if (!a || !b) return
    if (a === b) return wl
    // 标点、异体字允许有出入，长度差太远就判定为串行
    if (Math.abs(a.length - b.length) > Math.max(2, b.length / 3)) return
    return wl
  }
  const { line: lrcLine } = useLrcPlay()
  // 同竖屏：逐字数据的最后一个字可能跨过下一行，宽限一下让最后一段唱完
  const [graceLine, setGraceLine] = useState(-1)
  useEffect(() => {
    if (lrcLine <= 0 || !lyricLines.length) {
      setGraceLine(-1)
      return
    }
    const prevWord = wordLineFor(lyricLines[lrcLine - 1])
    const last = prevWord?.words[prevWord.words.length - 1]
    if (!last) {
      setGraceLine(-1)
      return
    }
    const over = last.time + Math.max(1, last.duration) - (lyricLines[lrcLine]?.time ?? 0)
    if (over <= 0) {
      setGraceLine(-1)
      return
    }
    setGraceLine(lrcLine - 1)
    const timer = setTimeout(() => {
      setGraceLine(-1)
    }, Math.min(over, 800))
    return () => {
      clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lrcLine, lyricLines, wordLines])
  const activeLine = graceLine >= 0 && graceLine == lrcLine - 1 ? graceLine : lrcLine
  const flatListRef = useRef<FlatList>(null)
  const playLineRef = useRef<PlayLineType>(null)
  const isPauseScrollRef = useRef(true)
  const scrollTimoutRef = useRef<NodeJS.Timeout | null>(null)
  const delayScrollTimeout = useRef<NodeJS.Timeout | null>(null)
  const lineRef = useRef({ line: 0, prevLine: 0 })
  const isFirstSetLrc = useRef(true)
  const scrollInfoRef = useRef<NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'] | null>(null)
  const listLayoutInfoRef = useRef<{ spaceHeight: number, lineHeights: number[] }>({ spaceHeight: 0, lineHeights: [] })
  const scrollCancelRef = useRef<(() => void) | null>(null)
  /** 实时内容/视口高度：用于修正 scrollTo 的滚动上限，不能用 onScroll 里的旧快照 */
  const contentSizeRef = useRef({ height: 0, viewport: 0 })
  const isShowLyricProgressSetting = useSettingValue('playDetail.isShowLyricProgressSetting')
  // useLock()
  // const [imgUrl, setImgUrl] = useState(null)
  // const theme = useGetter('common', 'theme')
  // const { onLayout, ...layout } = useLayout()

  // useEffect(() => {
  //   const url = playMusicInfo ? playMusicInfo.musicInfo.img : null
  //   if (imgUrl == url) return
  //   setImgUrl(url)
  // // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [playMusicInfo])

  // const imgWidth = useMemo(() => layout.width * 0.75, [layout.width])
  const handleScrollToActive = (index = lineRef.current.line) => {
    if (index < 0) return
    const list = flatListRef.current
    if (!list) return
    const info = scrollInfoRef.current
    const isStep = lineRef.current.line - lineRef.current.prevLine == 1
    // 行高还没测量全（切歌清空、跳行、FlatList 还没渲染到）时不能累加，
    // 否则算出来的偏移偏小，滚动被截断，高亮行会一路往下漂 —— 表现为歌词卡住
    const lineOffset = info && isStep
      ? getLineOffset(listLayoutInfoRef.current.lineHeights, listLayoutInfoRef.current.spaceHeight, index)
      : null

    if (info && lineOffset != null) {
      const { height, viewport } = contentSizeRef.current
      const maxScrollTop = height > 0 && viewport > 0
        ? Math.max(0, height - viewport)
        : undefined
      try {
        scrollCancelRef.current = scrollTo(list, info, getScrollTop(lineOffset, info.layoutMeasurement.height), 600, () => {
          scrollCancelRef.current = null
        }, 0, maxScrollTop)
        return
      } catch {}
    }

    if (scrollCancelRef.current) {
      scrollCancelRef.current()
      scrollCancelRef.current = null
    }
    try {
      list.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.42,
      })
    } catch {}
  }

  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollInfoRef.current = nativeEvent
    if (isPauseScrollRef.current) {
      playLineRef.current?.updateScrollInfo(nativeEvent)
    }
  }
  const handleScrollBeginDrag = () => {
    isPauseScrollRef.current = true
    playLineRef.current?.setVisible(true)
    if (delayScrollTimeout.current) {
      clearTimeout(delayScrollTimeout.current)
      delayScrollTimeout.current = null
    }
    if (scrollTimoutRef.current) {
      clearTimeout(scrollTimoutRef.current)
      scrollTimoutRef.current = null
    }
    if (scrollCancelRef.current) {
      scrollCancelRef.current()
      scrollCancelRef.current = null
    }
  }

  const onScrollEndDrag = () => {
    if (!isPauseScrollRef.current) return
    if (scrollTimoutRef.current) clearTimeout(scrollTimoutRef.current)
    scrollTimoutRef.current = setTimeout(() => {
      playLineRef.current?.setVisible(false)
      scrollTimoutRef.current = null
      isPauseScrollRef.current = false
      if (!playerState.isPlay) return
      handleScrollToActive()
    }, 3000)
  }


  useEffect(() => {
    return () => {
      if (delayScrollTimeout.current) {
        clearTimeout(delayScrollTimeout.current)
        delayScrollTimeout.current = null
      }
      if (scrollTimoutRef.current) {
        clearTimeout(scrollTimoutRef.current)
        scrollTimoutRef.current = null
      }
      // 同 Vertical/Lyric.tsx：平滑滚动是定时器循环，卸载后必须停
      if (scrollCancelRef.current) {
        scrollCancelRef.current()
        scrollCancelRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    // linesRef.current = lyricLines
    listLayoutInfoRef.current.lineHeights = []
    lineRef.current.prevLine = 0
    lineRef.current.line = 0
    if (!flatListRef.current) return
    flatListRef.current.scrollToOffset({
      offset: 0,
      animated: false,
    })
    if (!lyricLines.length) return
    playLineRef.current?.updateLyricLines(lyricLines)
    requestAnimationFrame(() => {
      if (isFirstSetLrc.current) {
        isFirstSetLrc.current = false
        setTimeout(() => {
          isPauseScrollRef.current = false
          handleScrollToActive()
        }, 100)
      } else {
        if (delayScrollTimeout.current) clearTimeout(delayScrollTimeout.current)
        delayScrollTimeout.current = setTimeout(() => {
          handleScrollToActive(0)
        }, 100)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricLines])

  useEffect(() => {
    if (lrcLine < 0) return
    lineRef.current.prevLine = lineRef.current.line
    lineRef.current.line = lrcLine
    if (!flatListRef.current || isPauseScrollRef.current) return

    if (lrcLine - lineRef.current.prevLine != 1) {
      handleScrollToActive()
      return
    }

    if (delayScrollTimeout.current) clearTimeout(delayScrollTimeout.current)
    delayScrollTimeout.current = setTimeout(() => {
      delayScrollTimeout.current = null
      handleScrollToActive()
    }, 600)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lrcLine])

  useEffect(() => {
    requestAnimationFrame(() => {
      playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
      playLineRef.current?.updateLyricLines(lyricLines)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShowLyricProgressSetting])

  const handleScrollToIndexFailed: FlatListType['onScrollToIndexFailed'] = (info) => {
    // 同 Vertical/Lyric.tsx：盲目重试会无限递归，先按已知行高粗滚到附近再精确跳一次
    const offset = getApproxLineOffset(
      listLayoutInfoRef.current.lineHeights,
      listLayoutInfoRef.current.spaceHeight,
      info.index,
      info.averageItemLength || 40,
    )
    requestAnimationFrame(() => {
      try {
        flatListRef.current?.scrollToOffset({ offset, animated: false })
      } catch {}
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.42 })
        } catch {}
      }, 80)
    })
  }

  const handleLineLayout = useCallback<LineProps['onLayout']>((lineNum, height) => {
    listLayoutInfoRef.current.lineHeights[lineNum] = height
    playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
  }, [])

  const handleSpaceLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    listLayoutInfoRef.current.spaceHeight = nativeEvent.layout.height
    playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
  }, [])

  const handlePlayLine = useCallback((time: number) => {
    playLineRef.current?.setVisible(false)
    global.app_event.setProgress(time)
  }, [])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => {
    return (
      <LrcLine line={item} lineNum={index} activeLine={activeLine} wordLine={wordLineFor(item)} onLayout={handleLineLayout} />
    )
  }
  const getkey: FlatListType['keyExtractor'] = (item, index) => `${index}${item.text}`

  const spaceComponent = useMemo(() => (
    <View style={styles.space} onLayout={handleSpaceLayout}></View>
  ), [handleSpaceLayout])

  return (
    <>
      <FlatList
        data={lyricLines}
        renderItem={renderItem}
        keyExtractor={getkey}
        style={styles.container}
        ref={flatListRef}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={spaceComponent}
        ListFooterComponent={spaceComponent}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        fadingEdgeLength={100}
        initialNumToRender={Math.max(lrcLine + 10, 10)}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onScroll={handleScroll}
        onContentSizeChange={(width, height) => { contentSizeRef.current.height = height }}
        onLayout={({ nativeEvent }) => { contentSizeRef.current.viewport = nativeEvent.layout.height }}
      />
      { isShowLyricProgressSetting ? <PlayLine ref={playLineRef} onPlayLine={handlePlayLine} /> : null }
    </>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    paddingLeft: 20,
    paddingRight: 20,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
  space: {
    paddingTop: '100%',
  },
  line: {
    paddingTop: 10,
    paddingBottom: 10,
    // opacity: 0,
  },
  lineText: {
    textAlign: 'center',
    // fontSize: 16,
    // lineHeight: 20,
    // paddingTop: 5,
    // paddingBottom: 5,
    // opacity: 0,
  },
  lineTranslationText: {
    textAlign: 'center',
    // fontSize: 13,
    // lineHeight: 17,
    paddingTop: 5,
    // paddingBottom: 5,
  },
})
