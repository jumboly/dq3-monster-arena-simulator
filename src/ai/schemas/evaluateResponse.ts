/**
 * `/v1/evaluate` 応答の検証。
 *
 * 実測（docs/research/jev-probe.md）で確認した形:
 * ```
 * {
 *   model: "typesafe-ai/jev",
 *   answers: { <key>: { type: "choice", choice: "<選択肢名>", probabilities: { <選択肢名>: 0..1 }, confidence: 0..1 } },
 *   usage: { inputTokens, outputTokens },
 *   providerMetadata: { typesafe: { confidence: { <key>: 0..1 } }, gateway: { generationId, routing } }
 * }
 * ```
 * probabilities は小数 2 桁に丸められて返る。実測 25 回では合計はすべて 1.00 だったが、丸めで 0.99〜1.01 になりうる。
 */
import { SchemaError, isFiniteNumber, isRecord } from './validation'

export interface EvaluateEnvelope {
  model: string | null
  answers: Record<string, unknown>
  inputTokens: number | null
  outputTokens: number | null
  generationId: string | null
  /** providerMetadata.typesafe.confidence（質問キー → 確信度） */
  confidenceByKey: Record<string, number>
}

export function validateEvaluateEnvelope(body: unknown): EvaluateEnvelope {
  if (!isRecord(body)) throw new SchemaError('$', 'オブジェクトではありません')
  const answers = body.answers
  if (!isRecord(answers)) throw new SchemaError('$.answers', 'answers がありません')

  const usage = isRecord(body.usage) ? body.usage : {}
  const pm = isRecord(body.providerMetadata) ? body.providerMetadata : {}
  const gateway = isRecord(pm.gateway) ? pm.gateway : {}
  const typesafe = isRecord(pm.typesafe) ? pm.typesafe : {}
  const confidenceByKey: Record<string, number> = {}
  if (isRecord(typesafe.confidence)) {
    for (const [k, v] of Object.entries(typesafe.confidence)) {
      if (isFiniteNumber(v)) confidenceByKey[k] = v
    }
  }

  return {
    model: typeof body.model === 'string' ? body.model : null,
    answers,
    inputTokens: isFiniteNumber(usage.inputTokens) ? usage.inputTokens : null,
    outputTokens: isFiniteNumber(usage.outputTokens) ? usage.outputTokens : null,
    generationId: typeof gateway.generationId === 'string' ? gateway.generationId : null,
    confidenceByKey,
  }
}

export interface ChoiceAnswer {
  /** Jev が選んだ選択肢名（probabilities の最大と一致するとは限らないので参考扱い） */
  choice: string | null
  /** 正規化後の分布。expectedOptions の全キーを必ず含む */
  probabilities: Record<string, number>
  /** 正規化前の合計 */
  rawSum: number
  /** 合計が 1 から外れていたため正規化したか */
  normalized: boolean
  /** 応答に無く 0 で補った選択肢 */
  missingOptions: string[]
  confidence: number | null
}

/** 丸め（2 桁）の誤差はここまで許して「正規化した」とだけ記録する。越えたら不正とみなす */
const MAX_SUM_DEVIATION = 0.2
/** 浮動小数の誤差で毎回「正規化した」と記録しないための閾値 */
const NORMALIZE_EPSILON = 1e-9

export function validateChoiceAnswer(
  answer: unknown,
  expectedOptions: readonly string[],
  path = '$.answers',
  fallbackConfidence: number | null = null,
): ChoiceAnswer {
  if (!isRecord(answer)) throw new SchemaError(path, '回答がありません')
  if (answer.type !== undefined && answer.type !== 'choice') {
    throw new SchemaError(`${path}.type`, `choice ではなく ${String(answer.type)} が返りました`)
  }
  const probs = answer.probabilities
  if (!isRecord(probs)) throw new SchemaError(`${path}.probabilities`, '確率分布がありません')

  const expected = new Set(expectedOptions)
  const raw: Record<string, number> = {}
  for (const [name, value] of Object.entries(probs)) {
    // 知らない選択肢が混ざる = 選択肢名の写像が壊れている。黙って捨てると id がずれるので不正扱い
    if (!expected.has(name)) throw new SchemaError(`${path}.probabilities`, `未知の選択肢「${name}」`)
    if (!isFiniteNumber(value) || value < 0 || value > 1) {
      throw new SchemaError(`${path}.probabilities["${name}"]`, `0〜1 の数値ではありません`)
    }
    raw[name] = value
  }

  const missingOptions = expectedOptions.filter((o) => !(o in raw))
  for (const o of missingOptions) raw[o] = 0

  const rawSum = expectedOptions.reduce((s, o) => s + raw[o], 0)
  if (rawSum <= 0) throw new SchemaError(`${path}.probabilities`, '確率の合計が 0 です')
  if (Math.abs(rawSum - 1) > MAX_SUM_DEVIATION) {
    throw new SchemaError(`${path}.probabilities`, `確率の合計 ${rawSum.toFixed(3)} が 1 から大きく外れています`)
  }

  const normalized = Math.abs(rawSum - 1) > NORMALIZE_EPSILON
  const probabilities: Record<string, number> = {}
  for (const o of expectedOptions) probabilities[o] = normalized ? raw[o] / rawSum : raw[o]

  const choice = typeof answer.choice === 'string' && expected.has(answer.choice) ? answer.choice : null
  const confidence = isFiniteNumber(answer.confidence) ? answer.confidence : fallbackConfidence

  return { choice, probabilities, rawSum, normalized, missingOptions, confidence }
}

/**
 * 分布を部分集合に制限して再正規化する（例: 引き分けを除いた勝率）。
 * 部分集合の合計が 0 なら一様分布にする。賭け先は必ず決めなければならないため。
 */
export function restrictAndNormalize(
  probabilities: Record<string, number>,
  keys: readonly string[],
): Record<string, number> {
  const sum = keys.reduce((s, k) => s + (probabilities[k] ?? 0), 0)
  const out: Record<string, number> = {}
  for (const k of keys) out[k] = sum > 0 ? (probabilities[k] ?? 0) / sum : 1 / keys.length
  return out
}
