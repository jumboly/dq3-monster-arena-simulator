/**
 * 格闘場オッズの生成（マッチメイク $C3EC84 内の処理）。
 *
 * 出典: dqbook dq3_matchmake「格闘場オッズの計算方法」（表 $C3EDBB）、
 * docs/research/arena-spec.md §2.3。バンク $03 の逆アセンブルは未公開。
 */
import { randInclusive, type RandomSource } from '../rng/RandomSource'
import type { Odds } from './types'

/**
 * 属性値 B の帯ごとの中間生成値の振れ幅 k（v = randint(0, 2k) - k）。
 * 表そのものは dqbook の記載どおり（Likely: 表の出典は文章のみで、コード未公開）。
 */
const SPREAD_BANDS: ReadonlyArray<{ max: number; k: number }> = [
  { max: 5, k: 3 },
  { max: 10, k: 7 },
  { max: 30, k: 20 },
  { max: 100, k: 50 },
  { max: 255, k: 100 },
]

export function oddsSpread(base: number): number {
  const band = SPREAD_BANDS.find((b) => base <= b.max)
  if (!band || base < 1) throw new RangeError(`オッズ属性値は 1..255: ${base}`)
  return band.k
}

export interface OddsRoll {
  odds: Odds
  /** 中間生成値 v（Internal ログ・検証用） */
  intermediate: number
  /** 暫定の境界処理（U-18）を通ったか */
  usedProvisionalBoundary: boolean
}

/**
 * 表示オッズを 1 回抽選する。
 *
 * v >= 0 のとき「整数部 = B + Q, 小数部 = R」は dqbook の文言どおり（Likely）。
 * v < 0・剰余 0・和 <= 0 の実機の境界処理は未公開（Unknown, U-18）。暫定として
 * 小数 1 桁を整数で持つ odds10 = 10B + v を採り、下限 1.0 に丸める。v < 0 で
 * 10B + v を使うのは数学的に自然な解釈だからで、実機が別の扱いをする可能性は残る。
 */
export function rollOdds(base: number, rng: RandomSource): OddsRoll {
  const k = oddsSpread(base)
  const v = randInclusive(rng, 0, 2 * k) - k
  let odds10 = 10 * base + v
  let usedProvisionalBoundary = v < 0
  if (odds10 < 10) {
    odds10 = 10
    usedProvisionalBoundary = true
  }
  return {
    odds: { integer: Math.floor(odds10 / 10), tenths: odds10 % 10 },
    intermediate: v,
    usedProvisionalBoundary,
  }
}

/** 小数 1 桁を整数化した値（配当計算を浮動小数に通さないため） */
export function oddsTimesTen(odds: Odds): number {
  return odds.integer * 10 + odds.tenths
}

export function oddsToNumber(odds: Odds): number {
  return oddsTimesTen(odds) / 10
}

export function formatOdds(odds: Odds): string {
  return `${odds.integer}.${odds.tenths}`
}
