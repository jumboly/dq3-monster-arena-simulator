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

/**
 * 引き分け（終了タイプ 7）の扱い。実機で返金されるかは資料がない（Unknown, U-20）ので切り替え可能にする。
 */
export type DrawPolicy = 'refund' | 'forfeit'

export interface Settlement {
  won: boolean
  draw: boolean
  /** 払い戻し総額（賭け金を含む） */
  payout: number
  /** payout - stake */
  delta: number
}

/**
 * 当たり(5)の払い戻し = 賭け金 × オッズ。賭け金は常に 10 の倍数、オッズは小数 1 桁なので
 * 整数演算で端数なく計算できる（stake / 10 × odds10）。式そのものは未公開（Unknown, U-20）。
 */
export function settle(params: { stake: number; odds: Odds; outcome: BattleOutcome; betSlot: number; drawPolicy: DrawPolicy }): Settlement {
  const { stake, odds, outcome, betSlot, drawPolicy } = params
  if (outcome.kind === 'winner' && outcome.slot === betSlot) {
    const payout = (stake / 10) * oddsTimesTen(odds)
    return { won: true, draw: false, payout, delta: payout - stake }
  }
  if (outcome.kind === 'draw') {
    const payout = drawPolicy === 'refund' ? stake : 0
    return { won: false, draw: true, payout, delta: payout - stake }
  }
  return { won: false, draw: false, payout: 0, delta: -stake }
}
