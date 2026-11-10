import { memo, useState } from 'react'
import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import InputItem from '../../components/InputItem'
import Button from '../../components/Button'
import CommonButton from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { updateSetting } from '@/core/common'
import { confirmDialog, createStyle, toast } from '@/utils/tools'
import {
  createCloudSpace,
  pushAllToCloud,
  readCloudSpaceInfo,
  resetCloudSync,
  syncCloud,
  DEFAULT_SYNC_URL,
} from '@/core/sync/cloudSync'

const formatTime = (at: number) => {
  if (!at) return ''
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const url = useSettingValue('sync.cloudUrl')
  const code = useSettingValue('sync.cloudCode')
  const secret = useSettingValue('sync.cloudSecret')
  const auto = useSettingValue('sync.cloudAuto')
  const lastAt = useSettingValue('sync.cloudLastAt')

  const [busy, setBusy] = useState<'' | 'sync' | 'create' | 'info' | 'push'>('')
  const [info, setInfo] = useState<{ lists: number, songs: number, settings: number, bytes: number, rev: number } | null>(null)

  const run = async(type: typeof busy, action: () => Promise<void>) => {
    if (busy) return
    setBusy(type)
    try {
      await action()
    } catch (err) {
      toast(t('setting_cloud_sync_failed', { msg: String((err as Error)?.message ?? err) }), 'long')
    } finally {
      setBusy('')
    }
  }

  const handleSync = async() => {
    await run('sync', async() => {
      const result = await syncCloud()
      updateSetting({ 'sync.cloudLastAt': result.at })
      toast(t('setting_cloud_sync_ok', { lists: result.lists, songs: result.songs, settings: result.settings }))
      if (result.warnings.length) console.warn('cloud sync warnings', result.warnings)
    })
  }

  const handleCreate = () => {
    void confirmDialog({
      message: t('setting_cloud_sync_create_confirm'),
      confirmButtonText: t('setting_cloud_sync_create'),
    }).then(async(isConfirm) => {
      if (!isConfirm) return
      await run('create', async() => {
        const result = await createCloudSpace()
        toast(t('setting_cloud_sync_create_ok', { code: result.code }), 'long')
      })
    })
  }

  const handlePushAll = () => {
    void confirmDialog({
      message: t('setting_cloud_sync_push_all_confirm'),
      confirmButtonText: t('setting_cloud_sync_push_all'),
    }).then(async(isConfirm) => {
      if (!isConfirm) return
      await run('push', async() => {
        const result = await pushAllToCloud()
        updateSetting({ 'sync.cloudLastAt': result.at })
        toast(t('setting_cloud_sync_ok', { lists: result.lists, songs: result.songs, settings: result.settings }))
      })
    })
  }

  const handleInfo = async() => {
    await run('info', async() => {
      const data = await readCloudSpaceInfo()
      setInfo({ lists: data.lists, songs: data.songs, settings: data.settings, bytes: data.bytes, rev: data.rev })
      toast(t('setting_cloud_sync_space_info', {
        code: data.code,
        lists: data.lists,
        songs: data.songs,
        size: formatBytes(data.bytes),
      }), 'long')
    })
  }

  const handleReset = () => {
    void confirmDialog({
      message: t('setting_cloud_sync_reset_confirm'),
      confirmButtonText: t('setting_cloud_sync_reset'),
    }).then(async(isConfirm) => {
      if (!isConfirm) return
      await resetCloudSync()
      setInfo(null)
      toast(t('setting_cloud_sync_reset_ok'))
    })
  }

  const infoText = info
    ? t('setting_cloud_sync_space_info', { code: code || '-', lists: info.lists, songs: info.songs, size: formatBytes(info.bytes) })
    : lastAt
      ? t('setting_cloud_sync_result', { time: formatTime(lastAt) })
      : t('setting_cloud_sync_never')

  return (
    <SubTitle title={t('setting_cloud_sync')}>
      <Text size={11} color={theme['c-font-label']} style={styles.tip}>{t('setting_cloud_sync_tip')}</Text>
      <InputItem
        value={url}
        label={t('setting_cloud_sync_url')}
        onChanged={(value) => { updateSetting({ 'sync.cloudUrl': value.trim() }) }}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={DEFAULT_SYNC_URL}
      />
      <InputItem
        value={code}
        label={t('setting_cloud_sync_code')}
        onChanged={(value) => { updateSetting({ 'sync.cloudCode': value.trim().toUpperCase() }) }}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={t('setting_cloud_sync_code_placeholder')}
      />
      <InputItem
        value={secret}
        label={t('setting_cloud_sync_secret')}
        onChanged={(value) => { updateSetting({ 'sync.cloudSecret': value.trim() }) }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('setting_cloud_sync_secret_placeholder')}
      />
      <View style={styles.autoContent}>
        <Text size={13} color={theme['c-600']}>{t('setting_cloud_sync_auto')}</Text>
        <View style={styles.autoBtns}>
          {(['off', 'startup', 'always'] as const).map(mode => {
            const active = auto == mode
            return (
              <CommonButton
                key={mode}
                onPress={() => { updateSetting({ 'sync.cloudAuto': mode }) }}
                style={[styles.autoBtn, { backgroundColor: active ? theme['c-primary-background-active'] : theme['c-button-background'] }]}
              >
                <Text size={12} color={active ? theme['c-primary-font'] : theme['c-button-font']}>{t(`setting_cloud_sync_auto_${mode}`)}</Text>
              </CommonButton>
            )
          })}
        </View>
      </View>
      <View style={styles.btnContent}>
        <Button onPress={handleSync} disabled={!!busy}>{busy == 'sync' ? t('setting_cloud_sync_busy') : t('setting_cloud_sync_now')}</Button>
        <Button onPress={handleInfo} disabled={!!busy}>{t('setting_cloud_sync_info')}</Button>
        <Button onPress={handleCreate} disabled={!!busy}>{t('setting_cloud_sync_create')}</Button>
        <Button onPress={handlePushAll} disabled={!!busy}>{busy == 'push' ? t('setting_cloud_sync_busy') : t('setting_cloud_sync_push_all')}</Button>
        <Button onPress={handleReset} disabled={!!busy}>{t('setting_cloud_sync_reset')}</Button>
      </View>
      <Text size={11} color={theme['c-font-label']} style={styles.meta}>{infoText}</Text>
    </SubTitle>
  )
})

const styles = createStyle({
  tip: {
    paddingLeft: 25,
    marginTop: -6,
    marginBottom: 10,
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
  meta: {
    paddingLeft: 25,
    marginTop: -4,
    marginBottom: 8,
  },
  autoContent: {
    paddingLeft: 25,
    paddingRight: 15,
    marginBottom: 10,
  },
  autoBtns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  autoBtn: {
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 5,
    paddingBottom: 5,
    borderRadius: 4,
  },
})
