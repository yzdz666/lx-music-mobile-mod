const defaultSetting: LX.AppSetting = {
  version: '2.1',
  'common.isAutoTheme': false,
  'common.langId': null,
  'common.apiSource': '',
  'common.sourceNameType': 'alias',
  'common.shareType': 'system',
  'common.isAgreePact': false,
  'common.autoHidePlayBar': true,
  'common.drawerLayoutPosition': 'left',
  'common.homePageScroll': true,
  'common.allowProgressBarSeek': true,
  'common.showBackBtn': false,
  'common.showExitBtn': true,
  'common.useSystemFileSelector': true,
  'common.alwaysKeepStatusbarHeight': false,

  'player.startupAutoPlay': false,
  'player.startupPushPlayDetailScreen': false,
  'player.togglePlayMethod': 'listLoop',
  'player.playQuality': '128k',
  // 合并优质源：单平台取链达标阈值（毫秒），只在「合并」时使用
  'player.mergeSpeedLimit': 1000,
  'player.isSavePlayTime': false,
  'player.volume': 1,
  'player.playbackRate': 1,
  'player.cacheSize': '1024',
  'player.timeoutExit': '',
  'player.timeoutExitPlayed': true,
  'player.isAutoCleanPlayedList': false,
  'player.isHandleAudioFocus': true,
  'player.isEnableAudioOffload': false,
  'player.isShowLyricTranslation': true,
  'player.isShowLyricRoma': false,
  'player.isShowNotificationImage': true,
  'player.isS2t': false,
  'player.isShowBluetoothLyric': false,
  'player.isShowBluetoothFullLyric': false,

  // 'playDetail.isZoomActiveLrc': false,
  // 'playDetail.isShowLyricProgressSetting': false,
  'playDetail.style.align': 'left',
  'playDetail.vertical.style.lrcFontSize': 210,
  'playDetail.horizontal.style.lrcFontSize': 220,
  'playDetail.isShowLyricProgressSetting': false,

  'desktopLyric.enable': false,
  'desktopLyric.showTranslation': true,
  'desktopLyric.isLock': false,
  'desktopLyric.width': 100,
  'desktopLyric.maxLineNum': 5,
  'desktopLyric.isSingleLine': false,
  // 1.22.40 起默认关闭：换行改成单视图直切，不再有交叉动画。
  // 老版本这个开关是 true，TextSwitcher 会同时渲染新旧两句，造成重影。
  'desktopLyric.showToggleAnima': false,
  'desktopLyric.position.x': 0,
  'desktopLyric.position.y': 0,
  'desktopLyric.textPosition.x': 'left',
  'desktopLyric.textPosition.y': 'top',
  'desktopLyric.style.fontSize': 180,
  'desktopLyric.style.opacity': 100,
  'desktopLyric.style.lyricUnplayColor': 'rgba(255, 255, 255, 1)',
  'desktopLyric.style.lyricPlayedColor': 'rgba(7, 197, 86, 1)',
  'desktopLyric.style.lyricShadowColor': 'rgba(0, 0, 0, 0.6)',

  'search.isShowHotSearch': false,
  'search.isShowHistorySearch': false,

  'list.isClickPlayList': false,
  'list.isShowSource': true,
  'list.isShowAlbumName': false,
  'list.isShowInterval': true,
  'list.isSaveScrollLocation': true,
  'list.addMusicLocationType': 'top',

  'download.fileName': '歌名 - 歌手',

  'sync.enable': false,

  // WebDAV 备份（歌单 / 设置 / 自定义源），支持坚果云等任意 WebDAV 服务
  'sync.webdavUrl': '',
  'sync.webdavUser': '',
  'sync.webdavPassword': '',
  'sync.webdavAuto': 'off',

  // 三端云同步（手机 / 电脑 / 网页版），走本项目自己的 /api/sync 接口
  'sync.cloudUrl': 'https://af384ee6deb6e09e2.app.workbuddy.host/api/sync?sharecode=MKPWEVLBUS',
  'sync.cloudCode': '',
  'sync.cloudSecret': '',
  'sync.cloudAuto': 'off',
  'sync.cloudLastAt': 0,

  // 内置的公共一起听服务器（发布自本项目 listen-together-server），可随时在设置里改成自建地址
  'listenTogether.serverUrl': 'wss://af384ee6deb6e09e2.app.workbuddy.host?sharecode=MKPWEVLBUS',
  'listenTogether.webUrl': 'https://af384ee6deb6e09e2.app.workbuddy.host/?sharecode=MKPWEVLBUS',
  'listenTogether.nickname': '',

  'download.quality': '320k',
  'download.qualityMode': 'auto',

  'theme.customBgImage': '',
  'theme.customBgOpacity': 0.75,
  'theme.customBgBlur': 0,
  'player.songNotify': true,
  'player.failureFallback': true,
  'player.keepScreenOn': false,
  'player.audioEffectPreset': 'off',
  'player.audioEffectBass': 30,
  'player.audioEffectVirtualizer': 50,
  'player.audioEffectReverb': 'none',
  'player.audioEffectEq': [],
  'player.audioEffectLoudness': 0,
  'download.fileNameStyle': 'name-singer',
  'download.saveLrcFile': false,
  'download.writeMetadata': false,
  'download.writeAlias': false,
  'download.writePicture': false,
  'download.writeLyric': false,
  'download.writeEmbedLyric': false,
  'download.writeRomaLyric': false,
  'download.savePath': '',
  'download.concurrency': 3,
  'platform.wyCookie': '',
  'platform.txCookie': '',
  'platform.kgCookie': '',
  'player.songNotifyRate': 1,
  'player.islandLyric': true,
  'player.systemLyric': true,

  // 'theme.id': 'blue_plus',
  'theme.id': 'green',
  'theme.lightId': 'green',
  'theme.darkId': 'black',
  'theme.hideBgDark': false,
  'theme.dynamicBg': false,
  'theme.fontShadow': false,
}


// 使用新年皮肤
if (new Date().getMonth() < 2) {
  defaultSetting['theme.id'] = 'happy_new_year'
  defaultSetting['desktopLyric.style.lyricPlayedColor'] = 'rgba(255, 18, 34, 1)'
}

export default defaultSetting
