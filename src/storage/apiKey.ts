/**
 * AI Gateway API キーの保存。
 *
 * なぜ localStorage だけか: 本サイトはバックエンドを持たない静的配信で、キーを預かる先が
 * 利用者のブラウザしかない。Cookie にするとリクエストに乗って送出されるので使わない。
 * キーの値はここから外（console・ログ・export）へは一切出さない。
 *
 * localStorage はプライベートモードや保存領域の制限、SecurityError（サンドボックス iframe）で
 * 例外を投げうる。キーが読めない＝未設定として扱い、アプリ全体は落とさない。
 */

export const API_KEY_STORAGE_KEY = 'dq3arena.aiGatewayApiKey'

/** テスト用に差し替えられる最小限の Storage */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): KeyValueStorage | null {
  try {
    // globalThis.localStorage の参照自体が SecurityError を投げるブラウザがある
    const s = (globalThis as { localStorage?: KeyValueStorage }).localStorage
    return s ?? null
  } catch {
    return null
  }
}

export function loadApiKey(storage: KeyValueStorage | null = defaultStorage()): string | null {
  if (!storage) return null
  try {
    const v = storage.getItem(API_KEY_STORAGE_KEY)
    return v && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

/**
 * 保存できたら true。空文字は削除として扱う（入力欄を空にして保存＝消去、の直感に合わせる）。
 * 失敗時に例外ではなく false を返すのは、UI が「このブラウザでは保存できない」と表示するだけで済むため。
 */
export function saveApiKey(key: string, storage: KeyValueStorage | null = defaultStorage()): boolean {
  const trimmed = key.trim()
  if (!trimmed) return clearApiKey(storage)
  if (!storage) return false
  try {
    storage.setItem(API_KEY_STORAGE_KEY, trimmed)
    return true
  } catch {
    return false
  }
}

export function clearApiKey(storage: KeyValueStorage | null = defaultStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(API_KEY_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function hasApiKey(storage: KeyValueStorage | null = defaultStorage()): boolean {
  return loadApiKey(storage) !== null
}
