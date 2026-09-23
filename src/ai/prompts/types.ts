/**
 * プロンプト版の差し替え口。
 * エージェントは PromptSet だけに依存し、版の比較（プローブ・A/B）を設定で切り替えられるようにする。
 */
import type { MatchObservation } from '../BettingAgent'
import type { JevChoiceQuestion } from '../jevTypes'

export interface ContestantLabel {
  id: string
  label: string
}

export interface BuildOptions {
  includeOdds: boolean
  includeDraw: boolean
}

export interface PromptSet {
  version: string
  /** 引き分け選択肢の名前（includeDraw のときだけ使う） */
  drawOption: string
  contestantLabels(observation: MatchObservation): ContestantLabel[]
  buildState(observation: MatchObservation, labels: ContestantLabel[], options: BuildOptions): unknown
  buildWinnerQuestion(labels: ContestantLabel[], options: BuildOptions): JevChoiceQuestion
}
