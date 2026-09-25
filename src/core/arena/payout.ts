/**
 * 賭け金と払い戻し（窓口 $C3EE64 と戦後処理）。
 *
 * 出典: dqbook dq3_matchmake（賭け金 = 主人公レベル × 10）、docs/research/arena-spec.md §3, §4。
 */
import type { BattleOutcome } from '../battle/types'
import { oddsTimesTen } from './odds'
import type { Odds } from './types'

/** 賭け金 = 主人公レベル × 10G（Likely: dqbook の文章による） */
export function stakeFor(heroLevel: number): number {
  return heroLevel * 10
}

export interface Settlement {
  won: boolean
  draw: boolean
  /** 払い戻し総額（賭け金を含む） */
  payout: number
  /** payout - stake */
  delta: number
}

/**
 * 引き分け(7)は、賭けた選手が生き残った引き分け（10 ターン経過）だけ返金し、生存 0 体の引き分けは没収。
 * 大辞典・gcgx・RP2nd がそろって「賭けたモンスターが生き残っている場合のみ返還」としている（Likely。
 * docs/research/fidelity-review.md #20）。
 *
 * 当たり(5)の払い戻し = 賭け金 × オッズ。賭け金は常に 10 の倍数、オッズは小数 1 桁なので
 * 整数演算で端数なく計算できる（stake / 10 × odds10）。賭け金込みの総額（RP2nd の期待値計算と整合, Likely）。
 */
export function settle(params: { stake: number; odds: Odds; outcome: BattleOutcome; betSlot: number }): Settlement {
  const { stake, odds, outcome, betSlot } = params
  if (outcome.kind === 'winner' && outcome.slot === betSlot) {
    const payout = (stake / 10) * oddsTimesTen(odds)
    return { won: true, draw: false, payout, delta: payout - stake }
  }
  if (outcome.kind === 'draw') {
    // turn-limit の引き分けは定義上「賭けた選手が生存」、all-inactive は生存 0 体なので賭けた選手も倒れている
    const payout = outcome.reason === 'turn-limit' ? stake : 0
    return { won: false, draw: true, payout, delta: payout - stake }
  }
  return { won: false, draw: false, payout: 0, delta: -stake }
}
