// 「合并优质源」探测歌曲来源
//
// 关键原则：**每个平台只用它自己平台的歌**，绝不拿一首网易云的歌去测 QQ/酷我/酷狗。
// 每轮合并开始时，为 4 个平台各准备 1 首歌并固定使用（保证多个源在同一平台上可比）：
//   1) 优先调 LX 内置的排行榜/歌单接口 musicSdk[p].leaderboard.getList(bangId, 1)
//      实时抓回该平台真实歌单，再从返回列表里随机抽 1 首；榜单 id 本来就是 App 内置常量。
//   2) 接口失败/超时/无数据时，回退到 probeSongs.json（从四平台真实歌单解析出的每平台 40 首），
//      同样真随机抽 1 首。
import musicSdk from '@/utils/musicSdk'
import probeSongs from './probeSongs.json'
import { MERGE_PLATFORMS } from './mergeScript'
import type { MergePlatform } from './mergeScript'

export interface ProbeSong {
  songmid: string
  name: string
  singer: string
  album: string
}

/** 一轮探测用的歌：info 直接喂给音源脚本，label 用于在结果里说明来源 */
export interface ProbePick {
  info: Record<string, unknown>
  songName: string
  from: 'board' | 'local'
  detail: string
}

/** 各平台内置榜单 id（来自各平台 leaderboard.js 的 topList / boardList） */
const BOARD_IDS: Record<MergePlatform, string[]> = {
  wy: ['19723756', '3779629', '3778678', '2884035'],
  tx: ['4', '26', '62', '27'],
  kw: ['93', '17', '16', '158'],
  kg: ['8888', '6666', '52144', '24971'],
}

const PLATFORM_NAMES: Record<MergePlatform, string> = {
  wy: '网易云', tx: 'QQ音乐', kw: '酷我', kg: '酷狗',
}

const FALLBACK_SONGS = probeSongs as Record<MergePlatform, ProbeSong[]>

const withTimeout = async<T>(p: Promise<T>, ms: number): Promise<T> => Promise.race([
  p,
  new Promise<T>((_resolve, reject) => {
    setTimeout(() => { reject(new Error('歌单请求超时')) }, ms)
  }),
])

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]

/** 补全音源脚本常用的各种字段别名（与 LX 音源测试器 buildMusicInfo 保持一致） */
export const buildProbeMusicInfo = (platform: MergePlatform, song: ProbeSong): Record<string, unknown> => {
  const id = song.songmid
  const numeric = /^\d+$/.test(id)
  return {
    source: platform,
    songmid: id,
    id: numeric && id.length < 16 ? Number(id) : id,
    rid: numeric ? Number(id) : id,
    songId: id,
    musicId: id,
    musicrid: id,
    hash: id,
    FileHash: id,
    HQFileHash: id,
    SQFileHash: id,
    name: song.name,
    songname: song.name,
    songName: song.name,
    singer: song.singer,
    artist: song.singer,
    singername: song.singer,
    albumName: song.album,
    album: song.album,
    interval: '',
    _types: {},
    meta: {},
  }
}

const fromFallback = (platform: MergePlatform, reason?: string): ProbePick => {
  const song = pick(FALLBACK_SONGS[platform])
  return {
    info: buildProbeMusicInfo(platform, song),
    songName: song.name,
    from: 'local',
    detail: reason ? `内置曲库（${reason}）` : '内置曲库',
  }
}

/** 为单个平台准备 1 首歌：实时歌单优先，失败回退内置曲库 */
const pickForPlatform = async(platform: MergePlatform): Promise<ProbePick> => {
  try {
    const sdk = (musicSdk as any)[platform]?.leaderboard
    if (!sdk?.getList) return fromFallback(platform, '该平台无歌单接口')
    const bangId = pick(BOARD_IDS[platform])
    const res = await withTimeout(Promise.resolve(sdk.getList(bangId, 1)), 6000) as {
      list?: Array<Record<string, any>>
    }
    const list = res?.list?.filter(item => item && (item.songmid ?? item.hash ?? item.id))
    if (!list?.length) return fromFallback(platform, '歌单无有效歌曲')
    const raw = pick(list)
    const songmid = String(raw.songmid ?? raw.hash ?? raw.id)
    const song: ProbeSong = {
      songmid,
      name: String(raw.name ?? raw.songname ?? '未知歌曲'),
      singer: String(raw.singer ?? raw.artist ?? ''),
      album: String(raw.album ?? raw.albumName ?? ''),
    }
    return {
      // 别名打底，原始 MusicInfo 字段覆盖（kg 的真实 hash、tx 的 strMediaMid 等都在里面）
      info: Object.assign(buildProbeMusicInfo(platform, song), raw, { source: platform, songmid }),
      songName: song.name,
      from: 'board',
      detail: `${PLATFORM_NAMES[platform]}歌单 #${bangId}`,
    }
  } catch (err) {
    return fromFallback(platform, err instanceof Error ? err.message : '歌单获取失败')
  }
}

/** 一轮合并只调用一次：4 个平台并发准备，各平台互不干扰 */
export const prepareProbeSongs = async(
  platforms: readonly MergePlatform[] = MERGE_PLATFORMS,
): Promise<Record<string, ProbePick>> => {
  const result: Record<string, ProbePick> = {}
  await Promise.all(platforms.map(async platform => {
    result[platform] = await pickForPlatform(platform)
  }))
  return result
}
