/**
 * プロンプト版の一覧と現行版。エージェントは CURRENT_PROMPT を既定にし、版の切り替えを 1 箇所にする。
 * 旧版は Battle Log の promptVersion から結果を再現できるよう残す。
 */
import { promptV1 } from './jevBetting.v1'
import { promptV2 } from './jevBetting.v2'
import type { PromptSet } from './types'

export type { BuildOptions, ContestantLabel, PromptSet } from './types'
export { DRAW_OPTION, promptV1 } from './jevBetting.v1'
export { promptV2 } from './jevBetting.v2'

export const PROMPTS: Readonly<Record<string, PromptSet>> = {
  [promptV1.version]: promptV1,
  [promptV2.version]: promptV2,
}

/**
 * v2 を現行にする理由（docs/research/jev-probe.md）: 同名ケースで引き分けへの偏り（v1: 75〜85%）が
 * 51〜61% に下がり、同名以外のケースの分布はほぼ変わらなかった（差 0.01〜0.02）。
 * v2 は 1 番への位置バイアスを強めたが、エージェント側の symmetrize で打ち消す前提。
 */
export const CURRENT_PROMPT: PromptSet = promptV2
