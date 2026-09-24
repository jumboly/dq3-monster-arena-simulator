import { describe, expect, it } from 'vitest'
import { createDQ3ArenaGame } from '../../src/core/arena/DQ3ArenaGame'
import { cardLimitForLevel, pickCard, SHADOW_MATCH_INDEX } from '../../src/core/arena/matchmaking'
import { contestantId } from '../../src/core/arena/observation'
import { oddsSpread, oddsTimesTen, rollOdds } from '../../src/core/arena/odds'
import { settle, stakeFor } from '../../src/core/arena/payout'
import type { BattleEngine, BattleOutcome, BattleResult } from '../../src/core/battle/types'
import type { RandomSource } from '../../src/core/rng/RandomSource'
import { SeededRandom } from '../../src/core/rng/RandomSource'

/** 指定した値を順に返す RNG（境界値を狙って検証するため） */
function fixed(values: number[]): RandomSource {
  let i = 0
  return {
    nextInt(max) {
      const v = values[i++ % values.length]
      if (v >= max) throw new Error(`fixed rng: ${v} >= ${max}`)
      return v
    },
  }
}

function stubEngine(outcome: BattleOutcome): BattleEngine {
  return {
    runArena: (): BattleResult => ({ outcome, turns: outcome.turn, log: [], finalStates: [], fidelityHits: {} }),
  }
}

describe('wager', () => {
  it('賭け金は主人公レベル × 10G', () => {
    expect(stakeFor(1)).toBe(10)
    expect(stakeFor(30)).toBe(300)
    expect(stakeFor(99)).toBe(990)
  })
})

describe('odds', () => {
  it('帯ごとの振れ幅は dqbook の表どおり', () => {
    expect([1, 5, 6, 10, 11, 30, 31, 100, 101, 255].map(oddsSpread)).toEqual([3, 3, 7, 7, 20, 20, 50, 50, 100, 100])
  })

  it('v >= 0 のとき 整数部 = B + Q, 小数部 = R', () => {
    // B=20 の帯は randint(0,40)-20。37 を引くと v=17 → 20 + 1 . 7
    const r = rollOdds(20, fixed([37]))
    expect(r.intermediate).toBe(17)
    expect(r.odds).toEqual({ integer: 21, tenths: 7 })
    expect(r.usedProvisionalBoundary).toBe(false)
  })

  it('v < 0 は 10B + v。丸めていないので下限処理としては記録しない（U-18）', () => {
    const r = rollOdds(4, fixed([0])) // v = -3
    expect(r.odds).toEqual({ integer: 3, tenths: 7 })
    expect(r.usedProvisionalBoundary).toBe(false)
  })

  it('下限は 1.0 に丸める', () => {
    const r = rollOdds(1, fixed([0])) // 10 - 3 = 7 → 10
    expect(oddsTimesTen(r.odds)).toBe(10)
    expect(r.usedProvisionalBoundary).toBe(true)
  })

  it('全カード・全選手で抽選値は想定範囲に収まる', () => {
    const rng = new SeededRandom(1)
    for (const base of [1, 3, 7, 10, 19, 30, 49, 83, 100, 200, 223, 240, 255]) {
      for (let i = 0; i < 200; i++) {
        const t = oddsTimesTen(rollOdds(base, rng).odds)
        const k = oddsSpread(base)
        expect(t).toBeGreaterThanOrEqual(Math.max(10, 10 * base - k))
        expect(t).toBeLessThanOrEqual(10 * base + k)
      }
    }
  })
})

describe('matchmaking', () => {
  it('レベル帯の候補数（半開区間の解釈）', () => {
    expect([1, 10, 11, 15, 16, 21, 22, 29, 30, 99].map(cardLimitForLevel)).toEqual([10, 10, 19, 19, 24, 24, 33, 33, 38, 38])
  })

  it('Lv30 以上で試合 38 を除外する設定では 0..36 から選ぶ', () => {
    const rng = new SeededRandom(7)
    let max = 0
    for (let i = 0; i < 2000; i++) {
      const p = pickCard(30, rng, false)
      expect(p.excludedShadowMatch).toBe(true)
      max = Math.max(max, p.cardIndex)
    }
    expect(max).toBe(SHADOW_MATCH_INDEX - 1)
  })

  it('Lv29 以下は試合 38 に届かないので除外扱いにならない', () => {
    expect(pickCard(29, new SeededRandom(1), false).excludedShadowMatch).toBe(false)
  })
})

describe('payout', () => {
  const odds = { integer: 2, tenths: 8 }
  it('当たりは 賭け金 × オッズ を整数で', () => {
    const s = settle({ stake: 300, odds, outcome: { kind: 'winner', slot: 1, turn: 3, endType: 5 }, betSlot: 1, drawPolicy: 'refund' })
    expect(s).toEqual({ won: true, draw: false, payout: 840, delta: 540 })
  })
  it('他の選手が勝てば没収', () => {
    const s = settle({ stake: 300, odds, outcome: { kind: 'winner', slot: 0, turn: 3, endType: 6 }, betSlot: 1, drawPolicy: 'refund' })
    expect(s.delta).toBe(-300)
  })
  it('10 ターン経過で単独勝者なし（タイプ 6）は没収', () => {
    const s = settle({ stake: 300, odds, outcome: { kind: 'no-winner', reason: 'turn-limit', turn: 10, endType: 6, survivors: [0, 2] }, betSlot: 1, drawPolicy: 'refund' })
    expect(s).toEqual({ won: false, draw: false, payout: 0, delta: -300 })
  })
  it('引き分けは方針に従う', () => {
    const draw: BattleOutcome = { kind: 'draw', reason: 'turn-limit', turn: 10, endType: 7 }
    expect(settle({ stake: 300, odds, outcome: draw, betSlot: 1, drawPolicy: 'refund' }).delta).toBe(0)
    expect(settle({ stake: 300, odds, outcome: draw, betSlot: 1, drawPolicy: 'forfeit' }).delta).toBe(-300)
  })
  it('生存 0 体の引き分けは賭けた選手も倒れているので、返金方針でも没収', () => {
    const draw: BattleOutcome = { kind: 'draw', reason: 'all-inactive', turn: 4, endType: 7 }
    const s = settle({ stake: 300, odds, outcome: draw, betSlot: 1, drawPolicy: 'refund' })
    expect(s).toEqual({ won: false, draw: true, payout: 0, delta: -300 })
  })
})

describe('DQ3ArenaGame', () => {
  const game = createDQ3ArenaGame({ engine: stubEngine({ kind: 'winner', slot: 0, turn: 2, endType: 5 }) })

  it('38 カードを列挙し、試合 38 は Phase B として遊べない扱い', () => {
    const cards = game.listCards()
    expect(cards).toHaveLength(38)
    expect(cards.filter((c) => !c.playable).map((c) => c.index)).toEqual([SHADOW_MATCH_INDEX])
  })

  it('同じ seed なら同じ試合・同じオッズ', () => {
    const a = game.createOffer({ heroLevel: 30, round: 1, seed: 42 })
    const b = game.createOffer({ heroLevel: 30, round: 1, seed: 42 })
    expect(a).toEqual(b)
    expect(a.stake).toBe(300)
  })

  it('観測には Hidden Runtime State を含めない', () => {
    const offer = game.createOfferForCard({ cardIndex: 4, heroLevel: 30, round: 1, seed: 3 })
    for (const mode of ['classic', 'analyst'] as const) {
      const text = JSON.stringify(game.observe(offer, mode))
      expect(text).not.toMatch(/seed|rng|battleSeed|initialHp|transform/i)
    }
    const classic = game.observe(offer, 'classic')
    expect(classic.contestants.every((c) => c.stats === undefined && c.actions === undefined)).toBe(true)
  })

  it('同名モンスターでも観測 id は出場順で区別される', () => {
    const offer = game.createOfferForCard({ cardIndex: 4, heroLevel: 30, round: 1, seed: 3 }) // アルミラージ ×4
    const ids = game.observe(offer, 'classic').contestants.map((c) => c.id)
    expect(ids).toEqual([0, 1, 2, 3].map(contestantId))
    expect(new Set(offer.contestants.map((c) => c.name)).size).toBe(1)
  })

  it('Analyst では禁止行動に印が付く（にげる）', () => {
    const offer = game.createOfferForCard({ cardIndex: 0, heroLevel: 30, round: 1, seed: 1 }) // スライムは（にげる）を持つ
    const slime = game.observe(offer, 'analyst').contestants[0]
    expect(slime.actions?.some((a) => a.forbiddenInArena)).toBe(true)
  })

  it('resolveBet は配当と終了タイプを返す', () => {
    const offer = game.createOfferForCard({ cardIndex: 0, heroLevel: 30, round: 1, seed: 1 })
    const r = game.resolveBet({ offer, betSlot: 0, goldBefore: 1000, battleSeed: 9 })
    expect(r.won).toBe(true)
    expect(r.endType).toBe(5)
    expect(r.goldAfter).toBe(1000 + r.delta)
    expect(r.payout).toBe(30 * oddsTimesTen(offer.contestants[0].odds))
  })
})
