import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, TouchableOpacity } from 'react-native'
import Text from '@/components/common/Text'
import Button from '../../components/Button'
import { createStyle, confirmDialog, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useUserApiList } from '@/store/userApi'
import { usePlayMusicInfo } from '@/store/player/hook'
import { getPlayQuality } from '@/core/music/utils'
import {
  runMergeSources, loadMergeResult, restoreBeforeMerge, MergeCancelledError,
  PLATFORM_LABELS, MERGED_API_NAME, SPEED_LIMIT_OPTIONS,
  type MergeResult, type MergeProgress, type MergePlatform,
} from '@/core/mergeSource/mergeSources'

/**
 * 合并优质源
 *
 * 移植自 HFPlayAI/LX-N-MUSIC-PLUS 的思路：把多个自定义音源合成一个脚本，
 * 按平台路由到实测最快的那个源。完整说明见 src/core/mergeSource/mergeScript.ts。
 */

const QUALITY_LABELS: Record<string, string> = {
  '128k': '128K',
  '320k': '320K',
  flac: 'FLAC',
  flac24bit: 'FLAC 24BIT',
}

export default memo(() => {
  const theme = useTheme()
  const quality = useSettingValue('player.playQuality')
  const speedLimit = useSettingValue('player.mergeSpeedLimit')
  const activeApiId = useSettingValue('common.apiSource')
  const userApiList = useUserApiList()
  const playInfo = usePlayMusicInfo()
  const [running, setRunning] = useState(false)
  const [showSpeedList, setShowSpeedList] = useState(false)
  const [progress, setProgress] = useState<MergeProgress | null>(null)
  const [result, setResult] = useState<MergeResult | null>(null)
  const [error, setError] = useState('')
  const cancelRef = useRef(false)

  useEffect(() => {
    void loadMergeResult().then(r => { if (r) setResult(r) }).catch(() => {})
  }, [])

  // 播放日志：当前歌曲 / 音质 / 平台 / 实际由哪个源解析
  const logLine = useMemo(() => {
    try {
      const mi = playInfo?.musicInfo as unknown as { id?: string, name?: string, source?: string } | null
      if (!mi) return '当前没有播放歌曲'
      const platform = mi.source ?? 'local'
      const platformName = PLATFORM_LABELS[platform as MergePlatform] ?? (platform === 'local' ? '本地' : platform)
      const currentQuality = platform === 'local'
        ? '本地'
        : getPlayQuality(quality, mi as LX.Music.MusicInfoOnline)
      const isMerged = userApiList?.find(a => a.id === activeApiId)?.name === MERGED_API_NAME
      let resolveText: string
      if (platform === 'local') {
        resolveText = '本地文件（不走音源）'
      } else if (isMerged) {
        const child = result?.outcomes?.find(o => o.platform === platform)?.apiName ?? '未记录'
        resolveText = `${MERGED_API_NAME} → ${child} · ${platformName}平台`
      } else {
        const currentName = userApiList?.find(a => a.id === activeApiId)?.name ?? (activeApiId ? '内置音源' : '未选择音源')
        resolveText = `${currentName} · ${platformName}平台`
      }
      return `${mi.name ?? '未知歌曲'}，${currentQuality}，${platformName}，${resolveText}`
    } catch (err) {
      return `播放日志不可用（${err instanceof Error ? err.message : String(err)}）`
    }
  }, [playInfo, quality, activeApiId, userApiList, result])

  const outcomes = result?.outcomes ?? []
  const probeSongs = result?.probeSongs ?? []
  const embedded = result?.embedded ?? []
  const qualityLabel = QUALITY_LABELS[quality] ?? String(quality ?? '128K').toUpperCase()

  const handleMerge = useCallback(async() => {
    const ok = await confirmDialog({
      title: '合并优质源',
      message: `按「当前音源 → 列表顺序」逐个检查全部自定义源；只测还没拿下的平台，4 个平台全部达标立即停止。\n\n每平台独立从该平台内置歌单随机抽 1 首歌测试，不会拿当前播放歌曲去测其它平台。\n\n判定：在所选音质 ${quality} 取链成功且响应 < ${speedLimit}ms。高于 ${quality} 的档位不测。\n\n合并过程会临时切换音源，可能打断正在播放的歌曲。`,
      confirmButtonText: '开始合并',
    })
    if (!ok) return
    setRunning(true)
    setError('')
    setProgress(null)
    cancelRef.current = false
    try {
      const r = await runMergeSources({
        onProgress: setProgress,
        isCancelled: () => cancelRef.current,
      })
      setResult(r)
      toast('合并完成，已切换为「合并优质源」')
    } catch (err) {
      if (err instanceof MergeCancelledError) {
        setError('已取消，音源已还原')
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setRunning(false)
    }
  }, [quality, speedLimit])

  const handleCancel = useCallback(() => { cancelRef.current = true }, [])

  const handleRestore = useCallback(async() => {
    const changed = await restoreBeforeMerge()
    toast(changed ? '已还原到合并前的音源' : '没有可还原的记录')
  }, [])

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text size={14}>合并优质源</Text>
      </View>

      <View style={styles.speedRow}>
        <Text size={11} color={theme['c-font-label']} style={[styles.qualityHint, { backgroundColor: theme['c-button-background'] }]}>当前音质上限：{qualityLabel}</Text>
        <Text size={12} color={theme['c-font-label']}>达标阈值</Text>
        <TouchableOpacity
          style={[styles.speedBtn, { backgroundColor: theme['c-button-background'] }]}
          onPress={() => { setShowSpeedList(v => !v) }}
        >
          <Text size={12}>{speedLimit} ms {showSpeedList ? '▴' : '▾'}</Text>
        </TouchableOpacity>
      </View>
      {showSpeedList ? (
        <View style={styles.speedList}>
          {SPEED_LIMIT_OPTIONS.map(v => (
            <TouchableOpacity
              key={v}
              style={[styles.speedItem, { backgroundColor: v === speedLimit ? theme['c-primary-background-active'] : 'transparent' }]}
              onPress={() => {
                updateSetting({ 'player.mergeSpeedLimit': v })
                setShowSpeedList(false)
              }}
            >
              <Text size={12}>{v} ms{v === speedLimit ? '  ✓' : ''}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.btnRow}>
        {
          running
            ? <Button onPress={handleCancel}><Text size={12} color={theme['c-button-font']}>取消合并</Text></Button>
            : <Button onPress={() => { void handleMerge() }}><Text size={12} color={theme['c-button-font']}>合并优质源</Text></Button>
        }
        <View style={styles.gap} />
        <Button onPress={() => { void handleRestore() }}><Text size={12} color={theme['c-button-font']}>还原</Text></Button>
      </View>

      <View style={[styles.logBox, { borderLeftColor: theme['c-primary'] }]}>
        <Text size={11} color={theme['c-font-label']}>播放日志 · 歌曲 / 音质 / 平台 / 采用哪个源解析</Text>
        <Text size={12} numberOfLines={1} style={styles.logCurrent}>{logLine}</Text>
      </View>

      {progress ? <Text size={11} color={theme['c-font-label']} style={styles.line}>{progress.text}（{progress.done}/{progress.total}）</Text> : null}
      {error ? <Text size={11} color={theme['c-font-label']} style={styles.line}>⚠ {error}</Text> : null}

      {result ? (
        <View style={styles.table}>
          <View style={styles.row}>
            <Text size={11} color={theme['c-font-label']} style={styles.c1}>平台</Text>
            <Text size={11} color={theme['c-font-label']} style={styles.c2}>采用源</Text>
            <Text size={11} color={theme['c-font-label']} style={styles.c3}>音质</Text>
            <Text size={11} color={theme['c-font-label']} style={styles.c4}>耗时</Text>
            <Text size={11} color={theme['c-font-label']} style={styles.c5}>结果</Text>
          </View>
          {outcomes.map(o => (
            <View style={styles.row} key={o.platform}>
              <Text size={11} style={styles.c1}>{PLATFORM_LABELS[o.platform] ?? o.platform}</Text>
              <Text size={11} style={styles.c2} numberOfLines={1}>{o.apiName}</Text>
              <Text size={11} style={styles.c3}>{o.quality}</Text>
              <Text size={11} style={styles.c4}>{o.kind === 'hit' ? `${o.ms}ms` : '-'}</Text>
              <Text size={11} style={styles.c5}>{o.kind === 'hit' ? '实测达标' : '回退'}</Text>
            </View>
          ))}
          <Text size={11} color={theme['c-font-label']} style={styles.line}>
            {result.at} · 阈值 {result.speedLimit}ms · 共检查 {result.scannedSources ?? 0}/{result.totalSources ?? 0} 个源 · {result.hitCount ?? 0}/4 个平台达标 · {result.attempts ?? 0} 次探测
          </Text>
          <Text size={11} color={theme['c-font-label']} style={styles.line}>
            最终内嵌 {embedded.length} 个源脚本（{embedded.join('、')}）
          </Text>
          {probeSongs.length ? (
            <Text size={11} color={theme['c-font-label']} style={styles.line}>
              本轮探测歌曲：{probeSongs.map(s => `${PLATFORM_LABELS[s.platform] ?? s.platform}《${s.songName}》[${s.from === 'board' ? '实时歌单' : '内置曲库'}]`).join(' · ')}
            </Text>
          ) : null}
          {result.legacy ? (
            <Text size={11} color={theme['c-font-label']} style={styles.line}>
              ⚠ 这是旧版本保存的合并结果，缺少探测歌曲等统计信息；重新合并一次即可补全。
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
})

const styles = createStyle({
  container: {
    marginTop: 4,
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  line: {
    marginBottom: 6,
  },
  speedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 6,
  },
  qualityHint: {
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 3,
    paddingBottom: 3,
    borderRadius: 4,
    marginRight: 10,
    overflow: 'hidden',
  },
  speedBtn: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 4,
    paddingBottom: 4,
    borderRadius: 4,
    marginLeft: 10,
  },
  speedList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  speedItem: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 4,
    paddingBottom: 4,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 4,
  },
  logBox: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    marginBottom: 8,
  },
  logCurrent: {
    marginTop: 3,
  },
  btnRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  gap: {
    width: 10,
  },
  table: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 3,
    paddingBottom: 3,
  },
  c1: { flex: 0.9 },
  c2: { flex: 2.6 },
  c3: { flex: 1 },
  c4: { flex: 0.9 },
  c5: { flex: 1.2 },
})
