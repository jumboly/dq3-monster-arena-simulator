import { describe, expect, it } from 'vitest'
import type { BetDecision, BettingAgent, MatchObservation } from '../../src/ai/BettingAgent'
import { createMockArenaGame } from '../../src/core/arena/mockArenaGame'
import { MemoryStorage } from '../../src/storage/localStorage'
import { createStores } from '../../src/storage/session'
import { MockBettingAgent } from '../../src/ui/agents/MockBettingAgent'
import { runAnalysis } from '../../src/ui/logic/analysisRunner'
import {
  battleFor,
  createSession,
  currentOffer,
  deriveSeed,
  nextMatch,
  playBet,
  resultLabel,
  toStatRecord,
} from '../../src/ui/logic/arenaFlow'
import { ArenaStore } from '../../src/ui/logic/arenaStore'
import { runAutoPlay } from '../../src/ui/logic/autoPlay'
import { buildExport } from '../../src/ui/logic/exportData'
import { groupByTurn } from '../../src/ui/logic/logView'

const game = createMockArenaGame()
const newSession = (over: Partial<Parameters<typeof createSession>[0]> = {}) =>
  createSession({ heroLevel: 30, initialGold: 10000, informationMode: 'classic', playerMode: 'human', seed: 123, ...over })

describe('mock ArenaGame', () => {
  it('同じ seed なら同じ試合・同じ戦闘', () => {
    const a = game.createOffer({ heroLevel: 30, round: 1, seed: 9 })
    const b = game.createOffer({ heroLevel: 30, round: 1, seed: 9 })
    expect(a).toEqual(b)
    const r1 = game.resolveBet({ offer: a, betSlot: 0, goldBefore: 1000, battleSeed: 77 })
    const r2 = game.resolveBet({ offer: a, betSlot: 0, goldBefore: 1000, battleSeed: 77 })
    expect(r1).toEqual(r2)
    expect(r1.goldAfter).toBe(1000 + r1.delta)
    expect(a.stake).toBe(300)
  })

  it('observe の Classic は能力値を含めない', () => {
    const offer = game.createOffer({ heroLevel: 30, round: 1, seed: 9 })
    expect(game.observe(offer, 'classic').contestants[0].stats).toBeUndefined()
    expect(game.observe(offer, 'analyst').contestants[0].stats).toBeDefined()
  })
})

describe('arenaFlow', () => {
  it('deriveSeed は用途・round ごとに異なり、決定的', () => {
    expect(deriveSeed(1, 1, 'offer')).toBe(deriveSeed(1, 1, 'offer'))
    expect(deriveSeed(1, 1, 'offer')).not.toBe(deriveSeed(1, 1, 'battle'))
    expect(deriveSeed(1, 1, 'offer')).not.toBe(deriveSeed(1, 2, 'offer'))
  })

  it('createSession は Lv を 1..99 に丸める', () => {
    expect(newSession({ heroLevel: 150 }).heroLevel).toBe(99)
    expect(newSession({ heroLevel: 0 }).heroLevel).toBe(1)
  })

  it('playBet → 結果表示 → nextMatch で round が進む', () => {
    const s = newSession()
    const { session, entry } = playBet(game, s, 0)
    expect(session.phase).toBe('result')
    expect(session.gold).toBe(entry.goldAfter)
    expect(entry.round).toBe(1)
    expect(['WIN', 'LOSE', 'DRAW']).toContain(resultLabel(entry))
    expect(() => playBet(game, session, 0)).toThrow()
    const n = nextMatch(session)
    expect(n).toMatchObject({ round: 2, phase: 'match' })
  })

  it('同じ session seed なら試合は再現される（リロードで引き直せない）', () => {
    const s = newSession()
    expect(currentOffer(game, s)).toEqual(currentOffer(game, { ...s }))
  })

  it('所持金不足では賭けられない', () => {
    expect(() => playBet(game, newSession({ initialGold: 299 }), 0)).toThrow('所持金')
  })

  it('ログを捨てた履歴は battleSeed から同じ結果を再生成できる', () => {
    const { entry } = playBet(game, newSession(), 1)
    const { battle, ...stripped } = entry
    const re = battleFor(game, stripped)
    expect(re.regenerated).toBe(true)
    expect(re.result.battle).toEqual(battle)
  })

  it('予測は観測 id の順序対応でスロットに戻して統計に渡す', () => {
    const s = newSession()
    const offer = currentOffer(game, s)
    const ids = offer.contestants.map((_, k) => `id${k}`)
    const probabilities = Object.fromEntries(ids.map((id, k) => [id, k === 0 ? 1 : 0]))
    const { entry } = playBet(game, s, offer.contestants[0].slot, {
      prediction: { agentId: 'x', agentLabel: 'x', decision: { bet: 'id0', probabilities, reason: '' }, observationIds: ids },
    })
    const r = toStatRecord(entry)
    expect(r.probabilities?.[offer.contestants[0].slot]).toBe(1)
  })

  it('groupByTurn はターンごとにまとめる', () => {
    const g = groupByTurn([
      { turn: 0, kind: 'battle-start', simple: 'a' },
      { turn: 1, kind: 'turn-start', simple: 'b' },
      { turn: 1, kind: 'damage', simple: 'c' },
    ])
    expect(g.map((x) => [x.turn, x.entries.length])).toEqual([
      [0, 1],
      [1, 2],
    ])
  })
})

describe('ArenaStore', () => {
  it('賭けるたびに session と history を永続化し、再読込で復元する', () => {
    const storage = new MemoryStorage()
    const store = new ArenaStore(game, createStores(storage))
    store.startSession({ heroLevel: 30, initialGold: 10000, informationMode: 'classic', playerMode: 'human', seed: 5 })
    store.bet(0)
    store.next()
    store.bet(1)
    const reloaded = new ArenaStore(game, createStores(storage))
    expect(reloaded.getState().session).toEqual(store.getState().session)
    expect(reloaded.getState().history.map((h) => h.round)).toEqual([1, 2])
  })
})

describe('export', () => {
  it('API キーを含めない（許可リスト方式）', () => {
    const storage = new MemoryStorage()
    storage.setItem('dq3arena.aiGatewayApiKey', 'vck_secret_key_value')
    const store = new ArenaStore(game, createStores(storage))
    store.startSession({ heroLevel: 30, initialGold: 10000, informationMode: 'classic', playerMode: 'human', seed: 5 })
    store.bet(0)
    const { session, history } = store.getState()
    // 設定オブジェクトに余計なフィールドが紛れ込んでも出力されないこと
    const settings = { ...store.getState().settings, apiKey: 'vck_secret_key_value' } as never
    const json = JSON.stringify(buildExport({ session, history, settings }))
    expect(json).not.toContain('vck_secret')
    expect(json).not.toContain('apiKey')
  })
})

describe('runAutoPlay', () => {
  const setup = (gold = 10000) => {
    const store = new ArenaStore(game, createStores(new MemoryStorage()))
    store.startSession({ heroLevel: 30, initialGold: gold, informationMode: 'analyst', playerMode: 'jev', seed: 11 })
    return store
  }
  const noSleep = async () => {}

  it('指定回数だけ賭けて予測を履歴に残す', async () => {
    const store = setup()
    const agent = new MockBettingAgent({ policy: 'max-ev', delayMs: 0 })
    const res = await runAutoPlay({ store, game, agent, count: 5, failureLimit: 3, signal: new AbortController().signal, sleep: noSleep })
    expect(res.reason).toBe('completed')
    const h = store.getState().history
    expect(h).toHaveLength(5)
    expect(h.every((e) => e.prediction && e.auto)).toBe(true)
    expect(h.map((e) => e.round)).toEqual([1, 2, 3, 4, 5])
  })

  it('所持金が尽きたら止まる', async () => {
    const store = setup(600)
    const agent: BettingAgent = {
      id: 'always-first',
      label: 'x',
      // 常に最初の選手へ賭ける（勝敗はモック次第だが、600G なら数試合で尽きうる）
      decide: async (o: MatchObservation): Promise<BetDecision> => ({
        bet: o.contestants[0].id,
        probabilities: { [o.contestants[0].id]: 1 },
        reason: '',
      }),
    }
    const res = await runAutoPlay({ store, game, agent, count: 1000, failureLimit: 3, signal: new AbortController().signal, sleep: noSleep })
    expect(['no-gold', 'completed']).toContain(res.reason)
    if (res.reason === 'no-gold') expect(store.getState().session!.gold).toBeLessThan(300)
  })

  it('連続失敗で自動停止し、round は進めない', async () => {
    const store = setup()
    const agent: BettingAgent = {
      id: 'fail',
      label: 'fail',
      decide: async () => {
        throw new Error('boom')
      },
    }
    const res = await runAutoPlay({ store, game, agent, count: 10, failureLimit: 3, signal: new AbortController().signal, sleep: noSleep })
    expect(res.reason).toBe('failures')
    expect(res.progress.failures).toBe(3)
    expect(res.progress.lastError).toBe('boom')
    expect(store.getState().history).toHaveLength(0)
    expect(store.getState().session!.round).toBe(1)
  })

  it('Stop で中断', async () => {
    const store = setup()
    const ac = new AbortController()
    const agent: BettingAgent = {
      id: 'stopper',
      label: 's',
      decide: async (o) => {
        ac.abort()
        return { bet: o.contestants[0].id, probabilities: {}, reason: '' }
      },
    }
    const res = await runAutoPlay({ store, game, agent, count: 10, failureLimit: 3, signal: ac.signal, sleep: noSleep })
    expect(res.reason).toBe('aborted')
    // 中断後に届いた予測では賭けない
    expect(store.getState().history).toHaveLength(0)
  })
})

describe('runAnalysis', () => {
  it('賭け先ごとに同数の試行を行い、所持金に触れない', async () => {
    const offer = game.createOffer({ heroLevel: 30, round: 0, seed: 3 })
    const { dist, aborted } = await runAnalysis({ game, offer, trialsPerBet: 50, seed: 1, schedule: (fn) => fn() })
    expect(aborted).toBe(false)
    for (const s of dist.slots) {
      const row = dist.rows[s]
      expect(row.trials).toBe(50)
      const total = Object.values(row.wins).reduce((a, b) => a + b, 0) + row.draws
      expect(total).toBe(50)
    }
  })

  it('同じ seed なら同じ表', async () => {
    const offer = game.createOffer({ heroLevel: 30, round: 0, seed: 3 })
    const a = await runAnalysis({ game, offer, trialsPerBet: 20, seed: 42, schedule: (fn) => fn() })
    const b = await runAnalysis({ game, offer, trialsPerBet: 20, seed: 42, schedule: (fn) => fn() })
    expect(a.dist).toEqual(b.dist)
  })
})

describe('contract v2 (listCards / createOfferForCard / drawPolicy)', () => {
  it('listCards に選べないカードが含まれ、createOfferForCard は指定カードを返す', () => {
    const cards = game.listCards()
    expect(cards.some((c) => !c.playable)).toBe(true)
    const playable = cards.filter((c) => c.playable)
    for (const c of playable) {
      const o = game.createOfferForCard({ cardIndex: c.index, heroLevel: 30, round: 0, seed: 1 })
      expect(o.cardIndex).toBe(c.index)
      expect(o.contestants.map((x) => x.name)).toEqual(c.names)
    }
  })

  it('resolveBet は endType と drawPolicy を返し、履歴にも残る', () => {
    const { entry, result } = playBet(game, newSession(), 0)
    expect([5, 6, 7]).toContain(result.endType)
    expect(result.endType === 5).toBe(result.won)
    expect(entry.endType).toBe(result.endType)
    expect(entry.drawPolicy).toBe('refund')
  })

  it('引き分けの払い戻しは drawPolicy に従う', () => {
    const refund = createMockArenaGame({ drawPolicy: 'refund' })
    const forfeit = createMockArenaGame({ drawPolicy: 'forfeit' })
    // 引き分けになる組み合わせを探す（モックは 10 ターン打ち切り）
    for (const card of refund.listCards().filter((c) => c.playable)) {
      const offer = refund.createOfferForCard({ cardIndex: card.index, heroLevel: 30, round: 0, seed: 0 })
      for (const c of offer.contestants) {
        for (let seed = 0; seed < 300; seed++) {
          const a = refund.resolveBet({ offer, betSlot: c.slot, goldBefore: 1000, battleSeed: seed })
          if (!a.draw) continue
          const b = forfeit.resolveBet({ offer, betSlot: c.slot, goldBefore: 1000, battleSeed: seed })
          expect(a.delta).toBe(0)
          expect(b.delta).toBe(-offer.stake)
          return
        }
      }
    }
    throw new Error('引き分けの seed が見つからない')
  })
})

describe('aggregateActions', () => {
  it('同名の行動を合算し、禁止行動は別扱い', async () => {
    const { aggregateActions } = await import('../../src/ui/logic/format')
    const r = aggregateActions([
      { name: 'こうげき', forbiddenInArena: false, weight: 0.25 },
      { name: 'にげる', forbiddenInArena: true, weight: 0.25 },
      { name: 'こうげき', forbiddenInArena: false, weight: 0.5 },
    ])
    expect(r).toEqual([
      { name: 'こうげき', forbiddenInArena: false, weight: 0.75, slots: 2 },
      { name: 'にげる', forbiddenInArena: true, weight: 0.25, slots: 1 },
    ])
  })
})
