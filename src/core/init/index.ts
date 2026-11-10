import { initSetting, showPactModal } from '@/core/common'
import registerPlaybackService from '@/plugins/player/service'
import initTheme from './theme'
import initI18n from './i18n'
import initUserApi from './userApi'
import initPlayer from './player'
import dataInit from './dataInit'
import initSync from './sync'
import initCommonState from './common'
import { initDeeplink } from './deeplink'
import { initListenTogether } from '@/core/listenTogether'
import { initDownload } from '@/core/download'
import { initSongNotify } from '@/core/player/notify'
import { initSystemLyric } from '@/core/player/systemLyric'
import { setApiSource } from '@/core/apiSource'
import commonActions from '@/store/common/action'
import settingState from '@/store/setting/state'
import { checkUpdate } from '@/core/version'
import { bootLog } from '@/utils/bootLog'
import { cheatTip } from '@/utils/tools'
import { getPackageName } from '@/utils/nativeModules/utils'
import { setProviderPackage } from '@/utils/lyricInfo'

let isFirstPush = true
const handlePushedHomeScreen = async() => {
  await cheatTip()
  if (settingState.setting['common.isAgreePact']) {
    if (isFirstPush) {
      isFirstPush = false
      void checkUpdate()
      void initDeeplink()
    }
  } else {
    if (isFirstPush) isFirstPush = false
    showPactModal()
  }
}

let isInited = false
export default async() => {
  if (isInited) return handlePushedHomeScreen
  bootLog('Initing...')
  commonActions.setFontSize(global.lx.fontSize)
  bootLog('Font size changed.')
  const setting = await initSetting()
  bootLog('Setting inited.')

  // 锁屏歌词 payload 的 provider 必须是运行时包名：
  // 原包名版是 cn.toside.music.mobile，写死新包名会让 ColorOS 找不到应用，
  // 表现为「锁屏歌词不显示」且没有任何报错。必须在 initPlayer 之前注入。
  const pkg = await getPackageName().catch(() => null)
  if (pkg) setProviderPackage(pkg)
  bootLog('Package name injected.')
  // console.log(setting)

  await initTheme(setting)
  bootLog('Theme inited.')
  await initI18n(setting)
  bootLog('I18n inited.')

  await initUserApi(setting)
  bootLog('User Api inited.')

  setApiSource(setting['common.apiSource'])
  bootLog('Api inited.')

  registerPlaybackService()
  bootLog('Playback Service Registered.')
  await initPlayer(setting)
  bootLog('Player inited.')
  // 音效（1.16.0）：播放器就绪后应用 EQ/环绕/混响设置
  void import('@/core/audioEffect').then(async({ initAudioEffect }) => initAudioEffect()).catch(() => {})
  await dataInit(setting)
  bootLog('Data inited.')
  await initCommonState(setting)
  bootLog('Common State inited.')

  initListenTogether()
  bootLog('Listen Together inited.')

  void initDownload()
  bootLog('Download inited.')

  initSongNotify()
  initSystemLyric()
  bootLog('Song notify inited.')

  void initSync(setting)
  bootLog('Sync inited.')

  // 网易账号（1.20.0）：有 Cookie 时补拉昵称、关注歌手等，失败不影响启动
  if (setting['platform.wyCookie']) {
    void import('@/core/netease').then(async({ initNetease }) => initNetease()).catch(() => {})
  }

  // WebDAV 自动备份：启动时静默检查频率，不阻塞主流程（1.15.0）
  if (setting['common.isAgreePact']) {
    void import('@/core/sync/webdavAuto').then(async({ checkWebdavAutoBackup }) => checkWebdavAutoBackup()).catch(() => {})
  }

  // 三端云同步：按设置里的频率在启动 / 切后台时静默同步一次
  if (setting['common.isAgreePact']) {
    void import('@/core/sync/cloudAuto').then(async({ initCloudAutoSync }) => initCloudAutoSync()).catch(() => {})
  }

  // syncSetting()

  isInited ||= true

  return handlePushedHomeScreen
}
