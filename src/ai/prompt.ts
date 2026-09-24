/**
 * Jev 賭け判断プロンプト。
 *
 * なぜコードから分離しバージョンを付けるか: Jev の出力は state の書き方・instructions・criteria の
 * 文言で分布が変わる。Battle Log / export に PROMPT_VERSION を残せば、成績の比較がどの文言での
 * 結果かを後から追える。文言を変えたら PROMPT_VERSION を上げる（旧文言は git 履歴に残る）。
 *
 * 文言の設計判断（docs/research/jev-probe.md も参照）:
 * - 選択肢名は id（monster-a）ではなく「1番 スライム」。Jev は選択肢名の意味を読んで判断するため、
 *   意味の無い id だと state 内の選手と結び付かない。番号は同名モンスター（アルミラージ×4 等）の区別子。
 * - state の各選手にも同じ label を持たせ、選択肢と state の対応を文字列一致で取れるようにする。
 * - 賭け金・主人公レベルは勝敗に無関係なので渡さない。無関係な数値は判断を揺らすだけ。
 * - 「配当の高さは勝ちやすさの理由にならない」と明記する。高オッズ＝当たれば得、を勝率と混同させないため。
 * - 同名の選手を「別個体として互いに戦う」と書く。v1 の「番号だけが区別で能力・行動は同じ」は
 *   アルミラージ×4 で引き分けに 75〜85% を寄せた（「同じ＝決着しない」と読まれた）ため v2 で改めた。
 * - 引き分けを選択肢に含める。選手しか選べないと、引き分けを予想した場合の確率質量が選手に
 *   押し付けられて分布が歪む。引き分けの払い戻しは誰に賭けても同じなので賭け先の比較には影響しない。
 */
import type { MatchObservation } from './BettingAgent'
import type { JevChoiceQuestion } from './jevTypes'

export const PROMPT_VERSION = 'jev-bet/v2'

/** 引き分け選択肢の名前。選手 label（「n番 …」）と衝突しない語にする */
export const DRAW_OPTION = '引き分け（勝ち残りなし）'

export interface ContestantLabel {
  id: string
  label: string
}

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
  '各選手は「番号 + 名前」で表記する。',
  '同じ名前の選手も別々の個体で、互いに敵として戦う。能力が同じでも、戦闘の運によってそのうちのどれか 1 体が勝ち残りうる。',
  // 引き分けの発生条件の詳細は Battle Core 側で確定していないため、断定しない書き方にしている
  '勝ち残る選手が決まらないまま試合が終わった場合は引き分けになる。',
]

const ODDS_NOTE =
  'odds は的中したときの払い戻し倍率で、格闘場が付けた人気の目安である。倍率が高いことは、その選手が勝ちやすい理由にはならない。'

const CLASSIC_NOTE = '観客として窓口で見られる情報（名前とオッズ）だけが与えられている。'
const ANALYST_NOTE =
  '能力値・行動・AI 設定・耐性が与えられている。actions の forbiddenInArena が true の行動は格闘場では選ばれない（残りの行動から選び直す。すべて使えないときだけ通常攻撃）。'

export function buildState(observation: MatchObservation, labels: ContestantLabel[]): unknown {
  const analyst = observation.informationMode === 'analyst'
  const notes = [...RULES, analyst ? ANALYST_NOTE : CLASSIC_NOTE, ODDS_NOTE]

  const contestants = observation.contestants.map((c, i) => {
    const entry: Record<string, unknown> = { label: labels[i].label, name: c.name, odds: c.odds }
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

export function buildWinnerQuestion(labels: ContestantLabel[]): JevChoiceQuestion {
  const criteria: Record<string, string> = {}
  for (const { label } of labels) criteria[label] = `${label} が最後まで勝ち残る。`
  criteria[DRAW_OPTION] = '勝ち残る選手が決まらないまま試合が終わる。'
  return {
    type: 'choice',
    instructions:
      'この試合で最後まで勝ち残るのはどの選手か。各選手の強さと戦い方から、実際に勝ち残る可能性が最も高いものを選ぶ。払い戻し倍率の高さは考慮しない。',
    criteria,
  }
}
