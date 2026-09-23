/**
 * 生成データ（src/data/generated/game-data.json）の整合性検証。
 * `npm run data` 済みであることが前提（npm test は自動で先に実行する）。
 */
import { describe, expect, it } from 'vitest'
import {
  getCommand,
  getDamage,
  getGameData,
  getMatchCard,
  getMonster,
  NORMAL_ATTACK_COMMAND_ID,
  toArenaCommandId,
} from '../../src/core/data/gameData'

const data = getGameData()
/** 試合 1..37。試合 38（あやしいかげ）は出場者が戦闘開始時に決まるため Phase B で別扱い */
const phaseACards = data.matchCards.slice(0, 37)

describe('マッチメイク', () => {
  it('38 試合が index 0..37 の順に読み込まれている', () => {
    expect(data.matchCards).toHaveLength(38)
    expect(data.matchCards.map((c) => c.index)).toEqual([...Array(38).keys()])
  })

  it('各試合の出場者は 2..4 体で、オッズの基は 1..255', () => {
    for (const card of data.matchCards) {
      expect(card.entries.length).toBeGreaterThanOrEqual(2)
      expect(card.entries.length).toBeLessThanOrEqual(4)
      for (const e of card.entries) {
        expect(e.baseOdds).toBeGreaterThanOrEqual(1)
        expect(e.baseOdds).toBeLessThanOrEqual(255)
      }
    }
  })

  it('全カードのモンスター参照が有効（ID 0 = n/a を含まない）', () => {
    for (const card of data.matchCards) {
      for (const e of card.entries) {
        expect(e.monsterId).toBeGreaterThan(0)
        const m = getMonster(e.monsterId)
        expect(m.id).toBe(e.monsterId)
        expect(m.name).not.toBe('n/a')
      }
    }
  })

  it('試合 1～37 に直接登場するモンスターは 70 種', () => {
    // 依頼時の想定値 70 を、生データから数え直して一致を確認した（dq3_C30DC5_matchmake.txt 2..38 行目）
    const ids = new Set(phaseACards.flatMap((c) => c.entries.map((e) => e.monsterId)))
    expect(ids.size).toBe(70)
  })

  it('試合 38 はあやしいかげ 3 体で、あやしいかげのモンスターデータも読み込まれている', () => {
    const card = getMatchCard(37)
    expect(card.entries.map((e) => getMonster(e.monsterId).name)).toEqual(['あやしいかげ', 'あやしいかげ', 'あやしいかげ'])
    const shadow = getMonster(card.entries[0].monsterId)
    expect(shadow.maxHp).toBeGreaterThan(0)
    expect(shadow.commands.every((id) => id > 0)).toBe(true)
  })
})

describe('モンスター', () => {
  it('160 体、配列添字 = ID', () => {
    expect(data.monsters).toHaveLength(160)
    data.monsters.forEach((m, i) => expect(m.id).toBe(i))
  })

  it('全モンスターのコマンド参照が有効', () => {
    for (const m of data.monsters) {
      expect(m.commands).toHaveLength(8)
      expect(m.commandConstraints).toHaveLength(8)
      expect(m.resistances).toHaveLength(14)
      for (const id of m.commands) expect(getCommand(id).id).toBe(id)
    }
  })

  it('空コマンド（ID 0）を持つのは ID 0 とテスト用モンスター（せんたく*）だけ', () => {
    const withNull = data.monsters.filter((m) => m.commands.includes(0))
    expect(withNull.map((m) => m.id)).toEqual([0, 143, 144, 145, 146, 147, 148, 149])
    for (const m of withNull.slice(1)) expect(m.name.startsWith('せんたく')).toBe(true)
  })

  it('名前解決の代表例: スライムは こうげき と （にげる）、さまようよろいは （ホイミスライム呼び） を持つ', () => {
    const byName = (n: string) => data.monsters.find((m) => m.name === n)!
    expect(new Set(byName('スライム').commands.map((id) => getCommand(id).name))).toEqual(new Set(['こうげき', '（にげる）']))
    expect(byName('さまようよろい').commands.map((id) => getCommand(id).name)).toContain('（ホイミスライム呼び）')
  })
})

describe('コマンドと格闘場許可', () => {
  it('配列添字 = ID で、ID 1 は通常攻撃（格闘場許可）', () => {
    data.commands.forEach((c, i) => expect(c.id).toBe(i))
    expect(getCommand(NORMAL_ATTACK_COMMAND_ID).name).toBe('こうげき')
    expect(getCommand(NORMAL_ATTACK_COMMAND_ID).flags.arenaAllowed).toBe(true)
  })

  it('仲間呼び系（96..101）はすべて格闘場許可 = 0', () => {
    const calls = data.commands.filter((c) => c.name.includes('呼び）'))
    expect(calls.map((c) => c.id)).toEqual([96, 97, 98, 99, 100, 101])
    for (const c of calls) expect(c.flags.arenaAllowed).toBe(false)
  })

  it('格闘場許可 = 0 は 空・仲間呼び・にげる の 8 コマンドだけ（データから読み取った事実）', () => {
    const forbidden = data.commands.filter((c) => !c.flags.arenaAllowed).map((c) => c.id)
    expect(forbidden).toEqual([0, 96, 97, 98, 99, 100, 101, 106])
    expect(getCommand(106).name).toBe('（にげる）')
  })

  it('呪文・ブレスなど通常の戦闘コマンドは格闘場許可 = 1', () => {
    for (const name of ['メラ', 'ホイミ', 'ラリホー', 'メガンテ', '（かえん）', '（ふしぎなおどり）', 'ぼうぎょ', '（様子を見る）']) {
      const c = data.commands.find((x) => x.name === name)!
      expect(c.flags.arenaAllowed, name).toBe(true)
    }
  })

  it('toArenaCommandId は許可 = 0 を通常攻撃に置き換える', () => {
    expect(toArenaCommandId(96)).toBe(NORMAL_ATTACK_COMMAND_ID)
    expect(toArenaCommandId(106)).toBe(NORMAL_ATTACK_COMMAND_ID)
    expect(toArenaCommandId(6)).toBe(6)
  })

  it('ビットフィールドの値域が解説 XML の定義内', () => {
    for (const c of data.commands) {
      expect(c.targetScope).toBeLessThanOrEqual(3)
      expect(c.targetSide).toBeLessThanOrEqual(4)
      expect(c.targetAliveCondition).toBeLessThanOrEqual(2)
      expect(c.category).toBeLessThanOrEqual(0x17)
      expect(c.targetJudgment).toHaveLength(3)
      expect(c.successRate).toHaveLength(2)
    }
  })
})

describe('ダメージ', () => {
  it('50 個、配列添字 = ID', () => {
    expect(data.damages).toHaveLength(50)
    data.damages.forEach((d, i) => expect(d.id).toBe(i))
  })

  it('全コマンドのダメージ参照が有効', () => {
    for (const c of data.commands) expect(getDamage(c.damageId).id).toBe(c.damageId)
  })

  it('下限 ≦ 上限（1023 のマジックナンバーを除く）', () => {
    for (const d of data.damages) {
      if (d.pcMin !== 1023) expect(d.pcMin).toBeLessThanOrEqual(d.pcMax)
      if (d.enemyMin !== 1023) expect(d.enemyMin).toBeLessThanOrEqual(d.enemyMax)
    }
  })

  it('べホマのダメージは 1023（抽選せず 65535 = 全快）', () => {
    const behoma = data.commands.find((c) => c.name === 'べホマ')!
    expect(getDamage(behoma.damageId).enemyMin).toBe(1023)
  })

  it('範囲外 ID は例外', () => {
    expect(() => getDamage(50)).toThrow(RangeError)
    expect(() => getMonster(-1)).toThrow(RangeError)
  })
})

describe('出典', () => {
  it('sourceCommit は vendor/dqbook/SOURCE.md の固定コミット', () => {
    expect(data.sourceCommit).toBe('04bb87e7b1217e7b6f926204560613848cda71bd')
  })
})
