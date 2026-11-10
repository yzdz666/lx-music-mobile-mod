import { memo, useRef, useState } from 'react'
import { View, ScrollView, TouchableOpacity } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import Dialog, { type DialogType } from '@/components/common/Dialog'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast } from '@/utils/tools'
import { getPlayReport, clearPlayStats, type PlayReport as Report, type ReportRange } from '@/core/playStats'

const RANGES: ReportRange[] = ['week', 'month', 'year', 'all']

const formatDuration = (sec: number) => {
  if (sec < 60) return `${Math.round(sec)} 秒`
  const minutes = Math.round(sec / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
}

const SOURCE_NAMES: Record<string, string> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ 音乐',
  wy: '网易云',
  mg: '咪咕',
  bd: '百度',
  local: '本地',
}

const Bar = ({ value, max, color, height = 6 }: { value: number, max: number, color: string, height?: number }) => {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <View style={[styles.barTrack, { height }]}>
      <View style={{ width: `${width}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  )
}

const ReportContent = ({ report }: { report: Report }) => {
  const theme = useTheme()
  const t = useI18n()
  const maxSongPlays = report.topSongs[0]?.plays ?? 0
  const maxArtistPlays = report.topArtists[0]?.plays ?? 0
  const maxSourcePlays = report.sources[0]?.plays ?? 0
  const maxHour = Math.max(1, ...report.hours)
  const maxDay = Math.max(1, ...report.daily.map(d => d.sec))

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryCell}>
          <Text size={16} color={theme['c-primary-font']}>{formatDuration(report.totalSec)}</Text>
          <Text size={11} color={theme['c-font-label']}>{t('report_total_time')}</Text>
        </View>
        <View style={styles.summaryCell}>
          <Text size={16} color={theme['c-primary-font']}>{report.totalPlays}</Text>
          <Text size={11} color={theme['c-font-label']}>{t('report_total_plays')}</Text>
        </View>
        <View style={styles.summaryCell}>
          <Text size={16} color={theme['c-primary-font']}>{report.songCount}</Text>
          <Text size={11} color={theme['c-font-label']}>{t('report_song_count')}</Text>
        </View>
        <View style={styles.summaryCell}>
          <Text size={16} color={theme['c-primary-font']}>{report.artistCount}</Text>
          <Text size={11} color={theme['c-font-label']}>{t('report_artist_count')}</Text>
        </View>
      </View>

      {report.streak > 1 && (
        <Text size={12} color={theme['c-primary-font']} style={styles.streak}>{t('report_streak', { days: report.streak })}</Text>
      )}

      {report.daily.length > 1 && (
        <View style={styles.block}>
          <Text size={13} style={styles.blockTitle}>{t('report_daily')}</Text>
          <View style={styles.dailyChart}>
            {report.daily.slice(-30).map(day => (
              <View key={day.date} style={styles.dailyCol}>
                <View style={[styles.dailyBar, {
                  height: Math.max(2, Math.round((day.sec / maxDay) * 46)),
                  backgroundColor: day.sec > 0 ? theme['c-primary-font'] : theme['c-border-background'],
                }]} />
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.block}>
        <Text size={13} style={styles.blockTitle}>{t('report_top_songs')}</Text>
        {report.topSongs.length == 0 && <Text size={12} color={theme['c-font-label']}>{t('report_empty')}</Text>}
        {report.topSongs.slice(0, 10).map((song, index) => (
          <View key={song.key} style={styles.row}>
            <Text size={12} color={theme['c-font-label']} style={styles.rank}>{index + 1}</Text>
            <View style={styles.rowMain}>
              <Text size={13} numberOfLines={1}>{song.name || '未知歌曲'}</Text>
              <Text size={11} color={theme['c-font-label']} numberOfLines={1}>{song.singer || '未知歌手'}</Text>
              <Bar value={song.plays} max={maxSongPlays} color={theme['c-primary-font']} />
            </View>
            <Text size={11} color={theme['c-font-label']} style={styles.count}>{song.plays}</Text>
          </View>
        ))}
      </View>

      <View style={styles.block}>
        <Text size={13} style={styles.blockTitle}>{t('report_top_artists')}</Text>
        {report.topArtists.length == 0 && <Text size={12} color={theme['c-font-label']}>{t('report_empty')}</Text>}
        {report.topArtists.slice(0, 8).map((artist, index) => (
          <View key={artist.name} style={styles.row}>
            <Text size={12} color={theme['c-font-label']} style={styles.rank}>{index + 1}</Text>
            <View style={styles.rowMain}>
              <Text size={13} numberOfLines={1}>{artist.name}</Text>
              <Bar value={artist.plays} max={maxArtistPlays} color={theme['c-primary-font']} />
            </View>
            <Text size={11} color={theme['c-font-label']} style={styles.count}>{artist.plays}</Text>
          </View>
        ))}
      </View>

      {report.sources.length > 0 && (
        <View style={styles.block}>
          <Text size={13} style={styles.blockTitle}>{t('report_sources')}</Text>
          {report.sources.map(source => (
            <View key={source.source} style={styles.row}>
              <Text size={12} style={styles.rank}>{SOURCE_NAMES[source.source] ?? source.source ?? '未知'}</Text>
              <View style={styles.rowMain}>
                <Bar value={source.plays} max={maxSourcePlays} color={theme['c-primary-font']} />
              </View>
              <Text size={11} color={theme['c-font-label']} style={styles.count}>{source.plays}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.block}>
        <Text size={13} style={styles.blockTitle}>{t('report_hours')}</Text>
        <View style={styles.hourChart}>
          {report.hours.map((count, hour) => (
            <View key={hour} style={styles.hourCol}>
              <View style={[styles.hourBar, {
                height: Math.max(1, Math.round((count / maxHour) * 40)),
                backgroundColor: count > 0 ? theme['c-primary-font'] : theme['c-border-background'],
              }]} />
              {hour % 6 == 0 ? <Text size={8} color={theme['c-font-label']}>{hour}</Text> : null}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  )
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const dialogRef = useRef<DialogType>(null)
  const [range, setRange] = useState<ReportRange>('month')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async(next: ReportRange) => {
    setLoading(true)
    try {
      setReport(await getPlayReport(next))
    } catch (err) {
      toast(String((err as Error)?.message ?? err))
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = () => {
    dialogRef.current?.setVisible(true)
    void load(range)
  }

  const handleRange = (next: ReportRange) => {
    setRange(next)
    void load(next)
  }

  const handleClear = () => {
    void clearPlayStats().then(() => {
      setReport(null)
      toast(t('report_empty'))
      dialogRef.current?.setVisible(false)
    })
  }

  return (
    <SubTitle title={t('setting_play_report')}>
      <Text size={11} color={theme['c-font-label']} style={styles.tip}>{t('setting_play_report_desc')}</Text>
      <View style={styles.btnContent}>
        <Button onPress={handleOpen}>{t('setting_play_report_open')}</Button>
        <Button onPress={handleClear}>{t('report_clear')}</Button>
      </View>
      <Dialog ref={dialogRef} title={t('report_title')} height="78%">
        <View style={styles.rangeRow}>
          {RANGES.map(item => (
            <TouchableOpacity key={item} onPress={() => { handleRange(item) }} style={[styles.rangeBtn, {
              backgroundColor: range == item ? theme['c-primary-background-active'] : theme['c-button-background'],
            }]}>
              <Text size={12} color={range == item ? theme['c-primary-font'] : theme['c-button-font']}>{t(`report_range_${item}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {loading && <Text size={12} color={theme['c-font-label']} style={styles.loading}>{t('report_loading')}</Text>}
        {!loading && report && <ReportContent report={report} />}
      </Dialog>
    </SubTitle>
  )
})

const styles = createStyle({
  tip: {
    paddingLeft: 25,
    marginTop: -6,
    marginBottom: 8,
    lineHeight: 16,
    paddingRight: 15,
  },
  btnContent: {
    paddingLeft: 25,
    paddingRight: 15,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  rangeBtn: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 4,
    paddingBottom: 4,
    borderRadius: 4,
  },
  loading: {
    padding: 20,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingLeft: 12,
    paddingRight: 12,
    paddingBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  summaryCell: {
    width: '50%',
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: 'center',
  },
  streak: {
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 6,
  },
  block: {
    marginTop: 12,
  },
  blockTitle: {
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
  },
  rank: {
    width: 26,
    textAlign: 'left',
  },
  rowMain: {
    flex: 1,
    paddingRight: 8,
  },
  count: {
    width: 34,
    textAlign: 'right',
  },
  barTrack: {
    marginTop: 3,
    borderRadius: 3,
    overflow: 'hidden',
  },
  dailyChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 52,
  },
  dailyCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  dailyBar: {
    width: '62%',
    borderRadius: 2,
  },
  hourChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 54,
    marginTop: 4,
  },
  hourCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  hourBar: {
    width: '70%',
    borderRadius: 1,
    marginBottom: 2,
  },
})
