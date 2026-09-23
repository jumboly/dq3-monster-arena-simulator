/**
 * 計算式・乱数プリミティブの単体テスト（battle-spec §3, §4.3, §6.4, §6.6, §6.9, §7.1, §9）。
 */
import { describe, expect, it } from 'vitest'
import {
  actionCountFromAttr,
  criticalDamage,
  evasionParams,
  meganteDamage,
  normalAttackDamage,
  resistanceIndexForCategory,
  rouletteIndex,
  sortActionOrder,
  turnAgilityFromRoll,
} from '../../src/core/battle/formulas'
import { RomRandom } from '../../src/core/rng/RomRandom'
import { ScriptedRandom } from './helpers'

const rom = (values: number[] = []) => {
  const src = new ScriptedRandom(values)
  return { r: new RomRandom(src), src }
}

describe('RomRandom（§9 呼び出し口の値域）', () => {
  it('各プリミティブが仕様の値域に写像される', () => {
    const { r, src } = rom([0, 255, 5, 0, 54, 0, 41, 3, 0])
    expect(r.rand00FF()).toBe(0)
    expect(r.rand00FF_b()).toBe(255)
    expect(r.rand0toA(7)).toBe(5)
    expect(r.rand63to99()).toBe(99)
    expect(r.rand63to99()).toBe(153)
    expect(r.rand5Ato83()).toBe(90)
    expect(r.rand5Ato83()).toBe(131)
    expect(r.randRangeXA(7, 11)).toBe(10)
    expect(r.randRangeXA(5, 5)).toBe(5)
    // rand0toA は閉区間（0..A）= nextInt(A+1)
    expect(src.requests).toEqual([256, 256, 8, 55, 55, 42, 42, 5, 1])
  })

  it('pickRandomBit は立っているビットから選び、空なら null で乱数を消費しない', () => {
    const { r, src } = rom([1])
    expect(r.pickRandomBit(0b1010)).toBe(3)
    expect(r.pickRandomBit(0)).toBeNull()
    expect(src.requests).toEqual([2])
    expect(r.callCount).toBe(1)
  })
})

describe('ターン中の素早さと行動順（§3.2, §3.3）', () => {
  it('turnAgi = floor((agi+20)*r/256)+1', () => {
    expect(turnAgilityFromRoll(0, 0)).toBe(1)
    expect(turnAgilityFromRoll(0, 255)).toBe(20)
    expect(turnAgilityFromRoll(236, 255)).toBe(256)
    expect(turnAgilityFromRoll(12, 128)).toBe(17)
  })

  it('降順・同値はインデックスの小さい方が先、key=0 は並ばない', () => {
    expect(sortActionOrder([5, 9, 5, 0, 9])).toEqual([1, 4, 0, 2])
    expect(sortActionOrder([0, 0])).toEqual([])
  })
})

describe('ルーレット $0267DC（§4.3）', () => {
  it('全部有効なら 8bit 合計 0 → rand0toA(255)', () => {
    const { r, src } = rom([0])
    expect(rouletteIndex(0, 0, r)).toBe(0)
    expect(src.requests).toEqual([256])
  })

  it('坂の重みの境界', () => {
    // 18 未満 → 0、18 → 1、255 → 7
    expect(rouletteIndex(1, 0, rom([17]).r)).toBe(0)
    expect(rouletteIndex(1, 0, rom([18]).r)).toBe(1)
    expect(rouletteIndex(1, 0, rom([255]).r)).toBe(7)
  })

  it('除外番号は合計から外れ、飛ばされる', () => {
    // 崖: 7 番(200)を除外 → 合計 56 → rand0toA(55)。55 は 6 番の末尾
    const { r, src } = rom([55])
    expect(rouletteIndex(2, 0x80, r)).toBe(6)
    expect(src.requests).toEqual([56])
    // 均等で 0 番を除外: r=0 → 1 番
    expect(rouletteIndex(0, 0x01, rom([0]).r)).toBe(1)
  })

  it('全除外（#$FF）なら失敗し乱数を引かない', () => {
    const { r, src } = rom()
    expect(rouletteIndex(0, 0xff, r)).toBeNull()
    expect(src.requests).toEqual([])
  })
})

describe('通常攻撃のダメージ式（§7.1）', () => {
  it('d < 0 かつ A >= 16 → rand0toA(A/8 - 1)', () => {
    const { r, src } = rom([4])
    const c = normalAttackDamage(40, 1023, r)
    expect(c.branch).toBe('weak-rand0toA')
    expect(c.damage).toBe(4)
    expect(src.requests).toEqual([5]) // a8=5 → 0..4
  })

  it('a8 >= d の境界（A=16, D=28 → d=2, a8=2）は弱い側', () => {
    const c = normalAttackDamage(16, 28, rom([1]).r)
    expect(c.branch).toBe('weak-rand0toA')
    expect(c.damage).toBe(1)
    // D=26 → d=3 > a8=2 → 通常式
    const n = normalAttackDamage(16, 26, rom([0]).r)
    expect(n.branch).toBe('normal')
    expect(n.damage).toBe(Math.floor((3 * 99) / 256))
  })

  it('A < 16 で弱い側は rand00FF & 1', () => {
    const c = normalAttackDamage(15, 100, rom([3]).r)
    expect(c.branch).toBe('weak-0or1')
    expect(c.damage).toBe(1)
  })

  it('A < 8 で d > a8 なら rand00FF & 1（通常式にならない）', () => {
    const c = normalAttackDamage(7, 0, rom([2]).r)
    expect(c.branch).toBe('low-atk-0or1')
    expect(c.damage).toBe(0)
  })

  it('通常式 floor(d * rand63to99 / 256) の最小・最大', () => {
    expect(normalAttackDamage(100, 50, rom([0]).r).damage).toBe(Math.floor((75 * 99) / 256))
    expect(normalAttackDamage(100, 50, rom([54]).r).damage).toBe(Math.floor((75 * 153) / 256))
  })

  it('痛恨 = floor(A/2) + floor(A * rand5Ato83 / 256)（守備力無視）', () => {
    expect(criticalDamage(100, rom([0]).r).damage).toBe(50 + Math.floor((100 * 90) / 256))
    expect(criticalDamage(100, rom([41]).r).damage).toBe(50 + Math.floor((100 * 131) / 256))
    expect(criticalDamage(1, rom([41]).r).damage).toBe(0)
  })
})

describe('その他の式', () => {
  it('メガンテのダメージモード（§6.9）', () => {
    expect(meganteDamage(102)).toBe(101)
    expect(meganteDamage(1)).toBe(5)
    expect(meganteDamage(344)).toBe(341)
    expect(meganteDamage(343)).toBe(341) // ((343-4)&~3)+5 = 336+5
  })

  it('みかわし: Group 4 は分母 64、それ以外 48（§6.4 / U-12）', () => {
    expect(evasionParams(7, 4)).toEqual({ num: 8, denom: 63 })
    expect(evasionParams(7, 0)).toEqual({ num: 8, denom: 47 })
    expect(evasionParams(0, 3)).toEqual({ num: 1, denom: 47 })
  })

  it('系統 → 耐性番号（§7.3）', () => {
    expect(resistanceIndexForCategory(0x01)).toBe(0x00)
    expect(resistanceIndexForCategory(0x0f)).toBe(0x00)
    expect(resistanceIndexForCategory(0x10)).toBe(0x01)
    expect(resistanceIndexForCategory(0x11)).toBe(0x04)
    expect(resistanceIndexForCategory(0x0a)).toBe(0x06)
    expect(resistanceIndexForCategory(0x00)).toBeNull()
    expect(resistanceIndexForCategory(0x15)).toBeNull()
  })

  it('複数回行動 0..3（§4.2）', () => {
    expect(actionCountFromAttr(0, rom().r)).toBe(1)
    expect(actionCountFromAttr(1, rom([0]).r)).toBe(2)
    expect(actionCountFromAttr(1, rom([1]).r)).toBe(1)
    expect(actionCountFromAttr(2, rom([0]).r)).toBe(1)
    expect(actionCountFromAttr(2, rom([2]).r)).toBe(3)
    expect(actionCountFromAttr(3, rom().r)).toBe(2)
  })
})
