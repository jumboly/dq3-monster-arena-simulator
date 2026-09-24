/**
 * DQ3BattleEngine のシナリオテスト。
 * 架空モンスター（tests/battle/helpers.ts）で「その分岐を必ず通る」状況を作り、仕様書の挙動を確かめる。
 */
import { describe, expect, it } from 'vitest'
import type { BattleLogEntry, BattleResult } from '../../src/core/battle/types'
import { getMatchCard, getMonster } from '../../src/core/data/gameData'
import { actions, engineWith, FAKE_BASE, fakeMonster, run, ScriptedRandom } from './helpers'

const ID = {
  passive: FAKE_BASE + 1,
  killer: FAKE_BASE + 2,
  fragile: FAKE_BASE + 3,
  wall: FAKE_BASE + 4,
  bomber: FAKE_BASE + 5,
  killer1hp: FAKE_BASE + 6,
  escaper: FAKE_BASE + 7,
  mostlyEscaper: FAKE_BASE + 8,
  basiruura: FAKE_BASE + 9,
  mage0: FAKE_BASE + 10,
  mage1: FAKE_BASE + 11,
  mage2: FAKE_BASE + 12,
  sealer: FAKE_BASE + 13,
  mageRich: FAKE_BASE + 14,
  weakAttacker: FAKE_BASE + 15,
  evader: FAKE_BASE + 16,
  multi0: FAKE_BASE + 17,
  multi2: FAKE_BASE + 18,
  multi3: FAKE_BASE + 19,
  conc: FAKE_BASE + 20,
  agi12: FAKE_BASE + 21,
  crit: FAKE_BASE + 22,
  dodger: FAKE_BASE + 23,
  rukanan: FAKE_BASE + 24,
  bomios: FAKE_BASE + 25,
  target: FAKE_BASE + 26,
  selfHealer: FAKE_BASE + 27,
} as const

const allAttack = [1, 1, 1, 1, 1, 1, 1, 1]
const monsters = [
  fakeMonster(ID.passive),
  fakeMonster(ID.killer, { attack: 200, agility: 255, commands: allAttack }),
  fakeMonster(ID.fragile, { maxHp: 1 }),
  // 守備力 1023 なら攻撃力 200 でも rand0toA(24) 止まりで 10 ターンでは倒れない
  fakeMonster(ID.wall, { defense: 1023 }),
  fakeMonster(ID.bomber, { mp: 255, commands: [26, 26, 26, 26, 26, 26, 26, 26] }),
  fakeMonster(ID.killer1hp, { attack: 200, agility: 255, maxHp: 1, commands: allAttack }),
  fakeMonster(ID.escaper, { attack: 10, commands: [106, 106, 106, 106, 106, 106, 106, 106] }),
  fakeMonster(ID.mostlyEscaper, { commands: [106, 106, 106, 106, 106, 106, 106, 105] }),
  fakeMonster(ID.basiruura, { mp: 255, agility: 255, commands: [28, 28, 28, 28, 28, 28, 28, 28] }),
  fakeMonster(ID.mage0, { mp: 3, selectionJudgment: 0, commands: [6, 6, 6, 6, 6, 6, 6, 6] }),
  fakeMonster(ID.mage1, { mp: 3, selectionJudgment: 1, commands: [6, 6, 6, 6, 6, 6, 6, 6] }),
  fakeMonster(ID.mage2, { mp: 3, selectionJudgment: 2, commands: [6, 6, 6, 6, 6, 6, 6, 6] }),
  fakeMonster(ID.sealer, { mp: 255, agility: 255, commands: [50, 50, 50, 50, 50, 50, 50, 50] }),
  fakeMonster(ID.mageRich, { mp: 20, commands: [6, 6, 6, 6, 6, 6, 6, 6] }),
  fakeMonster(ID.weakAttacker, { attack: 20, commands: allAttack }),
  fakeMonster(ID.evader, { evasion: 7, attack: 20, commands: allAttack }),
  fakeMonster(ID.multi0, { attack: 1, commands: allAttack, multiAction: 0 }),
  fakeMonster(ID.multi2, { attack: 1, commands: allAttack, multiAction: 2 }),
  fakeMonster(ID.multi3, { attack: 1, commands: allAttack, multiAction: 3 }),
  fakeMonster(ID.conc, { attack: 30, agility: 100, selectionJudgment: 1, concentrate: true, commands: allAttack }),
  fakeMonster(ID.agi12, { agility: 12 }),
  fakeMonster(ID.crit, { attack: 50, commands: [2, 2, 2, 2, 1, 1, 1, 1] }),
  fakeMonster(ID.dodger, { evasion: 7 }),
  fakeMonster(ID.rukanan, { mp: 255, agility: 255, commands: [54, 54, 54, 54, 54, 54, 54, 54] }),
  fakeMonster(ID.bomios, { mp: 255, agility: 255, commands: [30, 30, 30, 30, 30, 30, 30, 30] }),
  fakeMonster(ID.target, { defense: 101, agility: 100 }),
  // べホイミ（自身, ID 35 = j05/18/19）だけを持つ人間。最大 HP 9 なら初期 HP の抽選幅が 0 で必ず満タンから始まる
  fakeMonster(ID.selfHealer, { mp: 255, maxHp: 9, defense: 30, selectionJudgment: 1, commands: [35, 35, 35, 35, 35, 35, 35, 35] }),
]
const engine = engineWith(monsters)

const defeats = (log: BattleLogEntry[]) => log.filter((e) => e.kind === 'defeat')
const simples = (r: BattleResult) => r.log.map((e) => e.simple)

/** 条件を満たす最初の seed を探す（決定的。テストが seed の偶然に依存しないように） */
function findSeed(pred: (seed: number) => boolean, max = 500): number {
  for (let s = 1; s <= max; s++) if (pred(s)) return s
  throw new Error('条件を満たす seed が見つからない')
}

describe('終了判定（§8）', () => {
  it('10 ターン目の実行後に判定し、賭けた選手が生存なら引き分け（endType 7）', () => {
    const r = run(engine, [ID.passive, ID.passive, ID.passive], 0, 1)
    expect(r.outcome).toEqual({ kind: 'draw', reason: 'turn-limit', turn: 10, endType: 7 })
    expect(r.turns).toBe(10)
    // 10 ターン目のターン終了処理まで行い、11 ターン目は始まらない
    expect(r.log.some((e) => e.kind === 'turn-end' && e.turn === 10)).toBe(true)
    expect(r.log.some((e) => e.turn === 11)).toBe(false)
  })

  it('10 ターン時に賭けた選手が死亡・他 2 体以上生存 → no-winner / endType 6', () => {
    const ids = [ID.fragile, ID.killer, ID.wall]
    const seed = findSeed((s) => defeats(run(engine, ids, 0, s).log).length > 0)
    const r = run(engine, ids, 0, seed)
    const d = defeats(r.log)
    expect(d[0].targetSlots).toEqual([0])
    // 賭けた選手が倒れても 2 体残っているので戦闘は続く（タイプ 6 は暫定）
    expect(d[0].turn).toBeLessThan(10)
    expect(r.outcome).toEqual({ kind: 'no-winner', reason: 'turn-limit', turn: 10, endType: 6, survivors: [1, 2] })
  })

  it('生存 1 体で決着（賭けた選手なら 5、それ以外なら 6）', () => {
    const r5 = run(engine, [ID.killer, ID.fragile], 0, 3)
    expect(r5.outcome).toMatchObject({ kind: 'winner', slot: 0, endType: 5, turn: 1 })
    const r6 = run(engine, [ID.killer, ID.fragile], 1, 3)
    expect(r6.outcome).toMatchObject({ kind: 'winner', slot: 0, endType: 6, turn: 1 })
  })

  it('賭けた選手が先に倒れた後で残りが相打ち（生存 0）→ 引き分け（endType 7）', () => {
    const ids = [ID.fragile, ID.bomber, ID.killer1hp]
    const seed = findSeed((s) => {
      const d = defeats(run(engine, ids, 0, s).log)
      return d.length > 0 && d[0].targetSlots?.[0] === 0 && d[0].actorSlot === 2
    })
    const r = run(engine, ids, 0, seed)
    expect(defeats(r.log)[0].targetSlots).toEqual([0])
    expect(r.outcome).toMatchObject({ kind: 'draw', reason: 'all-inactive', endType: 7 })
    expect(r.finalStates.every((s) => s.dead)).toBe(true)
    // メガンテで術者も死ぬ（§6.9）
    expect(simples(r).some((t) => t.includes('ちからつき'))).toBe(true)
  })

  it('betSlot=null は Group 4 なしで走らせ no-bet-mode を計上（P-10）', () => {
    const r = run(engine, [ID.passive, ID.passive], null, 1)
    expect(r.fidelityHits['no-bet-mode']).toBe(1)
    expect(r.finalStates.every((s) => s.groupId !== 4 && !s.isBetTarget)).toBe(true)
    // Group ≥ 4 が居ないので $02B32F は常に「タイプ 6（暫定）」を書く → 10 ターンで no-winner
    expect(r.outcome).toMatchObject({ kind: 'no-winner', endType: 6, survivors: [0, 1] })
  })
})

describe('初期化（§2）', () => {
  it('slot k → group k、賭けた slot だけ Group 4（originalGroupId は保持）', () => {
    const r = run(engine, [ID.passive, ID.passive, ID.passive, ID.passive], 2, 1)
    expect(r.finalStates.map((s) => s.groupId)).toEqual([0, 1, 4, 3])
    expect(r.finalStates.map((s) => s.originalGroupId)).toEqual([0, 1, 2, 3])
    expect(r.finalStates.map((s) => s.isBetTarget)).toEqual([false, false, true, false])
    expect(r.finalStates.map((s) => s.combatantIndex)).toEqual([0, 1, 2, 3])
  })

  it('初期 HP は maxHp - rand0toA(maxHp/10)（U-09）、MP 255 は 65535', () => {
    const rng = new ScriptedRandom([100, 0])
    const r = run(engine, [ID.passive, ID.sealer], 0, rng)
    expect(r.finalStates[0].hp).toBe(900)
    expect(r.finalStates[1].mp).toBe(65535)
    expect(rng.requests.slice(0, 2)).toEqual([101, 101])
    expect(r.fidelityHits['U-09']).toBe(2)
  })

  it('同名モンスターは A/B 表記', () => {
    const card = getMatchCard(4) // 試合 5: アルミラージ ×4
    const r = run(engine, card.entries.map((e) => e.monsterId), 0, 1)
    expect(r.finalStates.map((s) => s.name)).toEqual(['アルミラージA', 'アルミラージB', 'アルミラージC', 'アルミラージD'])
    expect(r.finalStates.map((s) => s.duplicateIndex)).toEqual([0, 1, 2, 3])
  })

  it('あやしいかげの実体は先頭レベル以下から決まり、Simple には出さない（§2.4 / U-10）', () => {
    const card = getMatchCard(37)
    const r = run(engine, card.entries.map((e) => e.monsterId), 0, 7, { leaderLevel: 1 })
    for (const s of r.finalStates) {
      expect(s.monsterId).toBe(0x19)
      expect(getMonster(s.transformMonsterId).level).toBeLessThanOrEqual(1)
      expect(s.name.startsWith('あやしいかげ')).toBe(true)
    }
    const start = r.log[0]
    expect(start.kind).toBe('battle-start')
    for (const s of r.finalStates) {
      const entity = getMonster(s.transformMonsterId).name
      expect(start.simple.includes(entity)).toBe(false)
    }
    expect(String(start.internal?.idx0)).toContain('entity')
    expect(r.fidelityHits['U-10']).toBe(3)
  })
})

describe('コマンド選択（§4.3, §4.4）', () => {
  it('格闘場使用許可 0 のコマンドは除外して再抽選され、全除外時だけ通常攻撃（index 8）', () => {
    const r = run(engine, [ID.escaper, ID.passive], 1, 1)
    const acts = actions(r.log).filter((e) => e.actorSlot === 0)
    expect(acts.length).toBeGreaterThan(0)
    for (const a of acts) {
      expect(a.internal?.commandId).toBe('0x01')
      expect(a.internal?.commandIndex).toBe(8)
    }
  })

  it('除外後に残った番号が選ばれる（にげる ×7 + 様子を見る → 常に様子を見る、置換ではない）', () => {
    const r = run(engine, [ID.mostlyEscaper, ID.passive], 1, 1)
    const acts = actions(r.log).filter((e) => e.actorSlot === 0)
    expect(acts).toHaveLength(10)
    for (const a of acts) {
      expect(a.internal?.commandId).toBe('0x69')
      expect(a.internal?.commandIndex).toBe(7)
    }
  })

  it('MP 不足: バカは MP を見ず毎回失敗、人間は 1 回失敗後に見る、神は常に見る', () => {
    const shortage = (r: BattleResult) => r.log.filter((e) => e.simple.includes('MPが たりない')).length
    const r0 = run(engine, [ID.mage0, ID.wall], 1, 1)
    const r1 = run(engine, [ID.mage1, ID.wall], 1, 1)
    const r2 = run(engine, [ID.mage2, ID.wall], 1, 1)
    expect(shortage(r0)).toBe(9) // 1 ターン目だけ唱えられ、2..10 ターン目は失敗
    expect(r0.finalStates[0].mpShortage).toBe(true)
    expect(r0.finalStates[0].mp).toBe(1)
    expect(shortage(r1)).toBe(1)
    expect(r1.finalStates[0].mpShortage).toBe(true)
    // 人間は失敗後、メラしか持たないので全除外 → 通常攻撃
    const after = actions(r1.log).filter((e) => e.actorSlot === 0 && e.turn >= 3)
    expect(after.every((a) => a.internal?.commandId === '0x01' && a.internal?.commandIndex === 8)).toBe(true)
    expect(shortage(r2)).toBe(0)
    expect(r2.finalStates[0].mpShortage).toBe(false)
  })

  it('マホトーン中でも MP は消費される（§4.5）', () => {
    const r = run(engine, [ID.sealer, ID.mageRich], 0, 2)
    const casts = actions(r.log).filter((e) => e.actorSlot === 1 && e.internal?.commandId === '0x06')
    const sealed = r.log.filter((e) => e.simple.includes('ふうじこめられている'))
    expect(sealed.length).toBeGreaterThan(0)
    expect(r.finalStates[1].mp).toBe(20 - 2 * casts.length)
    expect(r.finalStates[1].spellFailed).toBe(true)
  })
})

describe('バシルーラ（§6.10）', () => {
  it('成功した対象は active=false になり、以後対象にならない', () => {
    const r = run(engine, [ID.basiruura, ID.passive, ID.passive], 0, 1)
    expect(r.outcome).toMatchObject({ kind: 'winner', slot: 0, endType: 5 })
    const leaves = r.log.filter((e) => e.kind === 'leave')
    expect(leaves).toHaveLength(2)
    for (const s of r.finalStates.slice(1)) {
      expect(s.active).toBe(false)
      expect(s.dead).toBe(false)
    }
    // 追い出された後に対象として現れない
    const first = leaves[0]
    const gone = first.targetSlots![0]
    const later = r.log.slice(r.log.indexOf(first) + 1)
    expect(later.some((e) => e.kind === 'action' && e.targetSlots?.includes(gone))).toBe(false)
  })
})

describe('状態異常（§4.1, §6.4, §6.7）', () => {
  it('マヒ中は行動せず、回避判定もしない', () => {
    const e = engineWith(monsters, {
      prepareCombatants: (states) => {
        states[1].paralyzed = true
      },
    })
    const r = run(e, [ID.weakAttacker, ID.evader], 1, 5)
    expect(actions(r.log).some((a) => a.actorSlot === 1)).toBe(false)
    expect(simples(r).some((t) => t.includes('みをかわした'))).toBe(false)
    expect(r.fidelityHits['U-12']).toBeUndefined()
    expect(r.finalStates[1].paralyzed).toBe(true) // U-08 暫定: 戦闘中は回復しない
  })

  it('眠り中は行動せず回避もしない。覚醒判定は 1/8, 1/3, 1/2, 1 で、4 回目の手番までに必ず起き、次のターンから動く（U-08）', () => {
    const e = engineWith(monsters, {
      prepareCombatants: (states) => {
        states[1].sleepCounter = 1
      },
    })
    const wakeTurns: number[] = []
    for (let seed = 1; seed <= 400; seed++) {
      const r = run(e, [ID.weakAttacker, ID.evader], 1, seed)
      const wake = r.log.find((x) => x.simple.includes('めをさました'))
      if (!wake) continue // 起きる前に決着した
      wakeTurns.push(wake.turn)
      // 行動はターン開始時に決めるので、起きたターンには動けず次のターンから動く
      const own = actions(r.log).filter((a) => a.actorSlot === 1)
      if (own.length > 0) expect(own[0].turn).toBe(wake.turn + 1)
      // 眠っている間に賭けた選手（Group 4）の回避 rand0toA(63) を引いていない
      const before = r.log.slice(0, r.log.indexOf(wake))
      expect(before.some((x) => String(x.internal?.rng ?? '').includes('rand0toA(63)'))).toBe(false)
    }
    expect(Math.max(...wakeTurns)).toBeLessThanOrEqual(4)
    // 1 回目の判定で起きる率は 1/8。400 試行の標準誤差は約 1.7% なので、広めの幅で確かめる
    const first = wakeTurns.filter((t) => t === 1).length / wakeTurns.length
    expect(first).toBeGreaterThan(0.05)
    expect(first).toBeLessThan(0.2)
  })
})

describe('能力変化（§7.5）', () => {
  const changes = (r: BattleResult) => r.log.filter((e) => e.kind === 'status' && e.actorSlot === 0).map((e) => [e.detail?.before, e.detail?.after])
  it('ルカナンは現在の守備力の 1/2 を下げる（重ねるほど減り方が小さくなる）', () => {
    const r = run(engine, [ID.rukanan, ID.target], 0, 1)
    expect(changes(r).slice(0, 3)).toEqual([
      [101, 51],
      [51, 26],
      [26, 13],
    ])
  })
  it('ボミオスは素早さを 0 にする', () => {
    const r = run(engine, [ID.bomios, ID.target], 0, 1)
    expect(changes(r)[0]).toEqual([100, 0])
  })
})

describe('自身回復（j18/19）', () => {
  it('HP が満タンなら選ばず、減っていれば自分にかける', () => {
    const r = run(engine, [ID.selfHealer, ID.weakAttacker], 0, 1)
    const own = actions(r.log).filter((a) => a.actorSlot === 0)
    // 1 ターン目は満タンなので回復は全除外され、通常攻撃になる
    expect(own[0].internal?.commandId).toBe('0x01')
    const heals = own.filter((a) => a.internal?.commandId === '0x23')
    expect(heals.length).toBeGreaterThan(0)
    for (const h of heals) expect(h.targetSlots).toEqual([0])
  })
})

describe('複数回行動（§4.2）', () => {
  const perTurn = (r: BattleResult, slot: number) => {
    const m = new Map<number, number>()
    for (const a of actions(r.log)) if (a.actorSlot === slot) m.set(a.turn, (m.get(a.turn) ?? 0) + 1)
    return [...m.values()]
  }
  it('複数回 0 は 1 回、3 は必ず 2 回', () => {
    expect(new Set(perTurn(run(engine, [ID.multi0, ID.wall], 1, 1), 0))).toEqual(new Set([1]))
    expect(new Set(perTurn(run(engine, [ID.multi3, ID.wall], 1, 1), 0))).toEqual(new Set([2]))
  })
  it('複数回 2 は 1〜3 回', () => {
    const seen = new Set<number>()
    for (let s = 1; s <= 5; s++) for (const n of perTurn(run(engine, [ID.multi2, ID.wall], 1, s), 0)) seen.add(n)
    expect(seen).toEqual(new Set([1, 2, 3]))
  })
})

describe('Group 4（§7.8）', () => {
  const evasionArgs = (r: BattleResult) => {
    const m = r.log.map((e) => String(e.internal?.rng ?? '')).join(' ').match(/rand0toA\((47|63)\)/g) ?? []
    return new Set(m)
  }
  it('回避の分母: 賭けた選手（Group 4）は 64、それ以外は 48', () => {
    expect(evasionArgs(run(engine, [ID.weakAttacker, ID.dodger], 1, 1))).toEqual(new Set(['rand0toA(63)']))
    expect(evasionArgs(run(engine, [ID.weakAttacker, ID.dodger], 0, 1))).toEqual(new Set(['rand0toA(47)']))
  })

  it('集中攻撃: 賭けた選手は専用記憶 $2466（Group 4）を使い、標的が倒れるまで同じ相手を狙う', () => {
    const r = run(engine, [ID.conc, ID.passive, ID.passive, ID.passive], 0, 3)
    const decide = r.log.filter((e) => e.internal?.phase === 'decide' && e.internal?.actorIndex === 0)
    const mem = String(decide[0].internal?.concentration).split(',')
    expect(mem[4]).not.toBe('0xFF')
    expect(mem[0]).toBe('0xFF')
    const targets = new Set(actions(r.log).filter((a) => a.actorSlot === 0).map((a) => a.targetSlots?.[0]))
    expect(targets.size).toBe(1)

    // 賭けなければ元グループ 0 の記憶 $2462 を使う
    const r2 = run(engine, [ID.conc, ID.passive, ID.passive, ID.passive], 1, 3)
    const mem2 = String(r2.log.find((e) => e.internal?.phase === 'decide' && e.internal?.actorIndex === 0)?.internal?.concentration).split(',')
    expect(mem2[0]).not.toBe('0xFF')
    expect(mem2[4]).toBe('0xFF')
  })

  it('同一 seed でも betSlot によって結果が変わりうる', () => {
    const ids = getMatchCard(18).entries.map((e) => e.monsterId) // 試合 19（わらいぶくろ みかわし 7）
    let differ = 0
    for (let s = 1; s <= 60; s++) {
      const a = run(engine, ids, 0, s)
      const b = run(engine, ids, 2, s)
      if (JSON.stringify(a.outcome) !== JSON.stringify(b.outcome)) differ++
    }
    expect(differ).toBeGreaterThan(0)
  })
})

describe('行動順（§3.2, §3.3）', () => {
  it('turnAgi は 23→0 の順に引き、key = turnAgi + 1 の降順', () => {
    // HP 抽選 3 回 → 素早さ: idx2, idx1, idx0 の順
    const rng = new ScriptedRandom([0, 0, 0, 10, 200, 128])
    const r = run(engine, [ID.agi12, ID.agi12, ID.agi12], 0, rng)
    const order = r.log.find((e) => e.kind === 'turn-order' && e.turn === 1)!
    expect(order.internal?.order).toBe('1,0,2')
    const agi = r.log.find((e) => e.internal?.phase === 'turn-agility' && e.turn === 1)!
    expect(agi.detail).toEqual({ idx2: '(12+20)*10/256+1=2', idx1: '(12+20)*200/256+1=26', idx0: '(12+20)*128/256+1=17' })
    expect(Object.values(order.detail ?? {})).toEqual([27, 18, 3])
  })

  it('同値はインデックスの小さい方が先', () => {
    const r = run(engine, [ID.agi12, ID.agi12, ID.agi12, ID.agi12], 3, new ScriptedRandom([], () => 0))
    const order = r.log.find((e) => e.kind === 'turn-order')!
    expect(order.internal?.order).toBe('0,1,2,3')
  })
})

describe('痛恨（§6.6）', () => {
  it('痛恨判定（rand0toA(7)）はコマンド #$02 のときだけ行われる', () => {
    const r = run(engine, [ID.crit, ID.wall], 1, 4)
    const dmg = r.log.filter((e) => (e.kind === 'damage' || e.kind === 'miss') && e.actorSlot === 0 && e.detail?.attack !== undefined)
    const acts = actions(r.log).filter((a) => a.actorSlot === 0)
    expect(acts.some((a) => a.internal?.commandId === '0x02')).toBe(true)
    expect(acts.some((a) => a.internal?.commandId === '0x01')).toBe(true)
    for (const d of dmg) {
      const act = [...r.log.slice(0, r.log.indexOf(d))].reverse().find((e) => e.kind === 'action')!
      expect(d.detail?.criticalRoll !== undefined).toBe(act.internal?.commandId === '0x02')
    }
  })
})

describe('決定性', () => {
  it('同じ seed ならログが完全一致', () => {
    for (const idx of [4, 18, 30]) {
      const ids = getMatchCard(idx).entries.map((e) => e.monsterId)
      const a = run(engine, ids, 1, 12345)
      const b = run(engine, ids, 1, 12345)
      expect(a).toEqual(b)
    }
  })
})
