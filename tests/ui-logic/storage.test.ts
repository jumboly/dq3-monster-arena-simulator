import { describe, expect, it } from 'vitest'
import { MemoryStorage, createVersionedStore, type KeyValueStorage } from '../../src/storage/localStorage'
import { HISTORY_LIMIT, createStores, loadSettings, saveHistory, trimHistory, type HistoryEntry } from '../../src/storage/session'

const isNum = (x: unknown): x is number => typeof x === 'number'

describe('createVersionedStore', () => {
  it('保存した値を読み戻せる', () => {
    const storage = new MemoryStorage()
    const store = createVersionedStore({ key: 'n', version: 1, validate: isNum, storage })
    expect(store.load()).toBeNull()
    expect(store.save(42)).toEqual({ ok: true })
    expect(store.load()).toBe(42)
    expect(storage.getItem('dq3arena.n')).toBe('{"v":1,"data":42}')
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('壊れた JSON・形の違う値・未知のバージョンは null（例外を投げない）', () => {
    const storage = new MemoryStorage()
    const store = createVersionedStore({ key: 'n', version: 2, validate: isNum, storage })
    storage.setItem('dq3arena.n', '{broken')
    expect(store.load()).toBeNull()
    storage.setItem('dq3arena.n', '{"v":2,"data":"str"}')
    expect(store.load()).toBeNull()
    storage.setItem('dq3arena.n', '{"v":1,"data":1}')
    expect(store.load()).toBeNull()
  })

  it('migrate で旧バージョンを移行できる', () => {
    const storage = new MemoryStorage()
    storage.setItem('dq3arena.n', '{"v":1,"data":"7"}')
    const store = createVersionedStore({
      key: 'n',
      version: 2,
      validate: isNum,
      storage,
      migrate: (v, d) => (v === 1 ? Number(d) : null),
    })
    expect(store.load()).toBe(7)
  })

  it('ストレージが例外を投げても落ちない', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    const store = createVersionedStore({ key: 'n', version: 1, validate: isNum, storage: throwing })
    expect(store.load()).toBeNull()
    expect(store.save(1)).toMatchObject({ ok: false, reason: 'unknown' })
    expect(() => store.clear()).not.toThrow()
  })

  it('容量超過は quota として返す', () => {
    const store = createVersionedStore({ key: 'n', version: 1, validate: isNum, storage: new MemoryStorage(5) })
    expect(store.save(123456789)).toMatchObject({ ok: false, reason: 'quota' })
  })
})

function entry(round: number, withLog = true): HistoryEntry {
  return {
    sessionId: 's',
    round,
    playedAt: '2026-01-01T00:00:00.000Z',
    offer: { round, cardIndex: 0, heroLevel: 30, stake: 300, contestants: [] },
    betSlot: 0,
    won: false,
    payout: 0,
    delta: -300,
    goldBefore: 10000,
    goldAfter: 9700,
    battleSeed: round,
    summary: { outcome: { kind: 'winner', slot: 1, turn: 3 }, turns: 3, fidelityHits: {} },
    ...(withLog
      ? {
          battle: {
            outcome: { kind: 'winner', slot: 1, turn: 3 },
            turns: 3,
            log: [{ turn: 1, kind: 'note', simple: 'x'.repeat(200) }],
            finalStates: [],
            fidelityHits: {},
          },
        }
      : {}),
  }
}

describe('history retention', () => {
  it('直近 N 件だけログを残し、古いものは要約だけにする', () => {
    const h = Array.from({ length: 10 }, (_, i) => entry(i + 1))
    const t = trimHistory(h, 3)
    expect(t).toHaveLength(10)
    expect(t.filter((e) => e.battle).map((e) => e.round)).toEqual([8, 9, 10])
    expect(t[0].summary.turns).toBe(3)
    expect(t[0].battleSeed).toBe(1)
  })

  it('HISTORY_LIMIT を超えた古い履歴は捨てる', () => {
    const h = Array.from({ length: 12 }, (_, i) => entry(i + 1, false))
    expect(trimHistory(h, 0, 10).map((e) => e.round)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(1000)
  })

  it('容量超過時はログ保持数を減らして保存を試みる', () => {
    const h = Array.from({ length: 40 }, (_, i) => entry(i + 1))
    // ログ無しなら収まるが、ログ 30 件付きでは溢れる容量にする
    const bare = JSON.stringify({ v: 1, data: trimHistory(h, 0) }).length
    const storage = new MemoryStorage(bare + 3000)
    const stores = createStores(storage)
    const { result, saved } = saveHistory(stores, h)
    expect(result.ok).toBe(true)
    expect(saved.filter((e) => e.battle).length).toBeLessThan(30)
    expect(stores.history.load()).toHaveLength(40)
  })

  it('設定は欠けた項目を既定値で埋める', () => {
    const storage = new MemoryStorage()
    storage.setItem('dq3arena.settings', JSON.stringify({ v: 1, data: { jevPolicy: 'max-win', autoPlayFailureLimit: 5 } }))
    expect(loadSettings(createStores(storage))).toEqual({ jevPolicy: 'max-win', autoPlayFailureLimit: 5, useMockAgent: false })
  })
})
