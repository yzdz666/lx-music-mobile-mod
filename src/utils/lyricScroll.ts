/**
 * 歌词列表滚动定位工具
 *
 * 之前的实现直接用 `lineHeights` 累加算绝对偏移，但 FlatList 只会测量「渲染过」的行：
 *  - 切歌后 `lineHeights` 被清空，靠前的行要等重新渲染才有高度；
 *  - 拖动进度条跳行后，中间没渲染过的行高度全是 0。
 *
 * 累加出来的偏移会明显偏小，`scrollTo` 滚到一半就停住，高亮行于是一路往下漂，
 * 表现就是「歌词卡住不动 / 越唱越靠下」。
 *
 * 这里把「能不能用累加值」显式判断出来：算不出来就退回 `scrollToIndex`，
 * 让 FlatList 自己去处理未测量的行。
 */

/** 当前行在内容坐标系里的中心位置；任一行高度未知时返回 null */
export const getLineOffset = (lineHeights: number[], spaceHeight: number, index: number): number | null => {
  if (index < 0) return null
  let offset = spaceHeight
  for (let i = 0; i < index; i++) {
    const height = lineHeights[i]
    if (!height) return null
    offset += height
  }
  const current = lineHeights[index]
  if (!current) return null
  return offset + current / 2
}

/** 让某一行落在视口 ratio 位置时需要的滚动距离 */
export const getScrollTop = (lineOffset: number, viewportHeight: number, ratio = 0.42): number => {
  return Math.max(0, lineOffset - viewportHeight * ratio)
}

/**
 * 行高不全时的近似偏移：已测量的行用真实高度，未测量的行用平均行高。
 * 用于 `onScrollToIndexFailed` 里先把列表粗滚到目标附近，让目标行进入渲染窗口。
 */
export const getApproxLineOffset = (
  lineHeights: number[],
  spaceHeight: number,
  index: number,
  averageHeight = 40,
): number => {
  if (index < 0) return spaceHeight
  let offset = spaceHeight
  for (let i = 0; i < index; i++) {
    offset += lineHeights[i] || averageHeight
  }
  return offset + (lineHeights[index] || averageHeight) / 2
}
