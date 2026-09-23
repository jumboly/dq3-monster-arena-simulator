/**
 * Jev 賭け判断プロンプト v2。
 *
 * v1 からの変更（根拠: docs/research/jev-probe.md「同名モンスター」）:
 * - v1 の「同じ名前の選手は番号だけが区別で、能力・行動は同じ」という規則文は、アルミラージ×4 で
 *   引き分けに 75〜85% を寄せる結果になった。「同じ＝決着しない」と読まれたと考え、
 *   「同名でも別個体として互いに戦い、どれか 1 体が勝ち残りうる」と書き換える。
 *
 * buildState は v1 を共有せず複製している。版ごとの出力を凍結し、v1 の結果の再現性を保つため。
 * 選択肢名（contestantLabels）と質問文は v1 と同一なので流用する。
 */
import type { MatchObservation } from '../BettingAgent'
import { DRAW_OPTION, buildWinnerQuestion, contestantLabels } from './jevBetting.v1'
import type { BuildOptions, ContestantLabel, PromptSet } from './types'

export const PROMPT_VERSION_V2 = 'jev-bet/v2'

const TASK = 'ドラゴンクエストIII（SFC 版）のモンスター格闘場の 1 試合について、どの選手が最後まで勝ち残るかを予想する。'

const RULES = [
  '出場するモンスター同士が全員敵どうしで戦い、最後の 1 体になるまで戦闘が続く。人間は戦闘に関与しない。',
  '各選手は「番号 + 名前」で表記する。',
  '同じ名前の選手も別々の個体で、互いに敵として戦う。能力が同じでも、戦闘の運によってそのうちのどれか 1 体が勝ち残りうる。',
  // 引き分けの発生条件の詳細は Battle Core 側で確定していないため、断定しない書き方にしている
  '勝ち残る選手が決まらないまま試合が終わった場合は引き分けになる。',
]

const ODDS_NOTE =
  'odds は的中したときの払い戻し倍率で、格闘場が付けた人気の目安である。倍率が高いことは、その選手が勝ちやすい理由にはならない。'

const CLASSIC_NOTE = '観客として窓口で見られる情報（名前とオッズ）だけが与えられている。'
const ANALYST_NOTE =
  '能力値・行動・AI 設定・耐性が与えられている。actions の replacedByAttack が true の行動は格闘場では使えず、通常攻撃に置き換わる。'

function buildState(observation: MatchObservation, labels: ContestantLabel[], options: BuildOptions): unknown {
  const analyst = observation.informationMode === 'analyst'
  const notes = [...RULES, analyst ? ANALYST_NOTE : CLASSIC_NOTE]
  if (options.includeOdds) notes.push(ODDS_NOTE)

  const contestants = observation.contestants.map((c, i) => {
    const entry: Record<string, unknown> = { label: labels[i].label, name: c.name }
    if (options.includeOdds) entry.odds = c.odds
    if (analyst) {
      if (c.stats) entry.stats = c.stats
      if (c.actions) entry.actions = c.actions
      if (c.ai) entry.ai = c.ai
      if (c.traits && c.traits.length > 0) entry.traits = c.traits
      if (c.resistances && Object.keys(c.resistances).length > 0) entry.resistances = c.resistances
    }
    return entry
  })

  return { task: TASK, informationMode: observation.informationMode, notes, contestants }
}

export const promptV2: PromptSet = {
  version: PROMPT_VERSION_V2,
  drawOption: DRAW_OPTION,
  contestantLabels,
  buildState,
  buildWinnerQuestion,
}
