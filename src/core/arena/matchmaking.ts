/**
 * マッチメイク（$C3EC84）: 主人公レベルに応じた試合カードの抽選。
 *
 * 出典: dqbook dq3_matchmake 配列 $C3ED78、docs/research/arena-spec.md §2.2。
 */
import type { RandomSource } from '../rng/RandomSource'

/**
 * レベル帯ごとの候補数。dqbook の表記は `#$00..#$26` 等だが、最上位帯の #$26 = 38 が
 * 試合数そのもので、閉区間だと存在しない 39 番目を引いてしまうため、半開区間
 * [0, limit) と解釈する（Likely, U-17）。
 */
const LEVEL_BANDS: ReadonlyArray<{ maxLevel: number; limit: number }> = [
  { maxLevel: 10, limit: 0x0a },
  { maxLevel: 15, limit: 0x13 },
  { maxLevel: 21, limit: 0x18 },
  { maxLevel: 29, limit: 0x21 },
  { maxLevel: 99, limit: 0x26 },
]

export function cardLimitForLevel(heroLevel: number): number {
  const band = LEVEL_BANDS.find((b) => heroLevel <= b.maxLevel)
  if (!band || heroLevel < 1) throw new RangeError(`主人公レベルは 1..99: ${heroLevel}`)
  return band.limit
}

/** 候補内は一様に抽選する（重みの記述が資料にないため。Likely）。戻り値は試合カードの添字 */
export function pickCard(heroLevel: number, rng: RandomSource): number {
  return rng.nextInt(cardLimitForLevel(heroLevel))
}
