/**
 * Monte Carlo 集計: P(Winner = i | Match, Bet = j) の表を作る（純関数・逐次追加型）。
 *
 * 分割実行（setTimeout / Worker）のどちらでも使えるよう、状態はただのオブジェクトにして
 * 「1 試合ずつ record する」形にしている。スケジューリングは呼び出し側の責務。
 */
import type { ArenaRoundResult } from '../arena/types'

export interface BetRow {
  betSlot: number
  trials: number
  /** winnerSlot → 回数 */
  wins: Record<number, number>
  draws: number
  /** 10 ターン経過で賭けた選手が倒れ、他が複数生存（終了タイプ 6・単独勝者なし）。引き分けとは払い戻しが違うので分ける */
  noWinners: number
  totalTurns: number
  /** 所持金増減の合計（期待値 = totalDelta / trials） */
  totalDelta: number
  totalStake: number
}

export interface WinDistribution {
  slots: number[]
  rows: Record<number, BetRow>
}

export function createWinDistribution(slots: number[]): WinDistribution {
  const rows: Record<number, BetRow> = {}
  for (const j of slots) {
    rows[j] = {
      betSlot: j,
      trials: 0,
      wins: Object.fromEntries(slots.map((i) => [i, 0])),
      draws: 0,
      noWinners: 0,
      totalTurns: 0,
      totalDelta: 0,
      totalStake: 0,
    }
  }
  return { slots, rows }
}

/** 破壊的に 1 件加える（数千〜数万件を回すので毎回コピーしない） */
export function recordRound(dist: WinDistribution, result: ArenaRoundResult): void {
  const row = dist.rows[result.betSlot]
  if (!row) throw new RangeError(`betSlot ${result.betSlot} not in distribution`)
  row.trials += 1
  row.totalTurns += result.battle.turns
  row.totalDelta += result.delta
  row.totalStake += result.offer.stake
  const o = result.battle.outcome
  if (o.kind === 'winner') row.wins[o.slot] = (row.wins[o.slot] ?? 0) + 1
  else if (o.kind === 'no-winner') row.noWinners += 1
  else row.draws += 1
}

export interface BetRowSummary {
  betSlot: number
  trials: number
  winProb: Record<number, number>
  drawProb: number
  noWinnerProb: number
  /** 賭けた選手が勝つ確率 */
  hitProb: number
  meanTurns: number
  /** 1 試合あたりの所持金増減の期待値（G） */
  meanDelta: number
  /** 期待回収率（払戻総額 / 賭け金総額） */
  returnRate: number
  /** 二項比率の標準誤差（hitProb の誤差の目安） */
  hitStdError: number
}

export function summarizeRow(row: BetRow, slots: number[]): BetRowSummary {
  const n = row.trials
  const winProb: Record<number, number> = {}
  for (const i of slots) winProb[i] = n > 0 ? (row.wins[i] ?? 0) / n : 0
  const hit = winProb[row.betSlot] ?? 0
  return {
    betSlot: row.betSlot,
    trials: n,
    winProb,
    drawProb: n > 0 ? row.draws / n : 0,
    noWinnerProb: n > 0 ? row.noWinners / n : 0,
    hitProb: hit,
    meanTurns: n > 0 ? row.totalTurns / n : 0,
    meanDelta: n > 0 ? row.totalDelta / n : 0,
    returnRate: row.totalStake > 0 ? (row.totalDelta + row.totalStake) / row.totalStake : 0,
    hitStdError: n > 0 ? Math.sqrt((hit * (1 - hit)) / n) : 0,
  }
}
