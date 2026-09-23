import { describe, expect, it } from 'vitest'
import {
  brierScore,
  calibrationBins,
  computeSessionStats,
  meanSelfExpectedReturn,
  topPickAccuracy,
  type StatRecord,
} from '../../src/core/stats/sessionStats'
import { createWinDistribution, recordRound, summarizeRow } from '../../src/core/stats/winDistribution'
import type { ArenaRoundResult } from '../../src/core/arena/types'

const rec = (p: Partial<StatRecord>): StatRecord => ({
  won: false,
  draw: false,
  stake: 300,
  delta: -300,
  betSlot: 0,
  winnerSlot: 1,
  slots: [0, 1, 2],
  ...p,
})

describe('computeSessionStats', () => {
  it('試合 0 件では率が null（0% と区別）', () => {
    const s = computeSessionStats([], 10000, 10000)
    expect(s.matches).toBe(0)
    expect(s.winRate).toBeNull()
    expect(s.roi).toBeNull()
    expect(s.profit).toBe(0)
  })

  it('勝ち・負け・引き分けと ROI を集計する', () => {
    const records = [
      rec({ won: true, delta: 540, winnerSlot: 0 }),
      rec({ won: false, delta: -300 }),
      rec({ won: false, draw: true, delta: -300, winnerSlot: null }),
    ]
    const s = computeSessionStats(records, 10000, 9940)
    expect(s).toMatchObject({ matches: 3, wins: 1, losses: 1, draws: 1, profit: -60, totalStaked: 900 })
    expect(s.winRate).toBeCloseTo(1 / 3)
    expect(s.roi).toBeCloseTo(-60 / 900)
  })
})

describe('brierScore', () => {
  it('完全に当てた予測は 0、完全に外した予測は 2', () => {
    const hit = rec({ winnerSlot: 1, probabilities: { 0: 0, 1: 1, 2: 0 } })
    const miss = rec({ winnerSlot: 1, probabilities: { 0: 1, 1: 0, 2: 0 } })
    expect(brierScore([hit]).score).toBeCloseTo(0)
    expect(brierScore([miss]).score).toBeCloseTo(2)
    expect(brierScore([hit, miss])).toEqual({ score: 1, count: 2 })
  })

  it('予測の無い試合は数えず、合計が 1 でない予測は正規化する', () => {
    const r = rec({ winnerSlot: 0, probabilities: { 0: 2, 1: 1, 2: 1 } }) // → 0.5, 0.25, 0.25
    const s = brierScore([r, rec({})])
    expect(s.count).toBe(1)
    expect(s.score).toBeCloseTo(0.25 + 0.0625 + 0.0625)
  })

  it('引き分けは全選手 o=0 として減点', () => {
    const r = rec({ winnerSlot: null, draw: true, probabilities: { 0: 1 / 3, 1: 1 / 3, 2: 1 / 3 } })
    expect(brierScore([r]).score).toBeCloseTo(1 / 3)
  })

  it('予測が無ければ null', () => {
    expect(brierScore([rec({})])).toEqual({ score: null, count: 0 })
  })
})

describe('calibration / top pick / self EV', () => {
  const records = [
    rec({ winnerSlot: 1, betSlot: 1, odds: { 0: 5, 1: 2, 2: 4 }, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 } }),
    rec({ winnerSlot: 0, betSlot: 1, odds: { 0: 5, 1: 2, 2: 4 }, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 } }),
  ]
  it('区間ごとに件数と実際の勝率を出す（p=1.0 も最後の区間に入る）', () => {
    const bins = calibrationBins(records)
    expect(bins).toHaveLength(10)
    expect(bins[8]).toMatchObject({ count: 2, observedRate: 0.5 })
    expect(bins[1]).toMatchObject({ count: 4, observedRate: 0.25 })
    const edge = calibrationBins([rec({ winnerSlot: 0, probabilities: { 0: 1, 1: 0, 2: 0 } })])
    expect(edge[9].count).toBe(1)
  })
  it('本命的中率', () => {
    expect(topPickAccuracy(records)).toEqual({ rate: 0.5, count: 2 })
  })
  it('自己期待倍率 = 賭けた選手の p × odds の平均', () => {
    expect(meanSelfExpectedReturn(records)).toBeCloseTo(1.6)
  })
})

describe('winDistribution', () => {
  const round = (betSlot: number, winner: number | null, delta: number): ArenaRoundResult =>
    ({
      offer: { stake: 100 },
      betSlot,
      delta,
      battle: {
        turns: 4,
        outcome: winner === null ? { kind: 'draw', reason: 'turn-limit', turn: 4 } : { kind: 'winner', slot: winner, turn: 4 },
      },
    }) as unknown as ArenaRoundResult

  it('賭け先ごとに勝者分布・期待増減・回収率を出す', () => {
    const d = createWinDistribution([0, 1])
    recordRound(d, round(0, 0, 180))
    recordRound(d, round(0, 1, -100))
    recordRound(d, round(0, null, -100))
    recordRound(d, round(1, 1, 50))
    const r0 = summarizeRow(d.rows[0], d.slots)
    expect(r0.trials).toBe(3)
    expect(r0.winProb[0]).toBeCloseTo(1 / 3)
    expect(r0.drawProb).toBeCloseTo(1 / 3)
    expect(r0.hitProb).toBeCloseTo(1 / 3)
    expect(r0.meanDelta).toBeCloseTo(-20 / 3)
    expect(r0.returnRate).toBeCloseTo(280 / 300)
    expect(summarizeRow(d.rows[1], d.slots).hitProb).toBe(1)
  })

  it('範囲外の betSlot は例外', () => {
    const d = createWinDistribution([0, 1])
    expect(() => recordRound(d, round(3, 0, 0))).toThrow()
  })
})
