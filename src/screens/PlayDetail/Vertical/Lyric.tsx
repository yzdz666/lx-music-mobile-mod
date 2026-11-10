import { memo, useMemo, useEffect, useRef, useState, useCallback } from 'react'
import { View, FlatList, type FlatListProps, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native'
// import { useLayout } from '@/utils/hooks'
import { type Line, useLrcPlay, useLrcSet, useWordLyricLines } from '@/plugins/lyric'
import { createStyle } from '@/utils/tools'
// import { useComponentIds } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { AnimatedColorText } from '@/components/common/Text'
import WordLyricText from '@/components/common/WordLyricText'
import { findWordLine } from '@/utils/wordLyric'
import type { WordLyricLine } from '@/utils/wordLyric'
import { setSpText } from '@/utils/pixelRatio'
import playerState from '@/store/player/state'
import { scrollTo } from '@/utils/scroll'
import { getApproxLineOffset, getLineOffset, getScrollTop } from '@/utils/lyricScroll'
import PlayLine, { type PlayLineType } from '../components/PlayLine'
// import { screenkeepAwake } from '@/utils/nativeModules/utils'
// import { log } from '@/utils/log'
// import { toast } from '@/utils/tools'

type FlatListType = FlatListProps<Line>

// const useLock = () => {
//   const showCommentRef = useRef(false)


//   useEffect(() => {
//     let appstateListener = AppState.addEventListener('change', (state) => {
//       switch (state) {
//         case 'active':
//           if (showLyricRef.current && !showCommentRef.current) screenkeepAwake()
//           break
//         case 'background':
//           screenUnkeepAwake()
//           break
//       }
//     })
//     return () => {
//       appstateListener.remove()
//     }
//   }, [])
//   useEffect(() => {
//     let listener: ReturnType<typeof onNavigationComponentDidDisappearEvent>
//     showCommentRef.current = !!componentIds.comment
//     if (showCommentRef.current) {
//       if (showLyricRef.current) screenUnkeepAwake()
//       listener = onNavigationComponentDidDisappearEvent(componentIds.comment as string, () => {
//         if (showLyricRef.current && AppState.currentState == 'active') screenkeepAwake()
//       })
//     }

//     const rm = global.state_event.on('componentIdsUpdated', (ids) => {

//     })

//     return () => {
//       if (listener) listener.remove()
//     }
//   }, [])
// }

interface LineProps {
  line: Line
  lineNum: number
  activeLine: number
  wordLine?: WordLyricLine
  onLayout: (lineNum: number, height: number, width: number) => void
}
const LrcLine = memo(({ line, lineNum, activeLine, wordLine, onLayout }: LineProps) => {
  const theme = useTheme()
  const lrcFontSize = useSettingValue('playDetail.vertical.style.lrcFontSize')
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
  /**
   * 按行找对应的逐字数据，并校验「确实是同一句」。
   *
   * 主歌词（lrc）与逐字歌词（lxlyric）是两份文本，时间戳常有几十毫秒出入，
   * 所以按 ±400ms 就近匹配（1.22.24 用 `Math.round(time / 20)` 做 Map key 只容忍
   * ±10ms，对不上就悄悄退化成整行渲染，表现为「有时有逐字有时没有」）。
   *
   * 但切歌瞬间两套 hook 的更新不是原子的，时间又刚好落在容差内时，
   * 会把上一首（或上一段）的逐字贴到这一句上，表现为歌词串行、叠字、内容对不上。
   * 所以这里再比一次文本，长度差太多就放弃逐字，退回整行渲染。
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
  /**
   * 显示用的当前行（可能比解析器晚一行）。
   *
   * 逐字歌词和主歌词是两份数据，最后一个字的结束时间经常比下一行的开始时间
   * 还晚几十到几百毫秒（两个音源各自打轴）。解析器按「下一行开始时间」切行，
   * 一到这里就把 WordLyricText 卸载掉，最后那一段字永远不会亮 —— 也就是
   * 「每句最后一个字不完整」。
   *
   * 所以这里做一次宽限：只要上一行的最后一个字确实跨过了下一行的时间，
   * 就让上一行继续当当前行，最多 over 毫秒（上限 800ms 防止脏数据卡死）。
   */
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
  // wordLineFor 每次渲染都是新函数，且只依赖 wordLines，这里按需忽略
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
      // 平滑滚动是 10ms 一步的 setTimeout 循环，卸载后不停会继续对已销毁的
      // FlatList 调 scrollToOffset
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

    // 快速连播时上一行的延迟还没到期就来了新行，旧的必须清掉，
    // 否则多个 600ms 定时器叠在一起，一帧里连发几次 scrollTo
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
    // 目标行还没进入渲染窗口时 FlatList 跳不过去。原实现是 100ms 后直接重试，
    // 每次都失败就会无限递归（快歌 / 切歌到很靠后的行时容易撞上，表现为歌词卡住 + 掉帧）。
    // 这里先按「已知行高 + 平均行高」粗滚到目标附近，让目标行进入渲染窗口，再补一次精确跳转。
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
