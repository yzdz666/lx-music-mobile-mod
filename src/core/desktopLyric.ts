import {
  hideDesktopLyricView,
  showDesktopLyricView,
  setSendLyricTextEvent,
  setLyric,
  play,
  pause,
  seek,
  setPlaybackRate,
  toggleTranslation,
  toggleRoma,
  toggleLock,
  setColor,
  setAlpha,
  setTextSize,
  setShowToggleAnima,
  setSingleLine,
  setPosition,
  setMaxLineNum,
  setWidth,
  setLyricTextPosition,
  checkOverlayPermission,
  openOverlayPermissionActivity,
  onPositionChange,
} from '@/utils/nativeModules/lyricDesktop'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import { tranditionalize } from '@/utils/simplify-chinese-main'
import { hasWordTags, stripWordTags } from '@/utils/wordLyric'
import { stripLyricPlaceholderLines } from '@/utils/lrcTools'
import { getPosition } from '@/plugins/player'
export {
  onLyricLinePlay,
} from '@/utils/nativeModules/lyricDesktop'

export const showDesktopLyric = async() => {
  const setting = settingState.setting
  // 原生侧保证：无论窗口是新建还是已存在，这次调用都会 resolve（失败则 reject），
  // 因此这里可以放心 await，不需要额外加超时兜底。
  await showDesktopLyricView({
    isShowToggleAnima: setting['desktopLyric.showToggleAnima'],
    isSingleLine: setting['desktopLyric.isSingleLine'],
    isLock: setting['desktopLyric.isLock'],
    unplayColor: setting['desktopLyric.style.lyricUnplayColor'],
    playedColor: setting['desktopLyric.style.lyricPlayedColor'],
    shadowColor: setting['desktopLyric.style.lyricShadowColor'],
    opacity: setting['desktopLyric.style.opacity'],
    textSize: setting['desktopLyric.style.fontSize'],
    width: setting['desktopLyric.width'],
    maxLineNum: setting['desktopLyric.maxLineNum'],
    positionX: setting['desktopLyric.position.x'],
    positionY: setting['desktopLyric.position.y'],
    textPositionX: setting['desktopLyric.textPosition.x'],
    textPositionY: setting['desktopLyric.textPosition.y'],
  }).catch(err => { console.log('show desktop lyric failed', err) })
  let lrc = stripLyricPlaceholderLines(playerState.musicInfo.lrc ?? '')
  let tlrc = stripLyricPlaceholderLines(playerState.musicInfo.tlrc ?? '')
  let rlrc = stripLyricPlaceholderLines(playerState.musicInfo.rlrc ?? '')
  let wordLyric = playerState.musicInfo.lxlrc ?? ''
  if (setting['player.isS2t']) {
    lrc = tranditionalize(lrc)
    tlrc = tranditionalize(tlrc)
    if (wordLyric) wordLyric = tranditionalize(wordLyric)
  }
  if (!wordLyric && hasWordTags(lrc)) wordLyric = lrc
  if (hasWordTags(lrc)) lrc = stripWordTags(lrc)
  await setLyric(lrc, tlrc, rlrc, wordLyric)
  // 桌面歌词独立控制翻译显示（设置 → 桌面歌词 → 显示翻译）。
  // 注意这里不能带 `&& !!tlrc`：开关是全局状态，一旦因为「当前这首没有翻译」
  // 被置成 false，下一首有翻译的歌也不会再显示翻译了，而且设置页那个开关
  // 看起来还是开着的。有没有翻译由原生按 translationText 是否为空自行判断。
  await toggleTranslation(setting['desktopLyric.showTranslation'])
  if (playerState.isPlay && !global.lx.gettingUrlId) {
    void getPosition().then(position => {
      void play(position * 1000)
    })
  }
}

export const hideDesktopLyric = async() => {
  // 同上：前后台切换会高频调用，调用方全是 void，这里必须自己兜住 reject
  await hideDesktopLyricView().catch(() => {})
}

export const playDesktopLyric = play
export const pauseDesktopLyric = pause
/** 拖动进度条：只定位，不改变播放状态 */
export const seekDesktopLyric = seek
export const setDesktopLyric = setLyric
export const setDesktopLyricPlaybackRate = setPlaybackRate
export const toggleDesktopLyricTranslation = toggleTranslation
export const toggleDesktopLyricRoma = toggleRoma
export const toggleDesktopLyricLock = toggleLock
export const setDesktopLyricColor = async(unplayColor: string | null, playedColor: string | null, shadowColor: string | null) => {
  return setColor(unplayColor ?? settingState.setting['desktopLyric.style.lyricUnplayColor'],
    playedColor ?? settingState.setting['desktopLyric.style.lyricPlayedColor'],
    shadowColor ?? settingState.setting['desktopLyric.style.lyricShadowColor'],
  )
}
export const setDesktopLyricAlpha = setAlpha
export const setDesktopLyricTextSize = setTextSize
export const setShowDesktopLyricToggleAnima = setShowToggleAnima
export const setDesktopLyricSingleLine = setSingleLine
export const setDesktopLyricPosition = setPosition
export const setDesktopLyricMaxLineNum = setMaxLineNum
export const setDesktopLyricWidth = setWidth
export const setDesktopLyricTextPosition = async(x: LX.AppSetting['desktopLyric.textPosition.x'] | null, y: LX.AppSetting['desktopLyric.textPosition.y'] | null) => {
  return setLyricTextPosition(x ?? settingState.setting['desktopLyric.textPosition.x'], y ?? settingState.setting['desktopLyric.textPosition.y'])
}
export const checkDesktopLyricOverlayPermission = checkOverlayPermission
export const openDesktopLyricOverlayPermissionActivity = openOverlayPermissionActivity
export const onDesktopLyricPositionChange = onPositionChange


export const showRemoteLyric = async(isSend: boolean) => {
  await setSendLyricTextEvent(isSend)
  if (isSend) {
    let lrc = stripLyricPlaceholderLines(playerState.musicInfo.lrc ?? '')
    let tlrc = stripLyricPlaceholderLines(playerState.musicInfo.tlrc ?? '')
    let rlrc = stripLyricPlaceholderLines(playerState.musicInfo.rlrc ?? '')
    let wordLyric = playerState.musicInfo.lxlrc ?? ''
    if (settingState.setting['player.isS2t']) {
      lrc = tranditionalize(lrc)
      tlrc = tranditionalize(tlrc)
      if (wordLyric) wordLyric = tranditionalize(wordLyric)
    }
    if (!wordLyric && hasWordTags(lrc)) wordLyric = lrc
    if (hasWordTags(lrc)) lrc = stripWordTags(lrc)
    await setLyric(lrc, tlrc, rlrc, wordLyric)
    if (playerState.isPlay && !global.lx.gettingUrlId) {
      void getPosition().then(position => {
        void play(position * 1000)
      })
    }
  }
}
