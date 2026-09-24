/**
 * localStorage の汎用ラッパ。
 *
 * - プライベートブラウズ・容量超過・ストレージ無効化で例外が出てもアプリを落とさないため、
 *   すべての読み書きを try/catch で包み、失敗は戻り値で返す。
 * - 保存形式を後から変えても古いデータで壊れないよう、値は `{ v, data }` の
 *   エンベロープに入れてスキーマバージョンを持たせる。バージョン不一致は migrate に任せ、
 *   migrate できなければ「無かったこと」にする（壊れた値で起動不能になるより安全）。
 */

/** テストでメモリ実装に差し替えられるよう、Storage の必要最小限だけに依存する */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** すべてのキーに付ける接頭辞。同一オリジン（GitHub Pages の github.io）で他アプリと衝突させないため */
export const STORAGE_PREFIX = 'dq3arena.'

interface Envelope {
  v: number
  data: unknown
}

export interface VersionedStoreOptions<T> {
  /** 接頭辞を除いたキー名 */
  key: string
  version: number
  /** 読み込んだ値の最低限の形チェック。外部から改変されうるため型アサーションだけに頼らない */
  validate: (data: unknown) => data is T
  /** 旧バージョンからの移行。未定義または null を返すと破棄 */
  migrate?: (fromVersion: number, data: unknown) => T | null
  storage?: KeyValueStorage
}

export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'unavailable' | 'unknown'; error: unknown }

export interface VersionedStore<T> {
  readonly fullKey: string
  load(): T | null
  save(data: T): SaveResult
  clear(): void
  /** 保存されている文字列の長さ（無ければ 0）。容量の目安表示に使う */
  size(): number
}

/** window が無い環境（Vitest の node 環境・SSR）や、アクセス自体が例外になる環境でも安全に取得する */
export function defaultStorage(): KeyValueStorage | null {
  try {
    const s = (globalThis as { localStorage?: KeyValueStorage }).localStorage
    return s ?? null
  } catch {
    return null
  }
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error) && !(typeof DOMException !== 'undefined' && e instanceof DOMException)) return false
  const err = e as { name?: string; code?: number }
  // ブラウザごとに名前が違うため複数を見る（Firefox は NS_ERROR_DOM_QUOTA_REACHED）
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22
}

export function createVersionedStore<T>(opts: VersionedStoreOptions<T>): VersionedStore<T> {
  const fullKey = STORAGE_PREFIX + opts.key
  const storage = (): KeyValueStorage | null => opts.storage ?? defaultStorage()

  return {
    fullKey,
    load() {
      const s = storage()
      if (!s) return null
      let raw: string | null
      try {
        raw = s.getItem(fullKey)
      } catch {
        return null
      }
      if (raw == null) return null
      let env: Envelope
      try {
        env = JSON.parse(raw) as Envelope
      } catch {
        return null
      }
      if (typeof env !== 'object' || env === null || typeof env.v !== 'number') return null
      if (env.v === opts.version) {
        return opts.validate(env.data) ? env.data : null
      }
      const migrated = opts.migrate?.(env.v, env.data) ?? null
      return migrated !== null && opts.validate(migrated) ? migrated : null
    },
    save(data) {
      const s = storage()
      if (!s) return { ok: false, reason: 'unavailable', error: null }
      try {
        s.setItem(fullKey, JSON.stringify({ v: opts.version, data } satisfies Envelope))
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: isQuotaError(error) ? 'quota' : 'unknown', error }
      }
    },
    clear() {
      try {
        storage()?.removeItem(fullKey)
      } catch {
        // 削除失敗は致命的ではない（次回 load で validate に弾かれるか、上書きされる）
      }
    },
    size() {
      try {
        return storage()?.getItem(fullKey)?.length ?? 0
      } catch {
        return 0
      }
    },
  }
}

/** テスト用のメモリ実装。容量上限を与えると QuotaExceededError を模擬できる */
export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>()
  private readonly maxChars: number
  constructor(maxChars = Infinity) {
    this.maxChars = maxChars
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    let total = value.length
    for (const [k, v] of this.map) if (k !== key) total += v.length
    if (total > this.maxChars) {
      const e = new Error('quota exceeded')
      e.name = 'QuotaExceededError'
      throw e
    }
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  keys(): string[] {
    return [...this.map.keys()]
  }
}
