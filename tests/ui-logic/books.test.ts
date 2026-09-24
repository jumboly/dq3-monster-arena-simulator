import { describe, expect, it } from 'vitest'
import { createMockArenaGame } from '../../src/core/arena/mockArenaGame'
import { MemoryStorage } from '../../src/storage/localStorage'
import { LEGACY_BOOK_NAME, createStores, migrateLegacyStorage, trimHistory, type HistoryEntry } from '../../src/storage/session'
import { createSession, playBet } from '../../src/ui/logic/arenaFlow'
import { ArenaStore, BookLockedError } from '../../src/ui/logic/arenaStore'
import { compareBook, matchesPlayed, sortBooks } from '../../src/ui/logic/books'

const game = createMockArenaGame()
const params = { heroLevel: 30, initialGold: 10000, informationMode: 'classic', playerMode: 'human' } as const

/** 冒険の書導入前の形式（session / history キー）で 1 セッション分を書き込む */
function writeLegacy(storage: MemoryStorage, rounds = 3) {
  const { name: _n, updatedAt: _u, ...legacy } = createSession({ ...params, seed: 7 })
  void _n
  void _u
  let s = { ...legacy, name: '', updatedAt: '' }
  const history: HistoryEntry[] = []
  for (let i = 0; i < rounds; i++) {
    const out = playBet(game, s, 0)
    history.push(out.entry)
    s = { ...out.session, round: out.session.round + 1, phase: 'match' }
  }
  const { name: _n2, updatedAt: _u2, ...legacyFinal } = s
  void _n2
  void _u2
  storage.setItem('dq3arena.session', JSON.stringify({ v: 1, data: legacyFinal }))
  storage.setItem('dq3arena.history', JSON.stringify({ v: 1, data: history }))
  return { legacy: legacyFinal, history }
}

describe('旧形式からの移行', () => {
  it('単一セッションを「冒険の書 1」として移し、旧キーを消す', () => {
    const storage = new MemoryStorage()
    const { legacy } = writeLegacy(storage)
    const store = new ArenaStore(game, createStores(storage))
    const st = store.getState()
    expect(st.books).toHaveLength(1)
    expect(st.session).toMatchObject({ id: legacy.id, name: LEGACY_BOOK_NAME, gold: legacy.gold })
    expect(st.history.map((h) => h.round)).toEqual([1, 2, 3])
    expect(storage.getItem('dq3arena.session')).toBeNull()
    expect(storage.getItem('dq3arena.history')).toBeNull()
    expect(st.storageWarning).toBeNull()
  })

  it('新キーへの保存に失敗したら旧データを残す', () => {
    const storage = new MemoryStorage()
    writeLegacy(storage)
    const before = storage.getItem('dq3arena.history')
    // 旧データはちょうど収まるが、sessions 一覧を足す余地が無い容量にする
    const used = storage.keys().reduce((n, k) => n + (storage.getItem(k)?.length ?? 0), 0)
    const tight = new MemoryStorage(used + 50)
    for (const k of storage.keys()) tight.setItem(k, storage.getItem(k)!)
    const res = migrateLegacyStorage(createStores(tight))
    expect(res.status).toBe('failed')
    expect(tight.getItem('dq3arena.history')).toBe(before)
    expect(tight.getItem('dq3arena.session')).not.toBeNull()
    expect(tight.getItem('dq3arena.sessions')).toBeNull()
  })

  it('壊れた旧データは移行せず、起動もできる', () => {
    const storage = new MemoryStorage()
    storage.setItem('dq3arena.session', '{broken')
    const store = new ArenaStore(game, createStores(storage))
    expect(store.getState().books).toEqual([])
    expect(store.getState().session).toBeNull()
  })

  it('新形式が既にあれば旧キーには触らない', () => {
    const storage = new MemoryStorage()
    new ArenaStore(game, createStores(storage)).createBook(params)
    writeLegacy(storage)
    expect(migrateLegacyStorage(createStores(storage)).status).toBe('none')
  })
})

describe('冒険の書の操作', () => {
  const setup = () => {
    const storage = new MemoryStorage()
    return { storage, store: new ArenaStore(game, createStores(storage)) }
  }

  it('作るたびに前の冊を残し、名前を連番で補う', () => {
    const { storage, store } = setup()
    const a = store.createBook(params)
    store.bet(0)
    const b = store.createBook({ ...params, name: '  比較用  ' })
    const c = store.createBook(params)
    expect(store.getState().books.map((x) => x.name)).toEqual(['冒険の書 1', '比較用', '冒険の書 3'])
    expect(store.getState().session?.id).toBe(c.id)
    // 再読込で一覧と選択中の冊が戻る
    const reloaded = new ArenaStore(game, createStores(storage))
    expect(reloaded.getState().books.map((x) => x.id)).toEqual([a.id, b.id, c.id])
    expect(reloaded.getState().session?.id).toBe(c.id)
    expect(reloaded.historyOf(a.id)).toHaveLength(1)
  })

  it('切り替えると履歴も入れ替わり、離れた冊のバトルログは落とす', () => {
    const { store } = setup()
    const a = store.createBook(params)
    store.bet(0)
    expect(store.getState().history[0].battle).toBeDefined()
    const b = store.createBook(params)
    expect(store.getState().history).toEqual([])
    store.switchBook(a.id)
    expect(store.getState().session?.id).toBe(a.id)
    expect(store.getState().history).toHaveLength(1)
    // ログは seed から再生成できるので、遊んでいない冊には要約だけを残す
    expect(store.getState().history[0].battle).toBeUndefined()
    expect(store.getState().history[0].battleSeed).toBeTypeOf('number')
    store.switchBook(b.id)
    expect(store.getState().session?.id).toBe(b.id)
  })

  it('そのまま うつすと履歴ごと複製し、切り替えはしない', () => {
    const { store } = setup()
    const a = store.createBook(params)
    store.bet(0)
    store.next()
    store.bet(1)
    const copy = store.copyBook(a.id, 'as-is')
    expect(store.getState().session?.id).toBe(a.id)
    expect(copy).toMatchObject({ name: '冒険の書 1のコピー', gold: store.getState().session?.gold, round: 2 })
    expect(copy.id).not.toBe(a.id)
    const h = store.historyOf(copy.id)
    expect(h.map((e) => e.round)).toEqual([1, 2])
    expect(h.every((e) => e.sessionId === copy.id && e.battle === undefined)).toBe(true)
  })

  it('はじめから うつすと同じ seed の第 1 試合から始まり、同じ賭け方なら同じ結果になる', () => {
    const { store } = setup()
    const a = store.createBook({ ...params, initialGold: 5000 })
    store.bet(0)
    const first = store.getState().history[0]
    const copy = store.copyBook(a.id, 'restart')
    expect(copy).toMatchObject({ seed: a.seed, round: 1, gold: 5000, initialGold: 5000, phase: 'match' })
    expect(store.historyOf(copy.id)).toEqual([])
    store.switchBook(copy.id)
    const again = store.bet(0).entry
    expect(again.offer).toEqual(first.offer)
    expect(again.won).toBe(first.won)
    expect(again.battleSeed).toBe(first.battleSeed)
  })

  it('名前を変えると一覧と選択中の冊の両方に反映し、空の名前は無視する', () => {
    const { store } = setup()
    const a = store.createBook(params)
    store.renameBook(a.id, 'Jev 検証')
    store.renameBook(a.id, '   ')
    expect(store.getState().session?.name).toBe('Jev 検証')
    expect(store.getState().books[0].name).toBe('Jev 検証')
  })

  it('遊んでいる冊を消すと未選択に戻り、履歴キーも消える', () => {
    const { storage, store } = setup()
    const a = store.createBook(params)
    store.bet(0)
    const b = store.createBook(params)
    store.deleteBook(b.id)
    expect(store.getState().session).toBeNull()
    expect(store.getState().books.map((x) => x.id)).toEqual([a.id])
    expect(storage.getItem(`dq3arena.history.${b.id}`)).toBeNull()
    store.deleteBook(a.id)
    expect(storage.keys().filter((k) => k.startsWith('dq3arena.history'))).toEqual([])
    expect(new ArenaStore(game, createStores(storage)).getState().session).toBeNull()
  })

  it('オートプレイ中は切り替え・作成・うつす・けすを拒否し、賭けは通す', () => {
    const { store } = setup()
    const a = store.createBook(params)
    const b = store.createBook(params)
    store.setLocked(true)
    expect(() => store.switchBook(a.id)).toThrow(BookLockedError)
    expect(() => store.createBook(params)).toThrow(BookLockedError)
    expect(() => store.copyBook(a.id, 'as-is')).toThrow(BookLockedError)
    expect(() => store.deleteBook(a.id)).toThrow(BookLockedError)
    expect(() => store.bet(0)).not.toThrow()
    expect(store.getState().session?.id).toBe(b.id)
    store.setLocked(false)
    expect(() => store.switchBook(a.id)).not.toThrow()
  })

  it('賭けると updatedAt が進む（一覧の並びに使う）', () => {
    const { store } = setup()
    const a = store.createBook({ ...params, now: new Date('2026-01-01T00:00:00Z') })
    store.bet(0)
    expect(store.getState().books[0].updatedAt > a.updatedAt).toBe(true)
  })

  it('保存容量の目安は冊が増えると増える', () => {
    const { store } = setup()
    store.createBook(params)
    store.bet(0)
    const one = store.storageUsage()
    store.createBook(params)
    store.bet(0)
    expect(store.storageUsage()).toBeGreaterThan(one)
  })
})

describe('trimHistory との整合', () => {
  it('ログ保持 0 でも勝敗と seed は残る', () => {
    const s = createSession({ ...params, seed: 1 })
    const e = playBet(game, s, 0).entry
    const [t] = trimHistory([e], 0)
    expect(t.battle).toBeUndefined()
    expect(t.won).toBe(e.won)
    expect(t.battleSeed).toBe(e.battleSeed)
  })
})

describe('冒険の書どうしの比較', () => {
  it('単冊の統計と同じ集計を行い、予測なしなら Brier は null', () => {
    const store = new ArenaStore(game, createStores(new MemoryStorage()))
    const s = store.createBook(params)
    store.bet(0)
    store.next()
    store.bet(1)
    const { session, history } = store.getState()
    const row = compareBook(session!, history)
    expect(row.session.id).toBe(s.id)
    expect(row.stats.matches).toBe(2)
    expect(row.stats.profit).toBe(session!.gold - session!.initialGold)
    expect(row.predicted).toBe(0)
    expect(row.brier).toBeNull()
  })

  it('一覧は最後に遊んだ冊を上に並べる', () => {
    const a = { ...createSession({ ...params, seed: 1 }), updatedAt: '2026-01-01T00:00:00.000Z' }
    const b = { ...createSession({ ...params, seed: 2 }), updatedAt: '2026-02-01T00:00:00.000Z' }
    expect(sortBooks([a, b]).map((x) => x.id)).toEqual([b.id, a.id])
    expect(matchesPlayed({ ...a, round: 3, phase: 'match' })).toBe(2)
    expect(matchesPlayed({ ...a, round: 3, phase: 'result' })).toBe(3)
  })
})
