/**
 * 三端云同步（手机版 / 电脑版 / 网页版）
 *
 * 与 WebDAV 备份的区别：
 * - 备份是「全量快照 + 覆盖恢复」，适合换机；
 * - 同步是「按歌单 / 按设置项合并」，适合手机和电脑同时用。
 *
 * 合并规则在服务端（LWW + deviceId 决胜），客户端只负责三件事：
 * 1. 收集本地数据，给每一项算一个「最后修改时间」；
 * 2. 推上去，拿回服务端合并后的全量；
 * 3. 把服务端比自己新的项应用到本地。
 *
 * 时间戳来源：本地没有逐条修改记录，所以用「内容哈希 + 上次同步快照」推断。
 * 内容没变就一直沿用旧时间戳，变了才用当前时间。这样两端交替修改时不会
 * 因为「每次同步都刷新时间戳」而永远互相覆盖。
 */
import { getData, saveData } from '@/plugins/storage'
import { LIST_IDS } from '@/config/constant'
import { getListMusics, overwriteList, createList, removeUserList, updateUserList, overwriteListMusics } from '@/core/list'
import { updateSetting } from '@/core/common'
import listState from '@/store/list/state'
import settingState from '@/store/setting/state'
import { getUserApiList, getUserApiScript, addUserApi, getUserTheme, saveUserTheme } from '@/utils/data'
import { state as userApiState, action as userApiAction } from '@/store/userApi'

const SNAPSHOT_KEY = 'cloudsync:snapshot'
const DEVICE_KEY = 'cloudsync:device'
const CLIENT = 'lx-music-mobile-mod'

/** 默认同步服务：与一起听、下载站同一个站点（网关要求带 sharecode） */
export const DEFAULT_SYNC_URL = 'https://af384ee6deb6e09e2.app.workbuddy.host/api/sync?sharecode=MKPWEVLBUS'

/**
 * 不同步的设置项。
 *
 * 判断标准是「跟着设备走还是跟着账号走」：
 * - 音量、亮度、桌面歌词坐标、下载目录、Cookie 属于设备本地状态，同步过去只会互相打架；
 * - sync.* 是同步凭据本身，绝不能上传；
 * - listenTogether.* 是服务器地址，各端可以不同。
 */
const SKIP_SETTING_PREFIX = ['sync.', 'listenTogether.', 'platform.']
const SKIP_SETTING_KEYS = [
  'theme.customBgImage',
  'common.isAgreePact',
  'common.drawerLayoutPosition',
  'common.homePageScroll',
  'common.alwaysKeepStatusbarHeight',
  'common.showExitBtn',
  'player.volume',
  'player.keepScreenOn',
  'player.islandLyric',
  'player.systemLyric',
  'desktopLyric.position.x',
  'desktopLyric.position.y',
  'desktopLyric.textPosition.x',
  'desktopLyric.textPosition.y',
  'desktopLyric.enable',
  'desktopLyric.isLock',
  'desktopLyric.width',
  'download.savePath',
  'download.concurrency',
]

export interface SyncItem {
  key: string
  kind: 'list' | 'favorite' | 'userApi' | 'theme'
  id: string
  name: string
  data: {
    list?: LX.Music.MusicInfo[]
    info?: Record<string, unknown>
    /** kind == 'userApi'：自定义源脚本文本 */
    script?: string
    /** kind == 'theme'：自定义主题 */
    theme?: LX.Theme
  }
  updatedAt: number
  deviceId: string
  deleted?: boolean
}

interface SettingEntry {
  value: unknown
  updatedAt: number
  deviceId: string
}

interface SnapshotItem {
  hash: string
  updatedAt: number
}

interface Snapshot {
  at: number
  deviceId: string
  items: Record<string, SnapshotItem>
  settings: Record<string, SnapshotItem>
}

export interface CloudSyncResult {
  at: number
  rev: number
  pushed: number
  pulled: number
  applied: number
  lists: number
  songs: number
  settings: number
  /** 云端保存的自定义音源数量 */
  userApis: number
  /** 云端保存的自定义主题数量 */
  themes: number
  warnings: string[]
}

const emptySnapshot = (deviceId = ''): Snapshot => ({ at: 0, deviceId, items: {}, settings: {} })

let syncPromise: Promise<CloudSyncResult> | null = null

/** 简单的字符串哈希（FNV-1a 32 位 + 长度），只用来判断内容有没有变，不做安全用途 */
const hashText = (text: string) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(16)}:${text.length}`
}

const hashSongs = (list: LX.Music.MusicInfo[]) => {
  // 只取影响「歌单内容」的字段，避免封面 URL 之类的临时字段导致误判
  const text = list.map(music => `${music.id}|${music.name}|${music.singer}`).join('\n')
  return hashText(text)
}

const getDeviceId = async() => {
  let id = await getData<string>(DEVICE_KEY)
  if (!id) {
    id = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    await saveData(DEVICE_KEY, id)
  }
  return id
}

const loadSnapshot = async(): Promise<Snapshot> => {
  const raw = await getData<Snapshot>(SNAPSHOT_KEY)
  if (!raw || typeof raw !== 'object' || !raw.items) return emptySnapshot()
  return {
    at: Number(raw.at) || 0,
    deviceId: String(raw.deviceId || ''),
    items: raw.items && typeof raw.items == 'object' ? raw.items : {},
    settings: raw.settings && typeof raw.settings == 'object' ? raw.settings : {},
  }
}

const saveSnapshot = async(snapshot: Snapshot) => {
  await saveData(SNAPSHOT_KEY, snapshot)
}

export const getSyncConfig = () => ({
  url: (settingState.setting['sync.cloudUrl'] || DEFAULT_SYNC_URL).trim(),
  code: (settingState.setting['sync.cloudCode'] || '').trim().toUpperCase(),
  secret: (settingState.setting['sync.cloudSecret'] || '').trim(),
})

/**
 * 把配置里的基地址拼成具体接口。
 *
 * 基地址允许自带查询串（默认地址就是 `/api/sync?sharecode=xxx`），
 * 所以 action 必须插在 **path 末尾**，不能直接接在整串后面：
 * 那样会拼成 `/api/sync?sharecode=xxx/create`，网关读到的 sharecode
 * 变成 `xxx/create`，校验不过直接回 403（且返回的是 HTML，客户端只看到
 * 「非 JSON 内容」）。
 */
const buildUrl = (base: string, action: string) => {
  const hashIndex = base.indexOf('#')
  const noHash = hashIndex == -1 ? base : base.slice(0, hashIndex)
  const qIndex = noHash.indexOf('?')
  const path = (qIndex == -1 ? noHash : noHash.slice(0, qIndex)).replace(/\/+$/, '')
  const query = qIndex == -1 ? '' : noHash.slice(qIndex + 1).replace(/^&+|&+$/g, '')
  const params = query ? `${query}&_=${Date.now()}` : `_=${Date.now()}`
  return `${path}/${action}?${params}`
}

const post = async<T>(base: string, action: string, body: Record<string, unknown>, timeout = 20000): Promise<T> => {
  const controller = typeof AbortController == 'undefined' ? null : new AbortController()
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null
  try {
    const res = await fetch(buildUrl(base, action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller?.signal,
    })
    let data: any
    try {
      data = await res.json()
    } catch {
      throw new Error(`同步服务返回了非 JSON 内容（HTTP ${res.status}）`)
    }
    if (!res.ok || !data?.ok) {
      const code = data?.error
      if (code == 'auth_failed') throw new Error('同步码或密钥不正确')
      if (code == 'code_exists') throw new Error('这个同步码已被占用，换一个')
      if (code == 'rate_limited') throw new Error('请求太频繁，稍后再试')
      if (code == 'space_too_large') throw new Error('同步空间已满（8MB），请清理歌单')
      throw new Error(`同步服务错误：${code || res.status}`)
    }
    return data as T
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 当前设置里哪些需要同步 */
const pickSettings = () => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settingState.setting)) {
    if (SKIP_SETTING_KEYS.includes(key)) continue
    if (SKIP_SETTING_PREFIX.some(prefix => key.startsWith(prefix))) continue
    out[key] = value
  }
  return out
}

const listKind = (id: string): SyncItem['kind'] => id == LIST_IDS.LOVE ? 'favorite' : 'list'

/** 收集本地歌单（试听列表与临时列表不参与同步） */
const collectLists = async(deviceId: string, snapshot: Snapshot, now: number) => {
  const items: SyncItem[] = []
  const targets: Array<{ id: string, name: string, info?: Record<string, unknown> }> = [
    { id: listState.defaultList.id, name: listState.defaultList.name },
    { id: listState.loveList.id, name: listState.loveList.name },
    ...listState.userList.map(list => ({
      id: String(list.id),
      name: list.name,
      info: {
        id: String(list.id),
        name: list.name,
        source: list.source ?? null,
        sourceListId: list.sourceListId ?? null,
        locationUpdateTime: list.locationUpdateTime ?? null,
      },
    })),
  ]

  for (const target of targets) {
    if (!target.id || target.id == LIST_IDS.TEMP) continue
    let musics: LX.Music.MusicInfo[]
    try {
      musics = await getListMusics(target.id)
    } catch {
      continue
    }
    const key = `list:${target.id}`
    const hash = hashSongs(musics)
    const prev = snapshot.items[key]
    const updatedAt = prev?.hash === hash ? prev.updatedAt : now
    items.push({
      key,
      kind: target.id == LIST_IDS.LOVE ? 'favorite' : 'list',
      id: target.id,
      name: target.name,
      data: { list: musics, info: target.info },
      updatedAt,
      deviceId,
    })
    snapshot.items[key] = { hash, updatedAt }
  }
  return items
}

/**
 * 收集「非歌单资产」：自定义音源脚本、自定义主题
 *
 * 这两类数据不在 settings 里，也不在歌单里，以前切设备就全丢：
 * 用户在新手机上登录同一个同步码，音源得重新导入、主题得重新调。
 * 这里把它们作为独立的 sync item 上传（kind 区分），服务端只按 key 存取，
 * 不需要改协议。
 *
 * 单个脚本超过 2MB 直接跳过：服务端整个空间只有 8MB，
 * 一个几百 KB 的混淆源塞进去就会把歌单挤爆，宁可不同步也要保证歌单能同步。
 */
const MAX_ASSET_BYTES = 2 * 1024 * 1024

const collectAssets = async(deviceId: string, snapshot: Snapshot, now: number) => {
  const items: SyncItem[] = []
  let warnings: string[] = []

  try {
    for (const info of await getUserApiList()) {
      const script = await getUserApiScript(info.id).catch(() => '')
      if (!script) continue
      if (script.length > MAX_ASSET_BYTES) {
        warnings.push(`音源「${info.name}」脚本过大，未同步`)
        continue
      }
      const key = `userApi:${info.id}`
      const hash = hashText(script)
      const prev = snapshot.items[key]
      const updatedAt = prev?.hash === hash ? prev.updatedAt : now
      items.push({
        key,
        kind: 'userApi',
        id: info.id,
        name: info.name,
        data: { info: info as unknown as Record<string, unknown>, script },
        updatedAt,
        deviceId,
      })
      snapshot.items[key] = { hash, updatedAt }
    }
  } catch (err) {
    warnings.push(`音源收集失败：${String((err as Error)?.message ?? err)}`)
  }

  try {
    for (const theme of await getUserTheme()) {
      if (!theme?.id) continue
      const key = `theme:${theme.id}`
      const hash = hashText(JSON.stringify(theme))
      const prev = snapshot.items[key]
      const updatedAt = prev?.hash === hash ? prev.updatedAt : now
      items.push({
        key,
        kind: 'theme',
        id: String(theme.id),
        name: String(theme.name || theme.id),
        data: { theme },
        updatedAt,
        deviceId,
      })
      snapshot.items[key] = { hash, updatedAt }
    }
  } catch (err) {
    warnings.push(`主题收集失败：${String((err as Error)?.message ?? err)}`)
  }

  return { items, warnings }
}

/** 应用远端的一条资产（音源脚本 / 主题） */
const applyRemoteAsset = async(item: SyncItem, warnings: string[]) => {
  try {
    if (item.kind == 'userApi') {
      const script = item.data?.script
      if (!script) return false
      const info = (item.data?.info ?? {}) as { name?: string, version?: string }
      const name = String(info.name || item.name || '')
      // 音源 id 是导入时随机生成的，跨设备必然不同，只能按「名称 + 版本」判重。
      // 已经存在就跳过：脚本内容相同，重复导入只会让列表里出现两个同名源。
      if (userApiState.list.some(api => api.name == name && String(api.version ?? '') == String(info.version ?? ''))) return true
      const added = await addUserApi(script)
      userApiAction.addUserApi(added)
      return true
    }

    if (item.kind == 'theme') {
      const theme = item.data?.theme
      if (!theme?.id) return false
      const list = await getUserTheme()
      if (list.some(t => t.id === theme.id)) return true
      await saveUserTheme([...list, theme])
      return true
    }
  } catch (err) {
    warnings.push(`${item.kind == 'userApi' ? '音源' : '主题'}「${item.name || item.id}」${String((err as Error)?.message ?? err)}`)
  }
  return false
}

/** 收集设置项 */
const collectSettings = (deviceId: string, snapshot: Snapshot, now: number) => {
  const settings: Record<string, SettingEntry> = {}
  for (const [key, value] of Object.entries(pickSettings())) {
    const hash = hashText(JSON.stringify(value ?? null))
    const prev = snapshot.settings[key]
    const updatedAt = prev?.hash === hash ? prev.updatedAt : now
    settings[key] = { value, updatedAt, deviceId }
    snapshot.settings[key] = { hash, updatedAt }
  }
  return settings
}

/** 应用远端的一条歌单 */
const applyRemoteList = async(item: SyncItem, warnings: string[]) => {
  const id = String(item.id || '')
  if (!id) return false
  try {
    if (item.deleted) {
      if (id == LIST_IDS.DEFAULT || id == LIST_IDS.LOVE) {
        await overwriteListMusics(id, [])
      } else if (listState.userList.some(list => String(list.id) == id)) {
        await removeUserList([id])
      }
      return true
    }

    const musics = Array.isArray(item.data?.list) ? item.data.list : []
    const info = (item.data?.info ?? {}) as Record<string, unknown>
    if (id == LIST_IDS.DEFAULT || id == LIST_IDS.LOVE) {
      await overwriteList({
        id,
        name: id == LIST_IDS.LOVE ? listState.loveList.name : listState.defaultList.name,
        list: musics,
      } as LX.List.MyLoveListInfoFull)
      return true
    }

    const exists = listState.userList.some(list => String(list.id) == id)
    if (exists) {
      await updateUserList([{
        id,
        name: String(info.name || item.name || id),
        source: info.source as LX.OnlineSource | undefined,
        sourceListId: info.sourceListId as string | undefined,
        locationUpdateTime: (info.locationUpdateTime as number | null) ?? null,
      }])
      await overwriteListMusics(id, musics)
    } else {
      await createList({
        id,
        name: String(info.name || item.name || id),
        list: musics,
        source: info.source as LX.OnlineSource | undefined,
        sourceListId: info.sourceListId as string | undefined,
        position: listState.userList.length,
      })
    }
    return true
  } catch (err) {
    warnings.push(`歌单「${item.name || item.id}」${String((err as Error)?.message ?? err)}`)
    return false
  }
}

/**
 * 执行一次双向同步。
 *
 * 并发保护：同一时刻只跑一个同步。用户连点「立即同步」或自动同步和手动同步
 * 撞在一起时，第二次直接复用第一次的结果，避免同一份快照被写乱。
 */
export const syncCloud = async(): Promise<CloudSyncResult> => {
  if (syncPromise) return syncPromise
  syncPromise = (async() => {
    const { url, code, secret } = getSyncConfig()
    if (!url) throw new Error('请先填写同步服务地址')
    if (!code || !secret) throw new Error('请先填写同步码与密钥')

    const deviceId = await getDeviceId()
    const snapshot = await loadSnapshot()
    const now = Date.now()
    const warnings: string[] = []

    const items = await collectLists(deviceId, snapshot, now)
    const assets = await collectAssets(deviceId, snapshot, now)
    items.push(...assets.items)
    warnings.push(...assets.warnings)
    const settings = collectSettings(deviceId, snapshot, now)

    const pushed = await post<{ rev: number, items: Record<string, SyncItem>, settings: Record<string, SettingEntry>, serverTime: number }>(
      url, 'push', { code, secret, deviceId, deviceName: `${CLIENT} · Android`, items, settings },
    )

    let applied = 0
    for (const [key, remote] of Object.entries(pushed.items ?? {})) {
      const local = snapshot.items[key]
      // 只有「服务端比本地快照新」才落地，否则会把本地刚改的内容覆盖回去
      if (local && remote.updatedAt <= local.updatedAt) continue
      if (remote.kind == 'userApi' || remote.kind == 'theme') {
        if (await applyRemoteAsset(remote, warnings)) {
          applied++
          snapshot.items[key] = {
            hash: hashText(remote.kind == 'userApi' ? String(remote.data?.script ?? '') : JSON.stringify(remote.data?.theme ?? null)),
            updatedAt: remote.updatedAt,
          }
        }
        continue
      }
      if (await applyRemoteList(remote, warnings)) {
        applied++
        snapshot.items[key] = {
          hash: remote.deleted ? '' : hashSongs(Array.isArray(remote.data?.list) ? remote.data.list : []),
          updatedAt: remote.updatedAt,
        }
      }
    }

    // 设置：先收集所有要写的键，一次性 updateSetting，避免每项都触发一次重渲染
    const settingPatch: Record<string, unknown> = {}
    for (const [key, remote] of Object.entries(pushed.settings ?? {})) {
      const local = snapshot.settings[key]
      if (local && remote.updatedAt <= local.updatedAt) continue
      if (SKIP_SETTING_KEYS.includes(key) || SKIP_SETTING_PREFIX.some(prefix => key.startsWith(prefix))) continue
      settingPatch[key] = remote.value
      snapshot.settings[key] = {
        hash: hashText(JSON.stringify(remote.value ?? null)),
        updatedAt: remote.updatedAt,
      }
      applied++
    }
    if (Object.keys(settingPatch).length) {
      try {
        updateSetting(settingPatch as Partial<LX.AppSetting>)
      } catch (err) {
        warnings.push(`设置 ${String((err as Error)?.message ?? err)}`)
      }
    }

    snapshot.at = Date.now()
    snapshot.deviceId = deviceId
    await saveSnapshot(snapshot)

    const visible = Object.values(pushed.items ?? {}).filter(item => !item.deleted)
    const listItems = visible.filter(item => item.kind == 'list' || item.kind == 'favorite')
    return {
      at: snapshot.at,
      rev: pushed.rev,
      pushed: items.length + Object.keys(settings).length,
      pulled: Object.keys(pushed.items ?? {}).length + Object.keys(pushed.settings ?? {}).length,
      applied,
      lists: listItems.length,
      songs: listItems.reduce((total, item) => total + (Array.isArray(item.data?.list) ? item.data.list.length : 0), 0),
      settings: Object.keys(pushed.settings ?? {}).length,
      userApis: visible.filter(item => item.kind == 'userApi').length,
      themes: visible.filter(item => item.kind == 'theme').length,
      warnings,
    }
  })()
  try {
    return await syncPromise
  } finally {
    syncPromise = null
  }
}

/** 新建一个同步空间，成功后写回设置 */
export const createCloudSpace = async(customCode?: string) => {
  const { url } = getSyncConfig()
  if (!url) throw new Error('请先填写同步服务地址')
  const deviceId = await getDeviceId()
  const result = await post<{ code: string, secret: string }>(url, 'create', {
    code: customCode?.trim() || undefined,
    deviceId,
    deviceName: `${CLIENT} · Android`,
  })
  updateSetting({
    'sync.cloudCode': result.code,
    'sync.cloudSecret': result.secret,
  })
  await saveSnapshot(emptySnapshot(deviceId))
  return result
}

/** 读取服务端空间信息（不写入本地） */
export const readCloudSpaceInfo = async() => {
  const { url, code, secret } = getSyncConfig()
  if (!code || !secret) throw new Error('请先填写同步码与密钥')
  return post<{
    code: string
    rev: number
    updatedAt: number
    deviceName: string
    lists: number
    favorites: number
    songs: number
    settings: number
    bytes: number
  }>(url, 'info', { code, secret })
}

/** 断开同步：清掉凭据与快照，不动本地数据 */
export const resetCloudSync = async() => {
  await saveSnapshot(emptySnapshot())
  updateSetting({
    'sync.cloudCode': '',
    'sync.cloudSecret': '',
  })
}

/** 把当前手机端的数据当成初始版本推到服务端（清空快照后全量推一次） */
export const pushAllToCloud = async() => {
  await saveSnapshot(emptySnapshot(await getDeviceId()))
  return syncCloud()
}
