/**
 * BetDecision の整合性検査。
 *
 * なぜ Jev 実装の外にも置くか: BettingAgent は差し替え可能な契約なので、
 * 他実装の出力も UI に渡す前に同じ規則（bet が出場者 id、確率が有限値）で確かめられるようにする。
 */
import type { BetDecision, MatchObservation } from '../BettingAgent'
import { SchemaError, isFiniteNumber } from './validation'

export function assertBetDecision(decision: BetDecision, observation: MatchObservation): void {
  const ids = observation.contestants.map((c) => c.id)
  if (!ids.includes(decision.bet)) {
    throw new SchemaError('bet', `出場者に含まれない id「${decision.bet}」`)
  }
  for (const [id, p] of Object.entries(decision.probabilities)) {
    if (!ids.includes(id)) throw new SchemaError(`probabilities.${id}`, '出場者に含まれない id')
    if (!isFiniteNumber(p) || p < 0 || p > 1) throw new SchemaError(`probabilities.${id}`, '0〜1 の数値ではありません')
  }
  if (!(decision.bet in decision.probabilities)) {
    throw new SchemaError('probabilities', 'bet の id に確率がありません')
  }
}
