/**
 * Jev（typesafe-ai/jev）を使う BettingAgent。
 *
 * Jev は文章を生成せず、choice 質問に対して確率分布を返す評価モデル。
 * よって BetDecision.reason は Jev の出力（確率・確信度）から機械的に組み立て、
 * その旨を文中に明示する（Jev が理由を語ったように見せないため）。
 */
import type { BetDecision, BettingAgent, MatchObservation } from './BettingAgent'
import { VercelGatewayClient } from './VercelGatewayClient'
import type { EvaluateResult } from './VercelGatewayClient'
import { AiGatewayError } from './errors'
import { CURRENT_PROMPT } from './prompts'
import type { ContestantLabel, PromptSet } from './prompts'
import { restrictAndNormalize, validateChoiceAnswer } from './schemas/evaluateResponse'
import type { ChoiceAnswer } from './schemas/evaluateResponse'
import { assertBetDecision } from './schemas/betDecision'
import { SchemaError } from './schemas/validation'

/**
 * - expected_value: 勝率 × オッズ（期待払い戻し倍率）が最大の選手。長期の所持金を増やす目的に合う
 * - max_probability: 勝率が最大の選手。的中率を見せたいとき・Jev の予想精度そのものを測るとき向け
 */
export type BetStrategy = 'expected_value' | 'max_probability'

export interface JevBettingAgentOptions {
  /** 呼び出し時点のキーを返す。エージェントにキーを保持させないため関数で受ける */
  getApiKey: () => string | null
  client?: VercelGatewayClient
  strategy?: BetStrategy
  /**
   * 引き分けを選択肢に含めるか（既定 true）。
   * 含める理由: 選手しか選べないと、引き分けを予想した場合の確率質量が選手に押し付けられて
   * 分布が歪む。引き分けの払い戻しは誰に賭けても同じなので、選手間の比較（賭け先の決定）には影響しない。
   * BetDecision.probabilities は契約どおり引き分けを除いて再正規化し、引き分け確率は meta に残す。
   */
  includeDraw?: boolean
  /** state にオッズを入れるか（既定 true）。オッズに引きずられるかの比較実験用に切れるようにする */
  includeOdds?: boolean
  /** 応答の形式不正を何回まで取り直すか。Jev は確率的なので 1 回の取り直しで直ることがある */
  schemaRetries?: number
  /** プロンプト版（既定は CURRENT_PROMPT）。版の比較実験用 */
  prompt?: PromptSet
  /**
   * 観測上まったく同じ選手（同名・同オッズ・同能力）の勝率を平均する（既定 true）。
   * なぜ: 実測でアルミラージ×4 に対し Jev は 1 番に 12〜22%、2〜4 番に各 1% を付けた（位置バイアス）。
   * 観測が同一なら勝率も同一であるべきで、偏ったまま期待値を取ると番号だけで賭け先が決まってしまう。
   */
  symmetrizeIdentical?: boolean
}

/** 質問キー。モデルには渡らないので短い固定値で良い */
const QUESTION_KEY = 'winner'

export class JevBettingAgent implements BettingAgent {
  readonly id = 'jev'
  readonly label = 'Jev (typesafe-ai/jev)'

  private readonly getApiKey: () => string | null
  private readonly client: VercelGatewayClient
  private readonly strategy: BetStrategy
  private readonly includeDraw: boolean
  private readonly includeOdds: boolean
  private readonly schemaRetries: number
  private readonly prompt: PromptSet
  private readonly symmetrizeIdentical: boolean

  constructor(options: JevBettingAgentOptions) {
    this.getApiKey = options.getApiKey
    this.client = options.client ?? new VercelGatewayClient()
    this.strategy = options.strategy ?? 'expected_value'
    this.includeDraw = options.includeDraw ?? true
    this.includeOdds = options.includeOdds ?? true
    this.schemaRetries = Math.max(0, options.schemaRetries ?? 1)
    this.prompt = options.prompt ?? CURRENT_PROMPT
    this.symmetrizeIdentical = options.symmetrizeIdentical ?? true
  }

  async decide(observation: MatchObservation, signal?: AbortSignal): Promise<BetDecision> {
    if (observation.contestants.length === 0) throw new Error('出場者がいません')
    const apiKey = this.getApiKey()
    if (!apiKey) {
      throw new AiGatewayError({ kind: 'auth', status: null, attempts: 0, elapsedMs: 0, detail: 'API キーが未設定です' })
    }

    const buildOptions = { includeDraw: this.includeDraw, includeOdds: this.includeOdds }
    const labels = this.prompt.contestantLabels(observation)
    const state = this.prompt.buildState(observation, labels, buildOptions)
    const question = this.prompt.buildWinnerQuestion(labels, buildOptions)
    const options = Object.keys(question.criteria)

    let result: EvaluateResult | null = null
    let answer: ChoiceAnswer | null = null
    let totalAttempts = 0
    let totalElapsed = 0
    let schemaFailures = 0

    for (let i = 0; i <= this.schemaRetries; i++) {
      // 通信系の失敗（AiGatewayError / AbortError）はクライアント側で再試行済みなのでそのまま投げる
      result = await this.client.evaluate({ state, questions: { [QUESTION_KEY]: question } }, { apiKey, signal })
      totalAttempts += result.attempts
      totalElapsed += result.elapsedMs
      try {
        answer = validateChoiceAnswer(
          result.answers[QUESTION_KEY],
          options,
          `$.answers.${QUESTION_KEY}`,
          result.confidenceByKey[QUESTION_KEY] ?? null,
        )
        break
      } catch (e) {
        if (!(e instanceof SchemaError)) throw e
        schemaFailures++
        if (i === this.schemaRetries) {
          throw new AiGatewayError({
            kind: 'invalid',
            status: 200,
            attempts: totalAttempts,
            elapsedMs: totalElapsed,
            detail: e.message,
            generationId: result.generationId,
            // 形が想定と違った応答そのものを見られるようにする
            exchange: result.exchange,
          })
        }
      }
    }
    // ループは answer を得て break するか throw する
    if (!result || !answer) throw new Error('unreachable')

    const decision = this.toDecision(observation, labels, answer)
    decision.meta = {
      ...decision.meta,
      model: result.model ?? this.client.modelId,
      promptVersion: this.prompt.version,
      informationMode: observation.informationMode,
      attempts: totalAttempts,
      schemaFailures,
      latencyMs: Math.round(result.latencyMs),
      elapsedMs: Math.round(totalElapsed),
      ...(result.inputTokens !== null ? { inputTokens: result.inputTokens } : {}),
      ...(result.generationId ? { generationId: result.generationId } : {}),
    }
    assertBetDecision(decision, observation)
    // 検証後に付ける。exchange は表示用で、賭け判断の整合チェックの対象ではないため
    decision.exchange = result.exchange
    return decision
  }

  /** Jev の分布から賭け先を決める。副作用なしなのでテストから直接呼べるよう公開する */
  toDecision(
    observation: MatchObservation,
    labels: ContestantLabel[],
    answer: ChoiceAnswer,
  ): BetDecision {
    const DRAW_OPTION = this.prompt.drawOption
    const ids = labels.map((l) => l.id)
    // 選択肢名 → id の写像。label は contestantLabels で一意性を保証済み
    const jevWin = labels.map((l) => answer.probabilities[l.label] ?? 0)
    const drawProbability = this.includeDraw ? (answer.probabilities[DRAW_OPTION] ?? 0) : 0
    const sym = this.symmetrizeIdentical ? symmetrize(observation, jevWin) : { values: jevWin, groups: 0, gap: 0 }
    const winByLabel = sym.values

    const byId: Record<string, number> = {}
    labels.forEach((l, i) => (byId[l.id] = winByLabel[i]))
    // 契約: probabilities は引き分けを含めない
    const probabilities = restrictAndNormalize(byId, ids)

    const odds = observation.contestants.map((c) => c.odds)
    // 期待払い戻し倍率は無条件の勝率（引き分け込みの分布での値）で計算する。
    // 再正規化後の値を使うと引き分けの分だけ期待値を過大に見せてしまう
    const ev = winByLabel.map((p, i) => p * odds[i])
    const score = this.strategy === 'expected_value' ? ev : winByLabel
    let best = 0
    for (let i = 1; i < ids.length; i++) {
      // 同点は勝率の高い方、それも同じなら若い番号。決定的にして再現性を保つ
      if (score[i] > score[best] || (score[i] === score[best] && winByLabel[i] > winByLabel[best])) best = i
    }

    const jevChoiceId = answer.choice ? labels.find((l) => l.label === answer.choice)?.id : undefined
    const reason = buildReason({
      labels,
      winByLabel,
      odds,
      ev,
      best,
      drawProbability,
      includeDraw: this.includeDraw,
      confidence: answer.confidence,
      strategy: this.strategy,
      normalized: answer.normalized,
      symmetrized: sym.groups > 0,
    })

    return {
      bet: ids[best],
      probabilities,
      reason,
      meta: {
        strategy: this.strategy,
        expectedValue: round(ev[best], 3),
        ...(this.includeDraw ? { drawProbability: round(drawProbability, 4) } : {}),
        ...(answer.confidence !== null ? { confidence: answer.confidence } : {}),
        jevChoice: answer.choice === DRAW_OPTION ? 'draw' : (jevChoiceId ?? 'unknown'),
        probabilitySum: round(answer.rawSum, 4),
        normalized: answer.normalized ? 'true' : 'false',
        ...(answer.missingOptions.length > 0 ? { missingOptions: answer.missingOptions.length } : {}),
        ...(sym.groups > 0 ? { symmetrizedGroups: sym.groups, symmetryGap: round(sym.gap, 4) } : {}),
      },
    }
  }
}

/**
 * 観測上区別できない選手どうしの勝率を平均する。区別子（番号）以外が同一なら交換可能とみなす。
 * gap は平均前のグループ内の最大差で、Jev の位置バイアスの大きさの記録に使う。
 */
export function symmetrize(
  observation: MatchObservation,
  win: number[],
): { values: number[]; groups: number; gap: number } {
  const groups = new Map<string, number[]>()
  observation.contestants.forEach((c, i) => {
    // id は区別子なので除く。残りのフィールドがすべて同じなら Jev にとっても同じ選手に見えている
    const { id: _id, ...rest } = c
    const fp = JSON.stringify(rest)
    groups.set(fp, [...(groups.get(fp) ?? []), i])
  })
  const values = [...win]
  let count = 0
  let gap = 0
  for (const idx of groups.values()) {
    if (idx.length < 2) continue
    count++
    const ps = idx.map((i) => win[i])
    gap = Math.max(gap, Math.max(...ps) - Math.min(...ps))
    const mean = ps.reduce((a, b) => a + b, 0) / ps.length
    for (const i of idx) values[i] = mean
  }
  return { values, groups: count, gap }
}

function round(n: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`
}

interface ReasonInput {
  labels: ContestantLabel[]
  winByLabel: number[]
  odds: number[]
  ev: number[]
  best: number
  drawProbability: number
  includeDraw: boolean
  confidence: number | null
  strategy: BetStrategy
  normalized: boolean
  symmetrized: boolean
}

function buildReason(r: ReasonInput): string {
  const dist = r.labels.map((l, i) => `${l.label} ${pct(r.winByLabel[i])}`).join(' / ')
  const drawPart = r.includeDraw ? ` / 引き分け ${pct(r.drawProbability)}` : ''
  const target = r.labels[r.best].label
  const basis =
    r.strategy === 'expected_value'
      ? `期待払い戻し倍率（勝率×オッズ）が最大の ${target}（${pct(r.winByLabel[r.best])} × ${r.odds[r.best]} = ${r.ev[r.best].toFixed(2)}）に賭ける。`
      : `推定勝率が最大の ${target}（${pct(r.winByLabel[r.best])}）に賭ける。`
  const conf = r.confidence !== null ? `確信度 ${r.confidence.toFixed(2)}。` : ''
  const norm = r.normalized ? '確率は合計 1 に正規化済み。' : ''
  const sym = r.symmetrized ? '同一の選手どうしの勝率は平均済み。' : ''
  return `Jev 推定勝率: ${dist}${drawPart}。${conf}${basis}${norm}${sym}※Jev は理由文を生成しないため、この説明は Jev の確率出力から機械的に組み立てたもの。`
}
