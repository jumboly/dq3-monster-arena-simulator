/**
 * スモーク: 試合 1〜37 × 各 betSlot × 複数 seed で例外が出ず、統計が極端でないこと。
 * 暫定挙動（Unknown）の組み合わせで無限ループや想定外の終了状態に陥らないことの確認が主目的。
 */
import { describe, expect, it } from 'vitest'
import { DQ3BattleEngine } from '../../src/core/battle/DQ3BattleEngine'
import { getGameData } from '../../src/core/data/gameData'
import { run } from './helpers'

const engine = new DQ3BattleEngine()
const SEEDS = 30

describe('スモーク（試合 1〜37）', () => {
  it('例外なく終わり、ターン数は 1..10、結末は契約どおり', () => {
    let total = 0
    let draws = 0
    let turns = 0
    const unimplemented = new Set<string>()
    for (const card of getGameData().matchCards.slice(0, 37)) {
      const ids = card.entries.map((e) => e.monsterId)
      for (let bet = 0; bet < ids.length; bet++) {
        for (let s = 0; s < SEEDS; s++) {
          const r = run(engine, ids, bet, s * 7919 + card.index * 131 + bet)
          total++
          turns += r.turns
          expect(r.turns).toBeGreaterThanOrEqual(1)
          expect(r.turns).toBeLessThanOrEqual(10)
          if (r.outcome.kind === 'draw') draws++
          if (r.outcome.kind === 'winner') {
            expect(r.outcome.endType).toBe(r.outcome.slot === bet ? 5 : 6)
          }
          if (r.outcome.kind === 'no-winner') {
            expect(r.outcome.survivors).not.toContain(bet)
            expect(r.outcome.survivors.length).toBeGreaterThanOrEqual(2)
          }
          for (const k of Object.keys(r.fidelityHits)) if (k.startsWith('unimplemented')) unimplemented.add(k)
        }
      }
    }
    // 試合 1〜37 に出る実効コマンドはすべて実装済み。未実装の分岐に入ったらここで気付けるようにする
    expect([...unimplemented]).toEqual([])
    const avgTurns = turns / total
    expect(avgTurns).toBeGreaterThan(2)
    expect(avgTurns).toBeLessThan(8)
    expect(draws / total).toBeLessThan(0.2)
  })
})
