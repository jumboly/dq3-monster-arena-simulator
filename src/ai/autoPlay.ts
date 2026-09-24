/**
 * AI 自動プレイの純粋なループ制御。
 *
 * なぜ UI から分けるか: 「上限回数」「停止」「連続失敗で止める」「レート制限で待つ」は
 * React の状態更新と絡めると検証しにくい。ゲーム進行（賭け判断 → 戦闘 → 精算）は
 * playRound コールバックで注入し、ここは制御だけを持つ。確認ダイアログ等は UI 側の責務。
 *
 * 失敗した試合は飛ばさず同じ試合番号でやり直す。飛ばすと「AI が判断できなかった試合」が
 * 成績から黙って消え、勝率の集計が偏るため。
 */
import { isAbortError, isAiGatewayError } from './errors'
import { defaultSleep } from './VercelGatewayClient'

/** 1 回の自動プレイで回せる最大試合数（呼び出し回数とコストの上限を固定するため） */
export const AUTO_PLAY_MAX_ROUNDS = 1000

export interface RoundContext {
  /** 0 始まりの試合番号（成功した試合の数と一致する） */
  round: number
  /** 同じ試合の何回目の挑戦か（1 始まり） */
  attempt: number
  signal?: AbortSignal
}

export interface RoundOutcome {
  /** 所持金不足などゲーム側の理由で打ち切るとき true */
  stop?: boolean
}

export type AutoPlayStopReason =
  | 'max_rounds'
  | 'aborted'
  | 'consecutive_failures'
  /** キー無効・入力不正など、待っても直らない失敗 */
  | 'fatal_error'
  /** playRound が stop を返した */
  | 'requested'

export type AutoPlayEvent =
  | { type: 'round_completed'; round: number }
  | { type: 'round_failed'; round: number; attempt: number; error: unknown; consecutiveFailures: number }
  | { type: 'waiting'; round: number; waitMs: number; reason: 'rate_limit' | 'backoff' }

export interface AutoPlayOptions {
  maxRounds: number
  playRound: (ctx: RoundContext) => Promise<RoundOutcome>
  signal?: AbortSignal
  /** この回数だけ連続で失敗したら止める。一時障害が長引くときに呼び出しを積み増さないため */
  maxConsecutiveFailures?: number
  /** Retry-After が異常に長くても UI が固まり続けないよう上限を設ける */
  maxRateLimitWaitMs?: number
  /** レート制限以外の失敗後、次の挑戦までの待ち */
  failureBackoffMs?: number
  onEvent?: (event: AutoPlayEvent) => void
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface AutoPlayResult {
  roundsCompleted: number
  stopReason: AutoPlayStopReason
}

/** Retry-After が無い 429 の待ち。Jev の実測 Retry-After が約 50 秒なので 60 秒 */
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000

export async function runAutoPlay(options: AutoPlayOptions): Promise<AutoPlayResult> {
  const maxRounds = Math.max(0, Math.min(AUTO_PLAY_MAX_ROUNDS, Math.floor(options.maxRounds)))
  const maxConsecutiveFailures = Math.max(1, options.maxConsecutiveFailures ?? 3)
  const maxRateLimitWaitMs = options.maxRateLimitWaitMs ?? 120_000
  const failureBackoffMs = options.failureBackoffMs ?? 2_000
  const sleep = options.sleep ?? defaultSleep
  const { signal, onEvent } = options

  let roundsCompleted = 0
  let consecutiveFailures = 0
  let attempt = 1

  const done = (stopReason: AutoPlayStopReason): AutoPlayResult => ({ roundsCompleted, stopReason })

  while (roundsCompleted < maxRounds) {
    if (signal?.aborted) return done('aborted')
    const round = roundsCompleted
    try {
      const outcome = await options.playRound({ round, attempt, signal })
      roundsCompleted++
      consecutiveFailures = 0
      attempt = 1
      onEvent?.({ type: 'round_completed', round })
      if (outcome.stop) return done('requested')
      continue
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) return done('aborted')
      consecutiveFailures++
      onEvent?.({ type: 'round_failed', round, attempt, error, consecutiveFailures })

      if (isAiGatewayError(error) && !error.retryable) return done('fatal_error')
      if (consecutiveFailures >= maxConsecutiveFailures) return done('consecutive_failures')

      const isRateLimit = isAiGatewayError(error) && error.kind === 'rate_limit'
      const waitMs = isRateLimit
        ? Math.min(maxRateLimitWaitMs, error.retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS)
        : failureBackoffMs
      onEvent?.({ type: 'waiting', round, waitMs, reason: isRateLimit ? 'rate_limit' : 'backoff' })
      try {
        await sleep(waitMs, signal)
      } catch (e) {
        if (isAbortError(e) || signal?.aborted) return done('aborted')
        throw e
      }
      attempt++
    }
  }
  return done('max_rounds')
}
