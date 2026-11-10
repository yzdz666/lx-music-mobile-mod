// 修补依赖源码以使构建的依赖恢复正常工作
//
// 主要内容：
// 1. MediaSession 的 MediaMetadata 带上 ColorOS / OPlus 原生锁屏歌词字段 lyricInfo
//    （契约见 ColorOS-Live-Lyrics-Bridge《播放器接入协议》）
// 2. 切歌清空歌词、封面重建 metadata 时保留歌词
// 3. setMetadata 全部走安全包装，避免歌词过大时 Binder 事务抛异常导致闪退
// 4. 原生崩溃页按钮中文化
//
// 注意：脚本必须是幂等的，重复执行不能重复插入
//（之前出现过把字段插了三遍导致 javac 报 "already defined"）。

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

const metadataManagerPath = './node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata/MetadataManager.java'
const interfacesPath = './node_modules/react-native-track-player/lib/interfaces.d.ts'
const errorScreenPath = './node_modules/react-native-exception-handler/android/src/main/java/com/masteratul/exceptionhandler/DefaultErrorScreen.java'
const lrcParserPath = './node_modules/lrc-file-parser/dist/lrc-file-parser.js'
const lrcParserEsmPath = './node_modules/lrc-file-parser/dist/lrc-file-parser.esm.js'

// 已经打过补丁的标记：出现这些字符串就整块跳过
// 注意：MetadataManager 有多个互不相邻的插入点，不能用同一个 guard，
// 否则先插入的标记会把后面的插入点一起跳过（曾导致 activeSession 赋值漏插）。
const guards = {
  [interfacesPath]: 'lyricInfo?: string',
  [errorScreenPath]: '查看错误详情',
}

const patchs = [
  // 1. 字段 + 安全 setMetadata + 归属判断工具
  [
    metadataManagerPath,
    '    private MediaMetadataCompat.Builder prevMetadata = null;\n',
    '    private MediaMetadataCompat.Builder prevMetadata = null;\n' +
      '    // 系统歌词：ColorOS / OPlus 从 MediaMetadata["lyricInfo"] 读取\n' +
      '    private String lyricInfo = null;\n' +
      '    // 当前 lyricInfo 属于哪一首，防止切歌后把上一首的歌词挂到新歌上\n' +
      '    private String lyricTrackKey = null;\n' +
      '    // 当前活跃会话：MediaBrowserService 需要把同一个 token 交给系统媒体中心\n' +
      '    private static java.lang.ref.WeakReference<MediaSessionCompat> activeSession = new java.lang.ref.WeakReference<>(null);\n' +
      '\n' +
      '    public static MediaSessionCompat getActiveSession() {\n' +
      '      return activeSession == null ? null : activeSession.get();\n' +
      '    }\n' +
      '\n' +
      '    /** MediaSession.setMetadata 是 Binder 调用，歌词过大时会抛 TransactionTooLargeException */\n' +
      '    private void safeSetMetadata(MediaMetadataCompat metadata) {\n' +
      '      try {\n' +
      '        session.setMetadata(metadata);\n' +
      '      } catch (Exception err) {\n' +
      '        android.util.Log.w("TrackPlayer", "setMetadata failed: " + err.getMessage());\n' +
      '      }\n' +
      '    }\n' +
      '\n' +
      '    private static String trackKeyOf(TrackMetadata track) {\n' +
      '      if (track == null) return "";\n' +
      '      return String.valueOf(track.title) + "|" + String.valueOf(track.artist) + "|" + track.duration;\n' +
      '    }\n',
  ],
  // 1.1 构造时记录当前会话，供 MediaBrowserService 暴露给系统
  [
    metadataManagerPath,
    '        this.builder = new NotificationCompat.Builder(service, channel);\n        this.session = new MediaSessionCompat(service, "TrackPlayer", null, null);\n',
    '        this.builder = new NotificationCompat.Builder(service, channel);\n        this.session = new MediaSessionCompat(service, "TrackPlayer", null, null);\n' +
      '        activeSession = new java.lang.ref.WeakReference<>(session);\n',
  ],
  // 2. updateTitles：接收 lyricInfo 并记录归属
  //    锚点用 lyric 块而不是 setMetadata 行，避免被 globalPatch 替换后匹配不到
  [
    metadataManagerPath,
    '      if (data.containsKey("lyric")) {\n' +
      '        prevMetadata.putString("android.media.metadata.LYRICS", data.getString("lyric"));\n' +
      '      }\n',
    '      if (data.containsKey("lyric")) {\n' +
      '        prevMetadata.putString("android.media.metadata.LYRICS", data.getString("lyric"));\n' +
      '      }\n' +
      '      if (data.containsKey("lyricInfo")) {\n' +
      '        String value = data.getString("lyricInfo");\n' +
      '        lyricInfo = value == null || value.length() == 0 ? null : value;\n' +
      '        try {\n' +
      '          lyricTrackKey = lyricInfo == null ? null : trackKeyOf(manager.getPlayback().getCurrentTrack());\n' +
      '        } catch (Exception ignored) {\n' +
      '        }\n' +
      '        // null 会把旧歌词从 extras 里移除，避免切歌后仍然显示上一首\n' +
      '        prevMetadata.putString("lyricInfo", lyricInfo);\n' +
      '      }\n',
  ],
  // 3. updateMetadata：换曲先摘掉旧歌词，同曲继续带上
  [
    metadataManagerPath,
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n        prevMetadata = metadata;\n',
    '        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();\n' +
      '        prevMetadata = metadata;\n' +
      '        String newTrackKey = trackKeyOf(track);\n' +
      '        if (lyricTrackKey == null || !lyricTrackKey.equals(newTrackKey)) {\n' +
      '          lyricInfo = null;\n' +
      '          lyricTrackKey = newTrackKey;\n' +
      '        }\n' +
      '        if (lyricInfo != null) metadata.putString("lyricInfo", lyricInfo);\n',
  ],
  // 4. updateArtwork：封面异步就绪后重建 metadata，别把歌词丢掉
  [
    metadataManagerPath,
    '        metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap);\n        builder.setLargeIcon(bitmap);\n',
    '        metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap);\n' +
      '        if (lyricInfo != null) metadata.putString("lyricInfo", lyricInfo);\n' +
      '        builder.setLargeIcon(bitmap);\n',
  ],
  // 5. 类型声明补充 lyricInfo
  [
    interfacesPath,
    '    lyric?: string;\n}',
    '    lyric?: string;\n    lyricInfo?: string;\n}',
  ],
  // 6. 原生错误页按钮中文化
  [errorScreenPath, 'showDetailsButton.setText("SHOW DETAILS");', 'showDetailsButton.setText("查看错误详情");'],
  [errorScreenPath, 'showDetailsButton.setText("HIDE DETAILS");', 'showDetailsButton.setText("收起详情");'],
  // 7. lrc-file-parser：修「切歌时 null is not a function」
  //
  // 崩溃链（栈顶落在 lrc-file-parser.js:69 的 this.callback(diff)）：
  //   resync() 为了不闪歌词，会把 isPlay 置 false 再 play()，play() 内部的 pause()
  //   因此直接 return，timeoutTools 里上一条 rAF/timeout 链不会被取消（孤儿链）。
  //   紧接着切歌走 setLyric('') -> pause() -> clear()，把 callback 置 null；
  //   孤儿链到期后 run() 再调 callback 就是 null()，抛 TypeError。
  // 复现：play() -> isPlay=false + play() -> setLyric('')，~2s 后必现。
  [
    lrcParserPath,
    '    run() {\n' +
      '        this.animationFrameId = window.requestAnimationFrame(() => {\n' +
      '            this.animationFrameId = null;\n' +
      '            let diff = this.invokeTime - getNow();\n',
    '    run() {\n' +
      '        this.animationFrameId = window.requestAnimationFrame(() => {\n' +
      '            this.animationFrameId = null;\n' +
      '            // LX Mod: clear() 无法取消「已入队」的 rAF/timeout 回调，\n' +
      '            // 此时 callback 已被置空，直接调用会抛 null is not a function\n' +
      '            if (this.callback == null) return;\n' +
      '            let diff = this.invokeTime - getNow();\n',
  ],
  [
    lrcParserPath,
    '    start(callback = noop, timeout = 0) {\n' +
      '        // console.log(timeout)\n' +
      '        this.callback = callback;\n',
    '    start(callback = noop, timeout = 0) {\n' +
      '        // LX Mod: 先清掉上一条定时器链。resync() 绕过 pause() 直接 play() 时，\n' +
      '        // 旧链的 rAF/timeout 不会被取消，之后 pause() 把 callback 置空就会调 null 崩溃\n' +
      '        this.clear();\n' +
      '        // console.log(timeout)\n' +
      '        this.callback = callback;\n',
  ],
  // 8. lrc-file-parser：修「[00:00.06] 被当成 600ms」
  //
  // formatTimeLabel 的 /\.0+(\d+)/ 会把小数位开头的 0 剥掉：
  //   [00:00.06] -> .6 -> 再按「不足 3 位右补 0」-> 600ms（正确 60ms）
  // 落在 0.01~0.09 秒的歌词因此整体推迟最多 900ms，正好卡在上一句上，
  // 桌面歌词/App 内歌词都会「卡住等下一句」。小数位统一补到 3 位即可，
  // 顺带让 [00:00.06] 与 [00:00.060] 这种不同精度的翻译行也能对上。
  ...['./node_modules/lrc-file-parser/dist/lrc-file-parser.js', './node_modules/lrc-file-parser/dist/lrc-file-parser.esm.js'].flatMap((filePath) => [
    [
      filePath,
      'const t_rxp_3 = /\\.0+(\\d+)/;\n' +
        'const formatTimeLabel = (label) => {\n' +
        "    return label.replace(t_rxp_1, '$1')\n" +
        "        .replace(t_rxp_2, ':$1')\n" +
        "        .replace(t_rxp_3, '.$1');\n" +
        '};\n',
      'const formatTimeLabel = (label) => {\n' +
        '    // LX Mod: 不要剥掉小数位开头的 0（.06 是 60ms，不是 .6）\n' +
        "    const normalized = label.replace(t_rxp_1, '$1').replace(t_rxp_2, ':$1')\n" +
        "    const dot = normalized.lastIndexOf('.')\n" +
        "    if (dot < 0) return normalized + '.000'\n" +
        '    let frac = normalized.slice(dot + 1)\n' +
        '    if (frac.length > 3) frac = frac.slice(0, 3)\n' +
        "    while (frac.length < 3) frac += '0'\n" +
        '    return normalized.slice(0, dot + 1) + frac\n' +
        '};\n',
    ],
    [
      filePath,
      'time: parseInt(timeArr[0]) * 60 * 60 * 1000 + parseInt(timeArr[1]) * 60 * 1000 + parseInt(timeArr[2]) * 1000 + parseInt(isMsTime ? msTime : msTime.padEnd(3, \'0\')),',
      'time: parseInt(timeArr[0]) * 60 * 60 * 1000 + parseInt(timeArr[1]) * 60 * 1000 + parseInt(timeArr[2]) * 1000 + parseInt(msTime),',
    ],
  ]),
  // 9. lrc-file-parser：翻译行里的 "//" 占位不要当成译文
  //
  // LRC 的翻译 / 罗马音文件常用 [00:12.00]// 表示「这一行没有翻译」。
  // 上游 parseExtendedLyric 只判断 text 非空，于是 // 会被挂到正文行下面，
  // App 内歌词就会出现正文 + 一行光秃秃的「//」；桌面歌词（电脑版 line-player）
  // 早就过滤了 //，两端行为不一致。
  ...['./node_modules/lrc-file-parser/dist/lrc-file-parser.js', './node_modules/lrc-file-parser/dist/lrc-file-parser.esm.js'].flatMap((filePath) => [
    [
      filePath,
      "            const text = line.replace(timeFieldExp, '').trim();\n" +
        '            if (text) {\n',
      "            const text = line.replace(timeFieldExp, '').trim();\n" +
        "            // LX Mod: \"//\" 是「这一行没有翻译」的占位，不能当译文显示\n" +
        "            if (text && text != '//') {\n",
    ],
  ]),
  // 10. lrc-file-parser：译文与正文相同时不要重复挂载
  //
  // 翻译 / 罗马音文件里，没有翻译的句子常常直接复制原文（或者整份文件就是
  // 原文的副本），上游只判空，于是同一句会显示两遍：正文一行大字 + 译文一行
  // 小字。桌面歌词是 extendedLyrics.join('\n')，直接变成「一句歌词重复两行」。
  ...['./node_modules/lrc-file-parser/dist/lrc-file-parser.js', './node_modules/lrc-file-parser/dist/lrc-file-parser.esm.js'].flatMap((filePath) => [
    [
      filePath,
      '                    const targetLine = lrcLinesMap[timeStr];\n' +
        '                    if (targetLine)\n' +
        '                        targetLine.extendedLyrics.push(text);\n',
      '                    const targetLine = lrcLinesMap[timeStr];\n' +
        '                    // LX Mod: 与正文相同、或已经挂过的译文不再重复追加\n' +
        "                    if (targetLine && targetLine.text !== text && !targetLine.extendedLyrics.includes(text))\n" +
        '                        targetLine.extendedLyrics.push(text);\n',
    ],
  ]),
  // 11. lrc-file-parser：同一时间戳的重复正文不要当译文
  //
  // 有些歌词把同一句打了两个一模一样的时间标签（[00:12.00][00:12.00]词），
  // 或者同一秒里重复了一行，上游会把它 push 进 extendedLyrics，结果正文下面
  // 又出现一行同样的字。
  ...['./node_modules/lrc-file-parser/dist/lrc-file-parser.js', './node_modules/lrc-file-parser/dist/lrc-file-parser.esm.js'].flatMap((filePath) => [
    [
      filePath,
      '                        if (linesMap[timeStr]) {\n' +
        '                            linesMap[timeStr].extendedLyrics.push(text);\n' +
        '                            continue;\n' +
        '                        }\n',
      '                        if (linesMap[timeStr]) {\n' +
        '                            // LX Mod: 同时间戳且同一句，不再当译文重复挂载\n' +
        '                            if (linesMap[timeStr].text !== text) linesMap[timeStr].extendedLyrics.push(text);\n' +
        '                            continue;\n' +
        '                        }\n',
    ],
  ]),
]

// MetadataManager 同一个文件里有多个互不相邻的插入点，必须各自用独立标记判断，
// 否则第一条插入的标记会把后面几条一起跳过（曾导致 activeSession 赋值漏插）。
const patchGuardsByIndex = new Map([
  [0, 'public static MediaSessionCompat getActiveSession()'],
  [1, 'activeSession = new java.lang.ref.WeakReference<>(session);'],
  [2, 'if (data.containsKey("lyricInfo")) {'],
  [3, 'String newTrackKey = trackKeyOf(track);'],
  [4, 'metadata.putString("lyricInfo", lyricInfo);\n        builder.setLargeIcon(bitmap);'],
  [8, 'if (this.callback == null) return;'],
  [9, 'this.clear();\n        // console.log(timeout)'],
])

// 全局替换：所有 setMetadata 都走安全包装
const globalPatchs = [
  [metadataManagerPath, 'session.setMetadata(metadata.build());', 'safeSetMetadata(metadata.build());'],
  [metadataManagerPath, 'session.setMetadata(prevMetadata.build());', 'safeSetMetadata(prevMetadata.build());'],
]


;(async() => {
  // 先清理历史半补丁残留：早期版本只在 prevMetadata 后插了 lyricInfo 声明，
  // 新版把完整块（含 getActiveSession/safeSetMetadata）插到同一位置时，
  // trackKeyOf 后面会留下一条重复声明，javac 直接报 "variable lyricInfo is already defined"。
  // 特征片段带上前后行，避免误伤新块里的同名两行。
  {
    const residual = '      return String.valueOf(track.title) + "|" + String.valueOf(track.artist) + "|" + track.duration;\n' +
      '    }\n' +
      '    // 系统歌词：ColorOS / OPlus 从 MediaMetadata["lyricInfo"] 读取\n' +
      '    private String lyricInfo = null;\n' +
      '    private Uri prevArtwork = null;\n'
    const cleaned = '      return String.valueOf(track.title) + "|" + String.valueOf(track.artist) + "|" + track.duration;\n' +
      '    }\n' +
      '    private Uri prevArtwork = null;\n'
    try {
      const file = (await fs.promises.readFile(metadataManagerPath)).toString()
      if (file.includes(residual)) {
        await fs.promises.writeFile(metadataManagerPath, file.replace(residual, cleaned))
        console.log('Cleaned residual patch in MetadataManager.java')
      }
    } catch (err) {
      console.error(`Clean residual failed: ${err.message}`)
    }
  }

  for (const [index, [filePath, fromStr, toStr]] of patchs.entries()) {
    console.log(`Patching ${filePath.replace(rootPath, '')}`)
    try {
      let file = (await fs.promises.readFile(filePath)).toString()
      const guard = patchGuardsByIndex.get(index) ?? guards[filePath]
      if (guard && file.includes(guard)) {
        console.log('  skipped (already patched)')
        continue
      }
      if (file.includes(toStr)) {
        console.log('  skipped (already applied)')
        continue
      }
      if (!file.includes(fromStr)) {
        console.log('  skipped (pattern not found)')
        continue
      }
      file = file.replace(fromStr, toStr)
      await fs.promises.writeFile(filePath, file)
    } catch (err) {
      console.error(`Patch ${filePath.replace(rootPath, '')} failed: ${err.message}`)
    }
  }

  for (const [filePath, fromStr, toStr] of globalPatchs) {
    console.log(`Patching (all) ${filePath.replace(rootPath, '')}`)
    try {
      const file = (await fs.promises.readFile(filePath)).toString()
      if (!file.includes(fromStr)) {
        console.log('  skipped (already patched or pattern not found)')
        continue
      }
      await fs.promises.writeFile(filePath, file.split(fromStr).join(toStr))
    } catch (err) {
      console.error(`Patch ${filePath.replace(rootPath, '')} failed: ${err.message}`)
    }
  }

  console.log('\nDependencies patch finished.\n')
})()
