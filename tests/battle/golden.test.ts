/**
 * Golden Tests: 代表カードを seed 固定で走らせ、勝敗・ターン数・行動列をスナップショット化する。
 * 仕様変更（暫定挙動の差し替えを含む）で結果が変わったことを確実に検知するため。
 * 意図した変更なら `npx vitest run tests/battle -u` で更新し、差分をレビューすること。
 */
import { describe, expect, it } from 'vitest'
import { DQ3BattleEngine } from '../../src/core/battle/DQ3BattleEngine'
import { getMatchCard } from '../../src/core/data/gameData'
import { actionTrace, run } from './helpers'

const engine = new DQ3BattleEngine()

/** 試合番号（1 始まり）と見どころ */
const CARDS: Array<[number, string]> = [
  [1, 'スライム/おおがらす/いっかくうさぎ'],
  [5, 'アルミラージ ×4（同名表記・ラリホー・神）'],
  [20, 'はぐれメタル（守備 1023・ギラ）'],
  [24, 'ホイミスライム（ホイミ・MP 無限）'],
  [31, 'ばくだんいわ（メガンテ）'],
]
const SEEDS = [1, 2, 3]

describe('Golden', () => {
  for (const [no, label] of CARDS) {
    it(`試合${no} ${label}`, () => {
      const ids = getMatchCard(no - 1).entries.map((e) => e.monsterId)
      const out = SEEDS.map((seed) => {
        const r = run(engine, ids, 0, seed)
        return { seed, outcome: r.outcome, turns: r.turns, rngCalls: r.rngCalls, actions: actionTrace(r.log) }
      })
      expect(out).toMatchSnapshot()
    })
  }
})
