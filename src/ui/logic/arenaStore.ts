/**
 * アプリ状態（セッション・履歴・設定）の外部ストア。
 *
 * React の state ではなく外部ストアにする理由: Auto Play は非同期ループの途中で
 * 「最新の」所持金・round を読み、1 試合ずつ確定させる必要がある。useState の
 * クロージャでは古い値を掴みやすいので、同期的に読める getState() を持つストアにし、
 * React 側は useSyncExternalStore で購読する。
 */
import type { ArenaGame } from '../../core/arena/ArenaGame'
import {
  loadSettings,
  saveHistory,
  type HistoryEntry,
  type Prediction,
  type Session,
  type Settings,
  type Stores,
} from '../../storage/session'
import type { SaveResult } from '../../storage/localStorage'
import { createSession, nextMatch, playBet, type NewSessionParams, type PlayOutcome } from './arenaFlow'

export interface ArenaState {
  session: Session | null
  history: HistoryEntry[]
  settings: Settings
  /** 直近の保存失敗（容量超過など）。UI で警告するため */
  storageWarning: string | null
}

export class ArenaStore {
  private state: ArenaState
  private listeners = new Set<() => void>()

  private readonly game: ArenaGame
  private readonly stores: Stores

  constructor(game: ArenaGame, stores: Stores) {
    this.game = game
    this.stores = stores
    const session = stores.session.load()
    const history = stores.history.load() ?? []
    this.state = {
      session,
      // 別セッションの履歴が残っていたら混ぜない（セッション保存だけ失敗した場合など）
      history: session ? history.filter((h) => h.sessionId === session.id) : [],
      settings: loadSettings(stores),
      storageWarning: null,
    }
  }

  getState = (): ArenaState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<ArenaState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  private warn(what: string, r: SaveResult): string | null {
    if (r.ok) return null
    return r.reason === 'quota'
      ? `${what}の保存に失敗しました（ブラウザの保存容量が不足）。古い履歴の削除を検討してください。`
      : `${what}を保存できませんでした（プライベートブラウズ等でストレージが使えない可能性）。`
  }

  private persistSession(session: Session | null): string | null {
    if (!session) {
      this.stores.session.clear()
      return null
    }
    return this.warn('セッション', this.stores.session.save(session))
  }

  startSession(p: NewSessionParams): Session {
    const session = createSession(p)
    const w1 = this.persistSession(session)
    const { result } = saveHistory(this.stores, [])
    this.set({ session, history: [], storageWarning: w1 ?? this.warn('履歴', result) })
    return session
  }

  bet(betSlot: number, opts: { prediction?: Prediction; auto?: boolean } = {}): PlayOutcome {
    const s = this.state.session
    if (!s) throw new Error('セッションがありません')
    const out = playBet(this.game, s, betSlot, opts)
    const history = [...this.state.history, out.entry]
    const { result, saved } = saveHistory(this.stores, history)
    const w = this.persistSession(out.session) ?? this.warn('履歴', result)
    // 画面上も保存と同じ刈り込み後の履歴を持つ（メモリも際限なく増やさないため）
    this.set({ session: out.session, history: saved, storageWarning: w })
    return out
  }

  next(): void {
    const s = this.state.session
    if (!s) return
    const session = nextMatch(s)
    this.set({ session, storageWarning: this.persistSession(session) })
  }

  updateSession(patch: Partial<Pick<Session, 'informationMode' | 'playerMode'>>): void {
    const s = this.state.session
    if (!s) return
    const session = { ...s, ...patch }
    this.set({ session, storageWarning: this.persistSession(session) })
  }

  updateSettings(patch: Partial<Settings>): void {
    const settings = { ...this.state.settings, ...patch }
    this.set({ settings, storageWarning: this.warn('設定', this.stores.settings.save(settings)) })
  }

  /** セッションと履歴を消す（設定は残す） */
  clearSession(): void {
    this.stores.session.clear()
    this.stores.history.clear()
    this.set({ session: null, history: [], storageWarning: null })
  }

  dismissWarning(): void {
    this.set({ storageWarning: null })
  }
}
