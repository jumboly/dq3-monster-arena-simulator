/**
 * セッション（冒険の書）・履歴・設定の永続化モデル。
 *
 * 冒険の書は何冊でも持てる。キーの分け方:
 * - `sessions`: 全冊の Session（1 冊数百バイト）。一覧表示のために全履歴を読まずに済むよう分ける
 * - `activeSessionId`: いま遊んでいる冊
 * - `history.<id>`: 冊ごとの試合履歴
 *
 * 容量方針（localStorage は概ね 5MB / オリジン）:
 * - Battle Log を含む BattleResult 全体は、遊んでいる冊の直近 LOG_RETENTION 件だけ保持する。
 *   他の冊はログを捨てた要約だけにする（1 試合の要約は実測で約 0.8KB、ログ付きは約 15KB）。
 *   1 試合のログは数 KB〜十数 KB になりうるため、Auto Play 1000 回で全件保持すると溢れる。
 * - それより古い履歴はログを捨てて要約（勝敗・ターン数・fidelityHits）だけ残す。
 *   battleSeed と offer は残すので、ArenaGame.resolveBet に同じ引数を渡せばログを再生成できる
 *   （ただしエンジンの版が変わると再生成結果が変わりうる点は UI で注記する）。
 * - 履歴自体も冊ごとに HISTORY_LIMIT 件で打ち切る（要約だけでも無制限だと溢れるため）。
 * - それでも容量超過したら、ログ保持件数を減らしながら再保存を試みる（saveHistory）。
 *
 * API キーはここでは一切扱わない（src/storage/apiKey.ts の責務。エクスポートにも含めないため）。
 */
import type { BetDecision, InformationMode } from '../ai/BettingAgent'
import type { MatchOffer } from '../core/arena/types'
import type { ArenaEndType, BattleOutcome, BattleResult } from '../core/battle/types'
import type { DrawPolicy } from '../core/arena/payout'
import { createVersionedStore, type KeyValueStorage, type SaveResult, type VersionedStore } from './localStorage'

export type PlayerMode = 'human' | 'jev'
export type JevPolicy = 'max-ev' | 'max-win'

export const LOG_RETENTION = 30
export const HISTORY_LIMIT = 5000

export interface Session {
  id: string
  /** 冒険の書の名前（利用者が付け替えられる） */
  name: string
  createdAt: string
  /** 最後に遊んだ・変更した時刻。一覧で新しい順に見せるため */
  updatedAt: string
  heroLevel: number
  initialGold: number
  gold: number
  /** 現在（またはこれから）の試合番号。1 始まり */
  round: number
  informationMode: InformationMode
  playerMode: PlayerMode
  /** 試合・戦闘シードの導出元。リロードで試合を引き直せないようにするため session に固定する */
  seed: number
  /** result: 現在 round の結果表示中（history の末尾が該当試合） */
  phase: 'match' | 'result'
}

export interface Prediction {
  agentId: string
  agentLabel: string
  decision: BetDecision
  /**
   * 予測時の MatchObservation.contestants[].id を offer.contestants の順に並べたもの。
   * decision.probabilities は観測 id で引くため、後から統計でスロットに戻すのに必要
   */
  observationIds?: string[]
  /** 予測時の情報モード（Classic / Analyst で精度を比べたくなった時のため） */
  informationMode?: InformationMode
}

export interface BattleSummary {
  outcome: BattleOutcome
  turns: number
  fidelityHits: Record<string, number>
}

export interface HistoryEntry {
  sessionId: string
  round: number
  playedAt: string
  offer: MatchOffer
  betSlot: number
  won: boolean
  payout: number
  delta: number
  goldBefore: number
  goldAfter: number
  battleSeed: number
  /** ROM の終了タイプ 5 当たり / 6 ハズレ / 7 引き分け（旧データには無い） */
  endType?: ArenaEndType
  /** 引き分けの払い戻し前提。実機未解明（U-20）で設定により変わるため、当時の前提を残す */
  drawPolicy?: DrawPolicy
  summary: BattleSummary
  /** 直近 LOG_RETENTION 件だけ保持。古いものは undefined（resolveBet で再生成可能） */
  battle?: BattleResult
  /** Jev（または他エージェント）が賭けた試合のみ */
  prediction?: Prediction
  /** Auto Play 中の試合か（統計でヒューマン判断と分けたくなった時のため） */
  auto?: boolean
}

export interface Settings {
  jevPolicy: JevPolicy
  /** Auto Play の連続失敗許容回数。これに達したら自動停止する */
  autoPlayFailureLimit: number
  /** API キーがあってもモックエージェントを使う（API を消費せずに UI を試すため） */
  useMockAgent: boolean
  /** 引き分け時の払い戻し。実機の扱いが未解明（U-20）なので利用者が選べるようにする */
  drawPolicy: DrawPolicy
}

export const DEFAULT_SETTINGS: Settings = {
  jevPolicy: 'max-ev',
  autoPlayFailureLimit: 3,
  useMockAgent: false,
  drawPolicy: 'refund',
}

// --- validators -----------------------------------------------------------
// 外部（ユーザーの手編集・旧版）由来の値で画面が落ちないよう、使う前に最低限の形だけ確かめる。

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

/** 冒険の書導入前（name / updatedAt なし）の Session。旧キーからの移行でだけ使う */
export type LegacySession = Omit<Session, 'name' | 'updatedAt'>

export function isLegacySession(x: unknown): x is LegacySession {
  return (
    isObj(x) &&
    typeof x.id === 'string' &&
    typeof x.heroLevel === 'number' &&
    typeof x.initialGold === 'number' &&
    typeof x.gold === 'number' &&
    typeof x.round === 'number' &&
    typeof x.seed === 'number' &&
    (x.informationMode === 'classic' || x.informationMode === 'analyst') &&
    (x.playerMode === 'human' || x.playerMode === 'jev') &&
    (x.phase === 'match' || x.phase === 'result')
  )
}

export function isSession(x: unknown): x is Session {
  return isLegacySession(x) && typeof (x as Session).name === 'string' && typeof (x as Session).updatedAt === 'string'
}

function isSessionList(x: unknown): x is Session[] {
  return Array.isArray(x) && x.every(isSession)
}

function isHistoryEntry(x: unknown): x is HistoryEntry {
  return (
    isObj(x) &&
    typeof x.round === 'number' &&
    typeof x.betSlot === 'number' &&
    typeof x.delta === 'number' &&
    isObj(x.offer) &&
    Array.isArray((x.offer as Record<string, unknown>).contestants) &&
    isObj(x.summary)
  )
}

export function isHistory(x: unknown): x is HistoryEntry[] {
  return Array.isArray(x) && x.every(isHistoryEntry)
}

export function isSettings(x: unknown): x is Settings {
  return (
    isObj(x) &&
    (x.jevPolicy === 'max-ev' || x.jevPolicy === 'max-win') &&
    typeof x.autoPlayFailureLimit === 'number'
  )
}

// --- stores ---------------------------------------------------------------

export type HistoryStore = VersionedStore<HistoryEntry[]>

export function createStores(storage?: KeyValueStorage) {
  return {
    sessions: createVersionedStore<Session[]>({ key: 'sessions', version: 1, validate: isSessionList, storage }),
    activeSessionId: createVersionedStore<string>({
      key: 'activeSessionId',
      version: 1,
      validate: (x): x is string => typeof x === 'string',
      storage,
    }),
    /** 冊ごとの履歴。呼ぶたびに作るが中身は状態を持たない薄いラッパなので問題ない */
    historyOf: (sessionId: string): HistoryStore =>
      createVersionedStore<HistoryEntry[]>({ key: `history.${sessionId}`, version: 1, validate: isHistory, storage }),
    settings: createVersionedStore<Settings>({
      key: 'settings',
      version: 1,
      validate: isSettings,
      storage,
    }),
    /** 冒険の書導入前の単一セッション用キー。移行（migrateLegacyStorage）でだけ読む */
    legacy: {
      session: createVersionedStore<LegacySession>({ key: 'session', version: 1, validate: isLegacySession, storage }),
      history: createVersionedStore<HistoryEntry[]>({ key: 'history', version: 1, validate: isHistory, storage }),
    },
  }
}

export type Stores = ReturnType<typeof createStores>

export const LEGACY_BOOK_NAME = '冒険の書 1'

export type MigrationResult =
  | { status: 'none' }
  | { status: 'migrated'; session: Session }
  | { status: 'failed'; result: SaveResult }

/**
 * 旧キー（session / history）の単一セッションを「冒険の書 1」として新形式へ移す。
 *
 * 旧キーは新キーへの保存がすべて成功してから消す。途中で失敗しても旧データは残り、
 * 次回起動時に再試行される。履歴は数 MB になりうるので、旧キーを残したまま複製すると
 * それだけで容量超過する。そこで旧履歴はメモリに読んでから一旦消し、新キーへの保存に
 * 失敗したら同じ内容を書き戻す（元々収まっていた大きさなので書き戻しは成功する）。
 */
export function migrateLegacyStorage(stores: Stores): MigrationResult {
  const legacy = stores.legacy.session.load()
  // 新形式が既にあるなら、残った旧キーは移行済みの消し損ねとみなして触らない（上書き事故を防ぐ）
  if (!legacy || stores.sessions.load() !== null) return { status: 'none' }

  const legacyHistory = stores.legacy.history.load() ?? []
  const history = legacyHistory.filter((h) => h.sessionId === legacy.id)
  const session: Session = {
    ...legacy,
    name: LEGACY_BOOK_NAME,
    updatedAt: history[history.length - 1]?.playedAt ?? legacy.createdAt,
  }

  stores.legacy.history.clear()
  const { result: hr } = saveHistory(stores.historyOf(session.id), history)
  if (!hr.ok) {
    stores.legacy.history.save(legacyHistory)
    return { status: 'failed', result: hr }
  }
  const sr = stores.sessions.save([session])
  if (!sr.ok) {
    stores.historyOf(session.id).clear()
    stores.legacy.history.save(legacyHistory)
    return { status: 'failed', result: sr }
  }
  // activeSessionId の保存失敗は致命的ではない（一覧から選び直せる）ので結果を見ない
  stores.activeSessionId.save(session.id)
  stores.legacy.session.clear()
  return { status: 'migrated', session }
}

export function loadSettings(stores: Stores): Settings {
  // 項目追加時に古い保存値で欠けたフィールドを既定値で埋めるため spread する
  return { ...DEFAULT_SETTINGS, ...(stores.settings.load() ?? {}) }
}

/** 履歴を容量方針に沿って刈り込む（純関数） */
export function trimHistory(history: HistoryEntry[], logRetention = LOG_RETENTION, limit = HISTORY_LIMIT): HistoryEntry[] {
  const kept = history.length > limit ? history.slice(history.length - limit) : history
  const cutoff = kept.length - logRetention
  return kept.map((e, i) => {
    if (i >= cutoff) return e
    // 古い試合は Battle Log と Jev とのやり取り（1 件数 KB）を落とす。どちらも容量の大半を占め、
    // 勝敗・予測確率・seed は残るので統計とログ再生成には困らない
    let out: HistoryEntry = e
    if (out.battle !== undefined) {
      const { battle: _dropped, ...rest } = out
      void _dropped
      out = rest
    }
    if (out.prediction?.decision.exchange !== undefined) {
      const { exchange: _ex, ...decision } = out.prediction.decision
      void _ex
      out = { ...out, prediction: { ...out.prediction, decision } }
    }
    return out
  })
}

/**
 * 容量超過時はログ保持件数を半減させながら再試行する。
 * ログを失っても seed から再生成できるので、履歴そのものを失うよりは良いという判断。
 */
export function saveHistory(
  store: HistoryStore,
  history: HistoryEntry[],
  logRetention = LOG_RETENTION,
): { result: SaveResult; saved: HistoryEntry[] } {
  let retention = logRetention
  let saved = trimHistory(history, retention)
  let result = store.save(saved)
  while (!result.ok && result.reason === 'quota' && retention > 0) {
    retention = Math.floor(retention / 2)
    saved = trimHistory(history, retention)
    result = store.save(saved)
  }
  return { result, saved }
}

export function summarize(battle: BattleResult): BattleSummary {
  return { outcome: battle.outcome, turns: battle.turns, fidelityHits: battle.fidelityHits }
}
