/**
 * 戦闘の計算式（純関数）。
 *
 * なぜエンジン本体から分けるか: 仕様書の式は境界条件（負の差・攻撃力 8/16 の閾値・8bit 加算など）が
 * 結果分布を左右するため、乱数を注入して単体でテストできる形にしておきたい。
 * 乱数は必ず RomRandom の名前付きプリミティブ経由で引く（battle-spec §9 の消費順を保つため）。
 */
import type { RomRandom } from '../rng/RomRandom'

/** 空コマンド（未使用の行動枠）。実行処理はスキップされる（battle-spec §4.2, RGH-014, Confirmed） */
export const EMPTY_COMMAND_ID = 0xa4

/** 行動対象エンコード（battle-spec §5.1, Likely） */
export const TARGET_GROUP_FLAG = 0x20
export const TARGET_MULTI_FLAG = 0x40
/** 判断ルーチン失敗時の「空」 */
export const TARGET_EMPTY = 0x40
/** 全体攻撃（敵陣すべて） */
export const TARGET_ALL_ENEMIES = 0x41

/**
 * ターン中の素早さ（コマンド実行優位 $2045）。battle-spec §3.2 (Confirmed, RGH-009 $025D56)。
 * 乗算 $0010D6 の上位 2 バイト採用 = 256 で割って切り捨て。
 */
export function turnAgilityFromRoll(agility: number, r: number): number {
  return Math.floor(((agility + 20) * r) / 256) + 1
}

/**
 * $025DAC 行動順決定。battle-spec §3.3 (Confirmed)。
 * 「厳密に大きいときだけ更新」なので同値はインデックスの小さい方が先。key=0 は並ばない。
 * keys は戦闘員インデックス順（0..23）。
 */
export function sortActionOrder(keys: readonly number[]): number[] {
  const k = [...keys]
  const order: number[] = []
  for (;;) {
    let best = -1
    let bestVal = 0
    for (let x = 0; x < k.length; x++) {
      if (k[x] > bestVal) {
        best = x
        bestVal = k[x]
      }
    }
    if (best < 0) break
    k[best] = 0
    order.push(best)
  }
  return order
}

/** $0268CD 戦略別重み表（battle-spec §4.3, RGH-011-2 / dqbook, Confirmed）。戦略 3 はマスクとして使う */
export const STRATEGY_WEIGHTS: readonly (readonly number[])[] = [
  [32, 32, 32, 32, 32, 32, 32, 32],
  [18, 22, 26, 30, 34, 38, 42, 46],
  [2, 4, 6, 8, 10, 12, 14, 200],
  [1, 2, 4, 8, 16, 32, 64, 128],
]

/**
 * $0267DC ルーレット。battle-spec §4.3 (Confirmed, RGH-011-3)。
 * blocked が #$FF（8 個すべて除外）なら null（c=on = 失敗）。
 * 合計は 8bit 加算（全部有効だと 256 → 0）で、rand0toA((sum-1) & #$FF) を引く。
 */
export function rouletteIndex(strategy: number, blocked: number, rng: RomRandom): number | null {
  if ((blocked & 0xff) === 0xff) return null
  const w = STRATEGY_WEIGHTS[strategy]
  let sum = 0
  for (let i = 0; i < 8; i++) if (!(blocked & (1 << i))) sum = (sum + w[i]) & 0xff
  let r = rng.rand0toA((sum - 1) & 0xff)
  for (let i = 0; i < 7; i++) {
    if (blocked & (1 << i)) continue
    if (r < w[i]) return i
    r -= w[i]
  }
  return 7
}

/** 通常攻撃（モンスター側）の計算根拠。Detail ログにそのまま出す */
export interface NormalAttackCalc {
  attack: number
  defense: number
  d: number
  a8: number
  branch: 'weak-rand0toA' | 'weak-0or1' | 'low-atk-0or1' | 'normal'
  roll: number
  damage: number
}

/**
 * 通常攻撃の基本ダメージ（行動主体グループ < 5 = Group 4 を含む全モンスター）。
 * battle-spec §7.1 (Confirmed, RGH-020 $028DB0 → $028E0E)。
 */
export function normalAttackDamage(attack: number, defense: number, rng: RomRandom): NormalAttackCalc {
  const d = attack - Math.floor(defense / 2)
  const a8 = Math.floor(attack / 8)
  if (d < 0 || a8 >= d) {
    if (attack >= 16) {
      const roll = rng.rand0toA(a8 - 1)
      return { attack, defense, d, a8, branch: 'weak-rand0toA', roll, damage: roll }
    }
    const roll = rng.rand00FF()
    return { attack, defense, d, a8, branch: 'weak-0or1', roll, damage: roll & 1 }
  }
  if (attack < 8) {
    const roll = rng.rand00FF()
    return { attack, defense, d, a8, branch: 'low-atk-0or1', roll, damage: roll & 1 }
  }
  const roll = rng.rand63to99()
  return { attack, defense, d, a8, branch: 'normal', roll, damage: Math.floor((d * roll) / 256) }
}

/** 痛恨ダメージ（守備力無視）。battle-spec §6.6 (Confirmed, RGH-020 / $0014A3) */
export function criticalDamage(attack: number, rng: RomRandom): { roll: number; damage: number } {
  const roll = rng.rand5Ato83()
  return { roll, damage: Math.floor(attack / 2) + Math.floor((attack * roll) / 256) }
}

/**
 * メガンテのダメージモード（HP 依存）。battle-spec §6.9 (Confirmed 式)。
 * h は対象の現在 HP。
 */
export function meganteDamage(h: number): number {
  if (h >= 344) return ((h - 4) & ~3) + 1
  return (Math.max(h - 4, 0) & ~3) + 5
}

/**
 * みかわしのパラメータ。battle-spec §6.4 (Confirmed: 分母) / U-12 (暫定: 分子 = みかわし + 1)。
 * 対象グループ ≥ 4（格闘場で賭けた選手）は分母 63（= /64）、それ以外は 47（= /48）。
 */
export function evasionParams(evasion: number, targetGroup: number): { num: number; denom: number } {
  return { num: evasion + 1, denom: targetGroup >= 4 ? 63 : 47 }
}

/**
 * 耐性値 → 成功閾値（/256）。U-13 暫定: [256, 192, 76, 0]。
 * 0/2/3 は RGH-MOD-011 の分岐定数（#$0100 / #$004C / #$0000, Likely）、1 は未確認（75% 説を採用）。
 */
export const RESISTANCE_P256: readonly number[] = [256, 192, 76, 0]

/**
 * 系統分類 → モンスター耐性番号。battle-spec §7.3 の表（RGH-025, Likely）。
 * null は耐性ロールを行わない系統（その他 #$00、眠り/毒/マヒ攻撃 #$15-#$17）。
 */
export function resistanceIndexForCategory(category: number): number | null {
  switch (category) {
    case 0x01:
    case 0x0f: // 炎の息はメラ系の耐性を流用
      return 0x00
    case 0x02:
    case 0x10: // 吹雪の息はヒャド系の耐性を流用
      return 0x01
    case 0x03:
      return 0x02
    case 0x04:
      return 0x03
    case 0x05:
    case 0x11:
      return 0x04
    case 0x06:
      return 0x05
    case 0x07:
    case 0x14:
      return 0x0d
    case 0x08:
      return 0x0a
    case 0x09:
      return 0x0c
    case 0x0a:
      return 0x06
    case 0x0b:
      return 0x07
    case 0x0c:
      return 0x09
    case 0x0d:
      return 0x08
    case 0x0e:
      return 0x0b
    default:
      return null
  }
}

/** 複数回行動の回数（battle-spec §4.2: 枠組み Confirmed / 分布 Likely。アクセサ内部の乱数呼び出しは未公開） */
export function actionCountFromAttr(multiAction: number, rng: RomRandom): number {
  switch (multiAction) {
    case 0:
      return 1
    case 1:
      // 1/2 で 2 回。どの呼び出し口を使うかは未公開なので 0..A の閉区間プリミティブで表す
      return rng.rand0toA(1) === 0 ? 2 : 1
    case 2:
      return rng.rand0toA(2) + 1
    case 3:
      return 2
    default:
      throw new RangeError(`複数回属性 ${multiAction} は 0..3 の範囲外`)
  }
}
