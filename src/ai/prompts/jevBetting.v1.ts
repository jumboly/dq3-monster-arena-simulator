/**
 * Jev 賭け判断プロンプト v1。
 *
 * なぜコードから分離しバージョンを付けるか: Jev の出力は state の書き方・instructions・criteria の
 * 文言で分布が変わる。Battle Log / export に promptVersion を残せば、成績の比較がどの文言での
 * 結果かを後から追える。文言を変えるときは v2 ファイルを作り、v1 は消さずに残す。
 *
 * 文言の設計判断（docs/research/jev-probe.md も参照）:
 * - 選択肢名は id（monster-a）ではなく「1番 スライム」。Jev は選択肢名の意味を読んで判断するため、
 *   意味の無い id だと state 内の選手と結び付かない。番号は同名モンスター（アルミラージ×4 等）の区別子。
 * - state の各選手にも同じ label を持たせ、選択肢と state の対応を文字列一致で取れるようにする。
 * - 賭け金・主人公レベルは勝敗に無関係なので渡さない。無関係な数値は判断を揺らすだけ。
 * - 「配当の高さは勝ちやすさの理由にならない」と明記する。高オッズ＝当たれば得、を勝率と混同させないため。
 */
import type { MatchObservation } from '../BettingAgent'
import type { JevChoiceQuestion } from '../jevTypes'
import type { BuildOptions, ContestantLabel, PromptSet } from './types'

export const PROMPT_VERSION = 'jev-bet/v1'

/** 引き分け選択肢の名前。選手 label（「n番 …」）と衝突しない語にする */
export const DRAW_OPTION = '引き分け（勝ち残りなし）'

/**
 * 選手ごとの選択肢名。番号は出場枠順（1 始まり）で、名前が重複しなくても常に付ける。
 * なぜ常に付けるか: 同名のときだけ付けると表記が試合ごとに変わり、Jev の解釈が揺れる。
 */
export function contestantLabels(observation: MatchObservation): ContestantLabel[] {
  const labels = observation.contestants.map((c, i) => ({ id: c.id, label: `${i + 1}番 ${c.name}` }))
  // 名前に「番」を含む等で万一衝突したら、判断を id に戻せなくなるので早期に失敗させる
  if (new Set(labels.map((l) => l.label)).size !== labels.length) {
    throw new Error('選択肢名が重複しました（出場者の表記を確認してください）')
  }
  return labels
}

const TASK = 'ドラゴンクエストIII（SFC 版）のモンスター格闘場の 1 試合について、どの選手が最後まで勝ち残るかを予想する。'

const RULES = [
  '出場するモンスター同士が全員敵どうしで戦い、最後の 1 体になるまで戦闘が続く。人間は戦闘に関与しない。',
  '各選手は「番号 + 名前」で表記する。同じ名前の選手が複数いる場合、番号だけが区別で、能力・行動は同じである。',
  // 引き分けの発生条件の詳細は Battle Core 側で確定していないため、断定しない書き方にしている
  '勝ち残る選手が決まらないまま試合が終わった場合は引き分けになる。',
]

const ODDS_NOTE =
  'odds は的中したときの払い戻し倍率で、格闘場が付けた人気の目安である。倍率が高いことは、その選手が勝ちやすい理由にはならない。'

const CLASSIC_NOTE = '観客として窓口で見られる情報（名前とオッズ）だけが与えられている。'
const ANALYST_NOTE =
  '能力値・行動・AI 設定・耐性が与えられている。actions の forbiddenInArena が true の行動は格闘場では選ばれない（残りの行動から選び直す。すべて使えないときだけ通常攻撃）。'

export function buildState(observation: MatchObservation, labels: ContestantLabel[], options: BuildOptions): unknown {
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

export function buildWinnerQuestion(labels: ContestantLabel[], options: BuildOptions): JevChoiceQuestion {
  const criteria: Record<string, string> = {}
  for (const { label } of labels) criteria[label] = `${label} が最後まで勝ち残る。`
  if (options.includeDraw) criteria[DRAW_OPTION] = '勝ち残る選手が決まらないまま試合が終わる。'
  return {
    type: 'choice',
    instructions:
      'この試合で最後まで勝ち残るのはどの選手か。各選手の強さと戦い方から、実際に勝ち残る可能性が最も高いものを選ぶ。払い戻し倍率の高さは考慮しない。',
    criteria,
  }
}

export const promptV1: PromptSet = {
  version: PROMPT_VERSION,
  drawOption: DRAW_OPTION,
  contestantLabels,
  buildState,
  buildWinnerQuestion,
}
