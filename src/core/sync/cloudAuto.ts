/**
 * 三端同步的自动触发
 *
 * - startup：App 启动后延迟一小段时间同步一次（避开冷启动的 IO 高峰）；
 * - always：额外在切到后台时再同步一次，让电脑端尽快看到手机上的改动。
 *
 * 失败一律静默：自动同步是后台行为，弹 toast 会打断正在听歌的用户。
 * 设置页的「上次同步时间」只有在成功时才会更新。
 */
import { AppState, type AppStateStatus } from 'react-native'

import settingState from '@/store/setting/state'
import { updateSetting } from '@/core/common'
import { syncCloud } from './cloudSync'

let running = false
let inited = false

const canRun = () => {
  const setting = settingState.setting
  return Boolean(setting['sync.cloudCode'] && setting['sync.cloudSecret'])
}

const run = async(reason: string) => {
  if (running || !canRun()) return
  running = true
  try {
    const result = await syncCloud()
    updateSetting({ 'sync.cloudLastAt': result.at })
    if (result.warnings.length) console.warn('cloud auto sync warnings', result.warnings)
    console.log(`cloud sync (${reason}) done`, result.lists, result.songs, result.applied)
  } catch (err) {
    console.warn(`cloud auto sync (${reason}) failed`, err)
  } finally {
    running = false
  }
}

export const initCloudAutoSync = () => {
  if (inited) return
  inited = true

  const handleAppState = (state: AppStateStatus) => {
    if (state == 'background' && settingState.setting['sync.cloudAuto'] == 'always') void run('background')
  }
  AppState.addEventListener('change', handleAppState)

  if (settingState.setting['sync.cloudAuto'] != 'off') {
    setTimeout(() => { void run('startup') }, 8000)
  }
}
