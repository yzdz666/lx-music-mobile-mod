import type { I18n } from '@/lang/i18n'

declare global {
  namespace LX {
    type AddMusicLocationType = 'top' | 'bottom'

    interface AppSetting {
      version: string
      /**
       * 是否跟随系统切换亮暗主题
       */
      'common.isAutoTheme': boolean

      /**
       * 语言id
       */
      'common.langId': I18n['locale'] | null

      /**
       * api id
       */
      'common.apiSource': string

      /**
       * 音源名称类型，原名、别名
       */
      'common.sourceNameType': 'alias' | 'real'

      /**
       * 歌曲分享方式
       */
      'common.shareType': 'system' | 'clipboard'

      /**
       * 是否同意软件协议
       */
      'common.isAgreePact': boolean

      /**
       * 是否在键盘弹出时隐藏播放栏
       */
      'common.autoHidePlayBar': boolean

      /**
       * 抽屉组件弹出方向
       */
      'common.drawerLayoutPosition': 'left' | 'right'

      /**
       * 启用首页滑动
       */
      'common.homePageScroll': boolean

      /**
       * 允许通过底栏进度条调整进度
       */
      'common.allowProgressBarSeek': boolean

      /**
       * 是否显示返回按钮
       */
      'common.showBackBtn': boolean

      /**
       * 是否显示退出按钮
       */
      'common.showExitBtn': boolean

      /**
       * 使用系统文件选择器
       */
      'common.useSystemFileSelector': boolean

      /**
       * 总是保留状态栏高度
       */
      'common.alwaysKeepStatusbarHeight': boolean

      /**
       * 主题id
       */
      'theme.id': string

      /**
       * 亮色主题id
       */
      'theme.lightId': string

      /**
       * 暗色主题id
       */
      'theme.darkId': string

      /**
       * 隐藏黑色主题背景
       */
      'theme.hideBgDark': boolean

      /**
       * 动态背景
       */
      'theme.dynamicBg': boolean

      /**
       * 字体阴影
       */
      'theme.fontShadow': boolean

      /**
       * 启动时自动播放歌曲
       */
      'player.startupAutoPlay': boolean

      /**
       * 启动后打开歌曲详细界面
       */
      'player.startupPushPlayDetailScreen': boolean

      /**
       * 切歌模式
       */
      'player.togglePlayMethod': 'listLoop' | 'random' | 'list' | 'singleLoop' | 'none'

      /**
       * 优先播放的音质
       */
      'player.playQuality': LX.Quality

      /**
       * 启动软件时是否恢复上次播放进度
       */
      'player.isSavePlayTime': boolean

      /**
       * 音量大小
       */
      'player.volume': number

      /**
       * 播放速率
       */
      'player.playbackRate': number

      /**
       * 缓存大小设置 unit MiB
       */
      'player.cacheSize': string

      /**
       * 定时暂停播放-倒计时时间
       */
      'player.timeoutExit': string

      /**
       * 定时暂停播放-是否等待歌曲播放完毕再暂停
       */
      'player.timeoutExitPlayed': boolean

      /**
       * 点击相同列表内的歌曲切歌时是否清空已播放列表（随机模式下列表内所有歌曲会重新参与随机）
       */
      'player.isAutoCleanPlayedList': boolean

      /**
       * 其他应用播放声音时是否自动暂停
       */
      'player.isHandleAudioFocus': boolean

      /**
       * 是否启用音频卸载功能（这可以节省耗电量，没有播放异常问题不建议关闭）
       */
      'player.isEnableAudioOffload': boolean

      /**
       * 是否显示歌词翻译
       */
      'player.isShowLyricTranslation': boolean

      /**
       * 是否显示歌词罗马音
       */
      'player.isShowLyricRoma': boolean

      /**
       * 是否在通知栏显示歌曲图片
       */
      'player.isShowNotificationImage': boolean

      /**
       * 是否将歌词从简体转换为繁体
       */
      'player.isS2t': boolean

      /**
       * 是否启用蓝牙歌词
       */
      'player.isShowBluetoothLyric': boolean

      /**
       * 是否启用蓝牙完整歌词
       */
      'player.isShowBluetoothFullLyric': boolean

      /**
       * 播放详情页-是否缩放当前播放的歌词行
       */
      // 'playDetail.isZoomActiveLrc': boolean

      /**
       * 播放详情页-是否允许通过歌词调整播放进度
       */
      // 'playDetail.isShowLyricProgressSetting': boolean

      /**
       * 播放详情页-歌词对齐方式
       */
      'playDetail.style.align': 'center' | 'left' | 'right'

      /**
       * 竖屏歌词字体大小
       */
      'playDetail.vertical.style.lrcFontSize': number

      /**
       * 横屏歌词字体大小
       */
      'playDetail.horizontal.style.lrcFontSize': number

      /**
       * 播放详情页-是否允许通过歌词调整播放进度
       */
      'playDetail.isShowLyricProgressSetting': boolean

      /**
       * 是否启用桌面歌词
       */
      'desktopLyric.enable': boolean
      'desktopLyric.showTranslation': boolean

      /**
       * 是否锁定桌面歌词
       */
      'desktopLyric.isLock': boolean

      /**
       * 桌面歌词窗口宽度
       */
      'desktopLyric.width': number

      /**
       * 桌面歌词最大行数
       */
      'desktopLyric.maxLineNum': number

      /**
       * 桌面歌词是否使用单行显示
       */
      'desktopLyric.isSingleLine': boolean

      /**
       * 桌面歌词是否启用歌词切换动画
       */
      'desktopLyric.showToggleAnima': boolean

      /**
       * 桌面歌词窗口x坐标
       */
      'desktopLyric.position.x': number

      /**
       * 桌面歌词窗口y坐标
       */
      'desktopLyric.position.y': number

      /**
       * 歌词水平对齐方式
       */
      'desktopLyric.textPosition.x': 'left' | 'center' | 'right'

      /**
       * 歌词垂直对齐方式
       */
      'desktopLyric.textPosition.y': 'top' | 'center' | 'bottom'

      /**
       * 桌面歌词字体大小
       */
      'desktopLyric.style.fontSize': number

      /**
       * 桌面歌词字体透明度
       */
      'desktopLyric.style.opacity': number

      /**
       * 桌面歌词未播放字体颜色
       */
      'desktopLyric.style.lyricUnplayColor': string

      /**
        * 桌面歌词已播放字体颜色
        */
      'desktopLyric.style.lyricPlayedColor': string

      /**
        * 桌面歌词字体阴影颜色
        */
      'desktopLyric.style.lyricShadowColor': string

      /**
       * 是否显示热门搜索
       */
      'search.isShowHotSearch': boolean

      /**
       * 是否显示搜索历史
       */
      'search.isShowHistorySearch': boolean

      /**
       * 是否启用双击列表里的歌曲时自动切换到当前列表播放（仅对歌单、排行榜有效）
       */
      'list.isClickPlayList': boolean

      /**
       * 是否显示歌曲来源（仅对我的列表有效）
       */
      'list.isShowSource': boolean

      /**
       * 是否显示歌曲专辑名
       */
      'list.isShowAlbumName': boolean

      /**
       * 是否显示歌曲时长
       */
      'list.isShowInterval': boolean

      /**
       * 是否自动恢复列表滚动位置（仅对我的列表有效）
       */
      'list.isSaveScrollLocation': boolean

      /**
       * 添加歌曲到我的列表时的方式
       */
      'list.addMusicLocationType': AddMusicLocationType

      /**
       * 文件命名方式
       */
      'download.fileName': '歌名 - 歌手' | '歌手 - 歌名' | '歌名'

      /**
       * 是否启用同步
       */
      'sync.enable': boolean

      /**
       * WebDAV 服务器地址，例如 https://dav.jianguoyun.com/dav/
       */
      'sync.webdavUrl': string

      /**
       * WebDAV 账号（坚果云使用「应用密码」）
       */
      'sync.webdavUser': string

      /**
       * WebDAV 密码 / 应用密码
       */
      'sync.webdavPassword': string

      /**
       * WebDAV 自动备份频率：off / startup（每次启动）/ daily（每天）/ weekly（每周）
       */
      'sync.webdavAuto': 'off' | 'startup' | 'daily' | 'weekly'

      /**
       * 三端云同步服务地址（本项目 listen-together-server 的 /api/sync）
       */
      'sync.cloudUrl': string

      /**
       * 同步码（相当于「同一个账号」，多设备填同一个）
       */
      'sync.cloudCode': string

      /**
       * 同步密钥（与同步码配对，只在本机与同步服务之间传输）
       */
      'sync.cloudSecret': string

      /**
       * 自动同步频率：off / startup（启动时）/ always（进入后台/退出时也同步）
       */
      'sync.cloudAuto': 'off' | 'startup' | 'always'

      /**
       * 上次同步完成时间（毫秒时间戳）
       */
      'sync.cloudLastAt': number

      /**
       * 一起听服务器地址，例如 ws://192.168.1.10:23333
       */
      'listenTogether.serverUrl': string

      /**
       * 一起听的网页版地址（内置默认值，可自行修改）
       */
      'listenTogether.webUrl': string

      /**
       * 一起听使用的昵称
       */
      'listenTogether.nickname': string

      /**
       * 下载歌曲时默认选择的音质
       */
      'download.quality': LX.Quality

      /**
       * 下载音质模式
       * - auto：逐首取该歌曲可用的最高音质（默认，与旧行为一致）
       * - global：统一使用 `download.quality` 指定的音质，歌曲没有该档位时自动降级
       */
      'download.qualityMode': 'auto' | 'global'

      /**
       * 自定义主题背景图片（App 私有目录下的绝对路径，空字符串表示未设置）
       */
      'theme.customBgImage': string

      /**
       * 自定义背景图上方主背景色的不透明度（0.3 ~ 1，越小越透出背景图）
       */
      'theme.customBgOpacity': number

      /**
       * 自定义背景图模糊半径（0 ~ 8）
       */
      'theme.customBgBlur': number

      /**
       * 播放失败兜底：自动使用本地已下载的同名歌曲播放
       */
      'player.failureFallback': boolean

      /**
       * 播放页屏幕常亮
       */
      'player.keepScreenOn': boolean

      /**
       * 音效预设：off / surround（全景环绕）/ cinema（电影院）/ hall（音乐厅）/ bass（低音增强）/ custom
       */
      'player.audioEffectPreset': 'off' | 'vocal' | 'bass' | 'surround' | 'live' | 'electronic' | 'rock' | 'folk' | 'classical' | 'jazz' | 'cinema' | 'hall' | 'custom'

      /**
       * 低音增强强度（0 ~ 100，自定义预设）
       */
      'player.audioEffectBass': number

      /**
       * 环绕声场强度（0 ~ 100，自定义预设）
       */
      'player.audioEffectVirtualizer': number

      /**
       * 混响预设：none / smallroom / mediumroom / largeroom / mediumhall / largehall / plate
       */
      'player.audioEffectReverb': string

      /**
       * 自定义均衡器各频段电平（毫贝数组）
       */
      'player.audioEffectEq': number[]
      'player.audioEffectLoudness': number

      /**
       * 下载文件命名格式：name-singer（歌名 - 歌手）/ singer-name（歌手 - 歌名）/ name（歌名）
       */
      'download.fileNameStyle': 'name-singer' | 'singer-name' | 'name'

      /**
       * 下载完成后同时保存同名 .lrc 歌词文件
       */
      'download.saveLrcFile': boolean
      /** 写入歌曲标签（标题 / 歌手 / 专辑） */
      'download.writeMetadata': boolean
      /** 标题附带歌曲别名，需先开启写入标签 */
      'download.writeAlias': boolean
      /** 写入封面 */
      'download.writePicture': boolean
      /** 保存同名 .lrc 歌词文件（附加项） */
      'download.writeLyric': boolean
      /** 把歌词内嵌进音频文件 */
      'download.writeEmbedLyric': boolean
      /** 歌词里附加罗马音 */
      'download.writeRomaLyric': boolean
      /** 自定义下载目录，空字符串表示自动（系统 Download 目录，无权限时用私有目录） */
      'download.savePath': string
      /** 同时下载的任务数 1-5 */
      'download.concurrency': number
      /** 各平台账号 Cookie（用于在线歌单 / 私有歌单） */
      'platform.wyCookie': string
      'platform.txCookie': string
      'platform.kgCookie': string

      /**
       * 是否开启听歌播报（切歌时语音播报歌名与歌手）
       */
      'player.songNotify': boolean

      /**
       * 听歌播报的语速倍率
       */
      'player.songNotifyRate': number

      /**
       * 是否把当前歌词显示到灵动岛 / 常驻通知
       */
      'player.islandLyric': boolean

      /**
       * 是否按 ColorOS / OPlus 的 lyricInfo 协议把整首歌词推送给系统
       * （锁屏、AOD、灵动岛原生滚动高亮）
       */
      'player.systemLyric': boolean
    }
  }
}

