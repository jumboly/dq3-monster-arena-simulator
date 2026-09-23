/**
 * Jev（BettingAgent）による連続自動プレイ。React 非依存。
 *
 * ループ制御（上限・停止・連続失敗・レート制限待ち）は AI 担当の src/ai/autoPlay.ts を使い、
 * ここは「1 試合 = 観測 → 予測 → ArenaStore.bet」の組み立てと進捗の翻訳だけを持つ。
 *
 * 1 試合ごとに ArenaStore.bet を通すので、手動プレイと同じ規則で所持金・履歴が更新される。
 * 失敗した試合は「遊ばなかった」ことにして同じ試合で再試行する（round を進めない）。
 * こうすると失敗の有無で試合列が変わらず、同じ seed のセッションを後から比較できる。
 */
import type { ArenaGame } from '../../core/arena/ArenaGame'
import type { BettingAgent, BetDecision, InformationMode, MatchObservation } from '../../ai/BettingAgent'
import type { MatchOffer } from '../../core/arena/types'
import type { Prediction } from '../../storage/session'
import type { ArenaStore } from './arenaStore'
import { canAfford, currentOffer, slotForDecision } from './arenaFlow'
import { AUTO_PLAY_MAX_ROUNDS, runAutoPlay as runAiAutoPlay } from '../../ai/autoPlay'

export const AUTO_PLAY_CHOICES = [10, 100, 1000] as const
/** UI からどんな値が来ても API を叩きすぎないための絶対上限（AI 側ループの上限と揃える） */
export const AUTO_PLAY_HARD_LIMIT = AUTO_PLAY_MAX_ROUNDS

export type AutoPlayStopReason = 'completed' | 'aborted' | 'no-gold' | 'failures'

export interface AutoPlayProgress {
  played: number
  target: number
  failures: number
  consecutiveFailures: number
  lastError: string | null
  /** レート制限などで待機中なら残り ms の目安 */
  waitingMs: number | null
}

export interface AutoPlayOptions {
  store: ArenaStore
  game: ArenaGame
  agent: BettingAgent
  count: number
  failureLimit: number
  signal: AbortSignal
  onProgress?: (p: AutoPlayProgress) => void
  /** テストで実時間を待たないため差し替え可能にする（失敗後の待機に使われる） */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/** エラーを利用者向け文言にする。AI 担当の AiGatewayError は message 自体が分類済みの日本語 */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export function makePrediction(
  agent: BettingAgent,
  obs: MatchObservation,
  decision: BetDecision,
  mode: InformationMode,
): Prediction {
  return {
    agentId: agent.id,
    agentLabel: agent.label,
    decision,
    observationIds: obs.contestants.map((c) => c.id),
    informationMode: mode,
  }
}

/** エージェントに 1 試合分を尋ね、賭け先スロットまで解決する（単発の Ask Jev でも使う） */
export async function askAgent(
  game: ArenaGame,
  agent: BettingAgent,
  offer: MatchOffer,
  mode: InformationMode,
  signal?: AbortSignal,
): Promise<{ obs: MatchObservation; decision: BetDecision; slot: number; prediction: Prediction }> {
  const obs = game.observe(offer, mode)
  const decision = await agent.decide(obs, signal)
  const slot = slotForDecision(offer, obs, decision)
  if (slot === null) throw new Error(`エージェントの賭け先 "${decision.bet}" が出場選手に見つかりません`)
  return { obs, decision, slot, prediction: makePrediction(agent, obs, decision, mode) }
}

export async function runAutoPlay(o: AutoPlayOptions): Promise<{ reason: AutoPlayStopReason; progress: AutoPlayProgress }> {
  const target = Math.max(0, Math.min(AUTO_PLAY_HARD_LIMIT, Math.floor(o.count)))
  const p: AutoPlayProgress = {
    played: 0,
    target,
    failures: 0,
    consecutiveFailures: 0,
    lastError: null,
    waitingMs: null,
  }
  const emit = () => o.onProgress?.({ ...p })

  const prepare = () => {
    const s = o.store.getState().session
    if (!s) return null
    if (s.phase === 'result') o.store.next()
    return o.store.getState().session
  }
  const first = prepare()
  if (!first || !canAfford(o.game, first)) return { reason: first ? 'no-gold' : 'aborted', progress: p }

  const res = await runAiAutoPlay<number>({
    maxRounds: target,
    maxConsecutiveFailures: o.failureLimit,
    signal: o.signal,
    ...(o.sleep ? { sleep: o.sleep } : {}),
    playRound: async ({ signal }) => {
      const s = prepare()
      if (!s) throw abortErr()
      const offer = currentOffer(o.game, s)
      const { slot, prediction } = await askAgent(o.game, o.agent, offer, s.informationMode, signal)
      // 応答待ちの間に Stop されたら、届いた予測で賭けない（利用者の意図は「これ以上賭けない」）
      if (signal?.aborted) throw abortErr()
      const { session } = o.store.bet(slot, { prediction, auto: true })
      // 即時に解決するエージェントでも描画の機会を与えるため 1 tick 譲る
      await new Promise((r) => setTimeout(r, 0))
      return { value: slot, stop: !canAfford(o.game, session) }
    },
    onEvent: (ev) => {
      if (ev.type === 'round_completed') {
        p.played += 1
        p.consecutiveFailures = 0
        p.waitingMs = null
      } else if (ev.type === 'round_failed') {
        p.failures += 1
        p.consecutiveFailures = ev.consecutiveFailures
        p.lastError = describeError(ev.error)
      } else {
        p.waitingMs = ev.waitMs
      }
      emit()
    },
  })
  p.waitingMs = null
  const reason: AutoPlayStopReason =
    res.stopReason === 'max_rounds' || res.roundsCompleted >= target
      ? 'completed'
      : res.stopReason === 'aborted'
        ? 'aborted'
        : res.stopReason === 'requested'
          ? 'no-gold'
          : 'failures'
  return { reason, progress: { ...p } }
}

function abortErr(): Error {
  const e = new Error('中断されました')
  e.name = 'AbortError'
  return e
}
