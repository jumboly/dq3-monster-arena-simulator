/**
 * セッション・履歴・設定の永続化モデル。
 *
 * 容量方針（localStorage は概ね 5MB / オリジン）:
 * - Battle Log を含む BattleResult 全体は直近 LOG_RETENTION 件だけ保持する。
 *   1 試合のログは数 KB〜十数 KB になりうるため、Auto Play 1000 回で全件保持すると溢れる。
 * - それより古い履歴はログを捨てて要約（勝敗・ターン数・fidelityHits）だけ残す。
 *   battleSeed と offer は残すので、ArenaGame.resolveBet に同じ引数を渡せばログを再生成できる
 *   （ただしエンジンの版が変わると再生成結果が変わりうる点は UI で注記する）。
 * - 履歴自体も HISTORY_LIMIT 件で打ち切る（要約だけでも無制限だと溢れるため）。
 * - それでも容量超過したら、ログ保持件数を減らしながら再保存を試みる（saveHistory）。
 *
 * API キーはここでは一切扱わない（src/storage/apiKey.ts の責務。エクスポートにも含めないため）。
 */
import type { BetDecision, InformationMode } from '../ai/BettingAgent'
import type { MatchOffer } from '../core/arena/types'
import type { BattleOutcome, BattleResult } from '../core/battle/types'
import { createVersionedStore, type KeyValueStorage, type SaveResult } from './localStorage'

export type PlayerMode = 'human' | 'jev'
export type JevPolicy = 'max-ev' | 'max-win'

export const LOG_RETENTION = 30
export const HISTORY_LIMIT = 5000

export interface Session {
  id: string
  createdAt: string
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
}

export const DEFAULT_SETTINGS: Settings = {
  jevPolicy: 'max-ev',
  autoPlayFailureLimit: 3,
  useMockAgent: false,
}

// --- validators -----------------------------------------------------------
// 外部（ユーザーの手編集・旧版）由来の値で画面が落ちないよう、使う前に最低限の形だけ確かめる。

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

export function isSession(x: unknown): x is Session {
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

export function createStores(storage?: KeyValueStorage) {
  return {
    session: createVersionedStore<Session>({ key: 'session', version: 1, validate: isSession, storage }),
    history: createVersionedStore<HistoryEntry[]>({ key: 'history', version: 1, validate: isHistory, storage }),
    settings: createVersionedStore<Settings>({
      key: 'settings',
      version: 1,
      validate: isSettings,
      storage,
    }),
  }
}

export type Stores = ReturnType<typeof createStores>

export function loadSettings(stores: Stores): Settings {
  // 項目追加時に古い保存値で欠けたフィールドを既定値で埋めるため spread する
  return { ...DEFAULT_SETTINGS, ...(stores.settings.load() ?? {}) }
}

/** 履歴を容量方針に沿って刈り込む（純関数） */
export function trimHistory(history: HistoryEntry[], logRetention = LOG_RETENTION, limit = HISTORY_LIMIT): HistoryEntry[] {
  const kept = history.length > limit ? history.slice(history.length - limit) : history
  const cutoff = kept.length - logRetention
  return kept.map((e, i) => {
    if (i >= cutoff || e.battle === undefined) return e
    const { battle: _dropped, ...rest } = e
    void _dropped
    return rest
  })
}

/**
 * 容量超過時はログ保持件数を半減させながら再試行する。
 * ログを失っても seed から再生成できるので、履歴そのものを失うよりは良いという判断。
 */
export function saveHistory(stores: Stores, history: HistoryEntry[]): { result: SaveResult; saved: HistoryEntry[] } {
  let retention = LOG_RETENTION
  let saved = trimHistory(history, retention)
  let result = stores.history.save(saved)
  while (!result.ok && result.reason === 'quota' && retention > 0) {
    retention = Math.floor(retention / 2)
    saved = trimHistory(history, retention)
    result = stores.history.save(saved)
  }
  return { result, saved }
}

export function summarize(battle: BattleResult): BattleSummary {
  return { outcome: battle.outcome, turns: battle.turns, fidelityHits: battle.fidelityHits }
}
