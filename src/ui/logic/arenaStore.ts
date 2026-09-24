/**
 * アプリ状態（冒険の書・履歴・設定）の外部ストア。
 *
 * React の state ではなく外部ストアにする理由: Auto Play は非同期ループの途中で
 * 「最新の」所持金・round を読み、1 試合ずつ確定させる必要がある。useState の
 * クロージャでは古い値を掴みやすいので、同期的に読める getState() を持つストアにし、
 * React 側は useSyncExternalStore で購読する。
 *
 * session / history は「いま遊んでいる冒険の書」のもの。既存の画面はこれだけを見れば
 * 今まで通り動くようにし、冊の一覧は books として別に持つ。
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
import { createSession, newSessionId, nextMatch, playBet, type NewSessionParams, type PlayOutcome } from './arenaFlow'

export interface ArenaState {
  /** 全冒険の書。並びは作成順（表示順は UI 側で決める） */
  books: Session[]
  session: Session | null
  history: HistoryEntry[]
  settings: Settings
  /** 直近の保存失敗（容量超過など）。UI で警告するため */
  storageWarning: string | null
}

/** うつし方。restart は seed・Lv・初期所持金・モードを引き継いで第 1 試合から（同じ試合列で比べるため） */
export type CopyMode = 'as-is' | 'restart'

export class BookLockedError extends Error {
  constructor() {
    super('オートプレイ中は冒険の書を切り替え・うつす・けすことはできません。')
    this.name = 'BookLockedError'
  }
}

export class ArenaStore {
  private state: ArenaState
  private listeners = new Set<() => void>()
  /** Auto Play 中。runAutoPlay は getState().session に賭け続けるため、冊が変わると別の冊に記録されてしまう */
  private locked = false

  private readonly game: ArenaGame
  private readonly stores: Stores

  constructor(game: ArenaGame, stores: Stores) {
    this.game = game
    this.stores = stores
    const books = stores.sessions.load() ?? []
    const activeId = stores.activeSessionId.load()
    const session = books.find((b) => b.id === activeId) ?? null
    this.state = {
      books,
      session,
      history: session ? this.loadHistory(session.id) : [],
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
      ? `${what}の保存に失敗しました（ブラウザの保存容量が不足）。使わない冒険の書を消してください。`
      : `${what}を保存できませんでした（プライベートブラウズ等でストレージが使えない可能性）。`
  }

  private loadHistory(sessionId: string): HistoryEntry[] {
    // 別の冊の履歴が紛れていたら混ぜない（手編集や旧版の不具合で壊れていても表示を守るため）
    return (this.stores.historyOf(sessionId).load() ?? []).filter((h) => h.sessionId === sessionId)
  }

  private assertUnlocked() {
    if (this.locked) throw new BookLockedError()
  }

  /** Auto Play の開始・終了時に AutoPlayController から呼ぶ */
  setLocked(locked: boolean): void {
    this.locked = locked
  }

  isLocked(): boolean {
    return this.locked
  }

  private persistBooks(books: Session[]): string | null {
    return this.warn('冒険の書', this.stores.sessions.save(books))
  }

  /** いま遊んでいる冊の Session を差し替えて保存する。updatedAt は一覧の並びに使うので必ず更新する */
  private commitSession(session: Session, now = new Date()): { session: Session; books: Session[]; warning: string | null } {
    const updated = { ...session, updatedAt: now.toISOString() }
    const books = this.state.books.map((b) => (b.id === updated.id ? updated : b))
    return { session: updated, books, warning: this.persistBooks(books) }
  }

  /**
   * 遊んでいる冊を離れる前に、その履歴からバトルログを落として保存し直す。
   * ログを残すのは遊んでいる冊だけ、という容量方針のため（ログは seed から再生成できる）。
   */
  private compactActive(): string | null {
    const s = this.state.session
    if (!s || !this.state.history.some((h) => h.battle !== undefined)) return null
    return this.warn('履歴', saveHistory(this.stores.historyOf(s.id), this.state.history, 0).result)
  }

  private uniqueId(id: string): string {
    let out = id
    for (let i = 2; this.state.books.some((b) => b.id === out); i++) out = `${id}-${i}`
    return out
  }

  /** 「冒険の書 N」の N。消した番号を詰めずに、既存の最大 + 1 にする（名前が被らないように） */
  private defaultName(): string {
    const nums = this.state.books.map((b) => Number(/^冒険の書 (\d+)$/.exec(b.name)?.[1] ?? 0))
    return `冒険の書 ${Math.max(this.state.books.length, ...nums) + 1}`
  }

  private activate(session: Session, history: HistoryEntry[], books: Session[], warnings: Array<string | null>): void {
    const active = this.stores.activeSessionId.save(session.id)
    this.set({
      books,
      session,
      history,
      storageWarning: warnings.find((w) => w) ?? this.warn('冒険の書の選択', active),
    })
  }

  /** 新しい冒険の書を作って遊び始める。前の冊は消さない */
  createBook(p: NewSessionParams): Session {
    this.assertUnlocked()
    const w0 = this.compactActive()
    const created = createSession(p)
    const session: Session = { ...created, id: this.uniqueId(created.id), name: created.name || this.defaultName() }
    const { result } = saveHistory(this.stores.historyOf(session.id), [])
    const books = [...this.state.books, session]
    this.activate(session, [], books, [w0, this.persistBooks(books), this.warn('履歴', result)])
    return session
  }

  switchBook(id: string): void {
    this.assertUnlocked()
    if (this.state.session?.id === id) return
    const session = this.state.books.find((b) => b.id === id)
    if (!session) throw new Error('冒険の書が見つかりません')
    const w0 = this.compactActive()
    this.activate(session, this.loadHistory(id), this.state.books, [w0])
  }

  /**
   * 冒険の書をうつす。うつした冊には切り替えない（原作同様、一覧に増えるだけ）。
   * as-is は履歴ごと複製する。容量を倍にしないよう、複製側はログ無しの要約だけにする。
   */
  copyBook(id: string, mode: CopyMode, now = new Date()): Session {
    this.assertUnlocked()
    const src = this.state.books.find((b) => b.id === id)
    if (!src) throw new Error('冒険の書が見つかりません')
    const suffix = mode === 'restart' ? '（はじめから）' : 'のコピー'
    const base =
      mode === 'restart'
        ? createSession({
            heroLevel: src.heroLevel,
            initialGold: src.initialGold,
            informationMode: src.informationMode,
            playerMode: src.playerMode,
            // seed が同じなら第 N 試合の組み合わせと戦闘乱数も同じになる（deriveSeed）ので、賭け方だけを比べられる
            seed: src.seed,
            now,
          })
        : { ...src, createdAt: now.toISOString(), updatedAt: now.toISOString() }
    const session: Session = { ...base, id: this.uniqueId(newSessionId(src.seed, now)), name: `${src.name}${suffix}` }
    const srcHistory = src.id === this.state.session?.id ? this.state.history : this.loadHistory(src.id)
    const history = mode === 'restart' ? [] : srcHistory.map((h) => ({ ...h, sessionId: session.id }))
    const { result } = saveHistory(this.stores.historyOf(session.id), history, 0)
    if (!result.ok) {
      // 履歴を保存できない冊を一覧に出すと「開いたら空」になるので、作らなかったことにする
      this.stores.historyOf(session.id).clear()
      this.set({ storageWarning: this.warn('冒険の書のコピー', result) })
      throw new Error(this.warn('冒険の書のコピー', result) ?? '冒険の書をうつせませんでした')
    }
    const books = [...this.state.books, session]
    this.set({ books, storageWarning: this.persistBooks(books) })
    return session
  }

  renameBook(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const books = this.state.books.map((b) => (b.id === id ? { ...b, name: trimmed } : b))
    const session = this.state.session?.id === id ? { ...this.state.session, name: trimmed } : this.state.session
    this.set({ books, session, storageWarning: this.persistBooks(books) })
  }

  /** 冒険の書を消す。遊んでいる冊を消したら未選択に戻る（勝手に別の冊を開かない） */
  deleteBook(id: string): void {
    this.assertUnlocked()
    const books = this.state.books.filter((b) => b.id !== id)
    const w = this.persistBooks(books)
    // 一覧から外せなかったのに履歴だけ消すと「開くと空の冊」が残るので、一覧の保存に成功した時だけ消す
    if (!w) this.stores.historyOf(id).clear()
    if (this.state.session?.id === id) {
      this.stores.activeSessionId.clear()
      this.set({ books, session: null, history: [], storageWarning: w })
    } else {
      this.set({ books, storageWarning: w })
    }
  }

  /** 統計の比較用。遊んでいる冊はメモリ上の最新を返す */
  historyOf(id: string): HistoryEntry[] {
    return id === this.state.session?.id ? this.state.history : this.loadHistory(id)
  }

  /** 保存済みデータのおおよその文字数。localStorage はオリジンあたり概ね 5M 文字なので、その目安表示に使う */
  storageUsage(): number {
    return (
      this.stores.sessions.size() +
      this.stores.settings.size() +
      this.state.books.reduce((sum, b) => sum + this.stores.historyOf(b.id).size(), 0)
    )
  }

  bet(betSlot: number, opts: { prediction?: Prediction; auto?: boolean } = {}): PlayOutcome {
    const s = this.state.session
    if (!s) throw new Error('冒険の書が選ばれていません')
    const out = playBet(this.game, s, betSlot, opts)
    const history = [...this.state.history, out.entry]
    const { result, saved } = saveHistory(this.stores.historyOf(s.id), history)
    const c = this.commitSession(out.session)
    // 画面上も保存と同じ刈り込み後の履歴を持つ（メモリも際限なく増やさないため）
    this.set({ books: c.books, session: c.session, history: saved, storageWarning: c.warning ?? this.warn('履歴', result) })
    return { ...out, session: c.session }
  }

  next(): void {
    const s = this.state.session
    if (!s) return
    const c = this.commitSession(nextMatch(s))
    this.set({ books: c.books, session: c.session, storageWarning: c.warning })
  }

  updateSession(patch: Partial<Pick<Session, 'informationMode' | 'playerMode'>>): void {
    const s = this.state.session
    if (!s) return
    const c = this.commitSession({ ...s, ...patch })
    this.set({ books: c.books, session: c.session, storageWarning: c.warning })
  }

  updateSettings(patch: Partial<Settings>): void {
    const settings = { ...this.state.settings, ...patch }
    this.set({ settings, storageWarning: this.warn('設定', this.stores.settings.save(settings)) })
  }

  dismissWarning(): void {
    this.set({ storageWarning: null })
  }
}
