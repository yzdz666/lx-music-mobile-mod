import { type NativeScrollEvent, type FlatList, type NativeSyntheticEvent } from 'react-native'

const easeInOutQuad = (t: number, b: number, c: number, d: number): number => {
  t /= d / 2
  if (t < 1) return (c / 2) * t * t + b
  t--
  return (-c / 2) * (t * (t - 2) - 1) + b
}

type Noop = () => void
const noop: Noop = () => {}

type ScrollElement<T> = {
  lx_scrollLockKey?: number
  lx_scrollNextParams?: [ScrollElement<FlatList<any>>, NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'], number, number, Noop, number | undefined]
  lx_scrollTimeout?: NodeJS.Timeout
  lx_scrollDelayTimeout?: NodeJS.Timeout
} & T

/**
 * 按像素平滑滚动
 *
 * `maxScrollTop`：内容能滚动到的最大距离。必须由调用方用「当下的」内容高度算好传进来 ——
 * `info` 是上一次 onScroll 的快照，切歌 / 歌词行数变化后它的 contentSize 是旧的，
 * 用旧值钳制会把目标位置截短，列表滚不到位，看起来就是歌词卡住、高亮行一路往下漂。
 */
const handleScrollY = (element: ScrollElement<FlatList<any>>, info: NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'], to: number, duration = 300, fn = noop, maxScrollTop?: number): Noop => {
  if (element == null) {
    fn()
    return noop
  }

  const clean = () => {
    element.lx_scrollLockKey = undefined
    element.lx_scrollNextParams = undefined
    if (element.lx_scrollTimeout) clearTimeout(element.lx_scrollTimeout)
    element.lx_scrollTimeout = undefined
  }
  if (element.lx_scrollLockKey) {
    element.lx_scrollNextParams = [element, info, to, duration, fn, maxScrollTop]
    element.lx_scrollLockKey = -1
    return clean
  }


  let start = info.contentOffset.y
  if (to > start) {
    const limit = maxScrollTop ?? (info.contentSize.height - info.layoutMeasurement.height)
    if (limit >= 0 && to > limit) to = limit
  } else if (to < start) {
    if (to < 0) to = 0
  } else {
    fn()
    return noop
  }
  let change = to - start
  const increment = 10
  if (!change) {
    fn()
    return noop
  }

  let currentTime = 0
  let val: number
  let key = Math.random()

  const animateScroll = () => {
    element.lx_scrollTimeout = undefined
    // if (element.lx_scrollNextParams && currentTime > duration * 0.75) {
    //   const [_element, info, _to, duration, fn] = element.lx_scrollNextParams
    //   if (to > _to && info.contentOffset.y < val) info.contentOffset.y = val
    //   clean()
    //   handleScrollY(_element, info, _to, duration, fn)
    //   return
    // }
    // if (element.lx_scrollLockKey != key) {
    //   if (element.lx_scrollNextParams) {
    //     // element.lx_scrollNextParams[1].contentOffset.y = val
    //     // handleScrollY(element.lx_scrollNextParams[0], element.lx_scrollNextParams[1], element.lx_scrollNextParams[2], element.lx_scrollNextParams[3], element.lx_scrollNextParams[4])
    //     start = val
    //     info = element.lx_scrollNextParams[1]
    //     to = element.lx_scrollNextParams[2]
    //     fn = element.lx_scrollNextParams[4]
    //     if (to > start) {
    //       let maxScrollTop = info.contentSize.height - info.layoutMeasurement.height
    //       if (to > maxScrollTop) to = maxScrollTop
    //     } else if (to < start) {
    //       if (to < 0) to = 0
    //     } else {
    //       clean()
    //       fn()
    //       return
    //     }
    //     change = to - val

    //     element.lx_scrollLockKey = key
    //   } else {
    //     fn()
    //     return
    //   }
    // }
    currentTime += increment
    val = Math.trunc(easeInOutQuad(currentTime, start, change, duration))
    try {
      element.scrollToOffset({ offset: val, animated: false })
    } catch {
      // 列表已卸载 / 还没有内容高度时 scrollToOffset 会抛，这里不能让它中断定时器链，
      // 否则 lx_scrollLockKey 会一直挂着，后续所有 scrollTo 都只排队不执行（表现为歌词不再滚动）
      clean()
      fn()
      return
    }
    if (currentTime < duration) {
      element.lx_scrollTimeout = setTimeout(animateScroll, increment)
    } else {
      if (element.lx_scrollNextParams) {
        const [_element, info, _to, duration, fn, _maxScrollTop] = element.lx_scrollNextParams
        if (to > _to && info.contentOffset.y < val) info.contentOffset.y = val
        info.contentOffset.y = val
        clean()
        handleScrollY(_element, info, _to, duration, fn, _maxScrollTop)
      } else {
        clean()
        fn()
      }
    }
  }

  element.lx_scrollLockKey = key
  animateScroll()

  return clean
}
/**
  * 设置滚动条位置
  * @param element 要设置滚动的容器 dom
  * @param info 最近一次 onScroll 的快照（提供起点与视口高度）
  * @param to 滚动的目标位置
  * @param duration 滚动完成时间 ms
  * @param fn 滚动完成后的回调
  * @param delay 延迟执行时间
  * @param maxScrollTop 内容可滚动上限（调用方用实时内容高度算，不传则退回 info 里的旧值）
  */
export const scrollTo = (element: ScrollElement<FlatList<any>>, info: NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'], to: number, duration = 300, fn = () => {}, delay = 0, maxScrollTop?: number): () => void => {
  let cancelFn: () => void
  if (element.lx_scrollDelayTimeout != null) {
    clearTimeout(element.lx_scrollDelayTimeout)
    element.lx_scrollDelayTimeout = undefined
  }
  if (delay) {
    let scrollCancelFn: Noop
    cancelFn = () => {
      if (element.lx_scrollDelayTimeout == null) {
        scrollCancelFn?.()
      } else {
        clearTimeout(element.lx_scrollDelayTimeout)
        element.lx_scrollDelayTimeout = undefined
      }
    }
    element.lx_scrollDelayTimeout = setTimeout(() => {
      element.lx_scrollDelayTimeout = undefined
      scrollCancelFn = handleScrollY(element, info, to, duration, fn, maxScrollTop)
    }, delay)
  } else {
    cancelFn = handleScrollY(element, info, to, duration, fn, maxScrollTop) ?? noop
  }
  return cancelFn
}

