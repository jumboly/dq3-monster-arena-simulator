/**
 * Jev（typesafe-ai/jev）`/v1/evaluate` のリクエスト型。
 *
 * レスポンス側は信用できない外部入力なので型ではなく `schemas/` のバリデータで扱う。
 */

export interface JevBooleanQuestion {
  type: 'boolean'
  instructions: string
  criteria?: { true: string; false: string }
}

export interface JevScoreQuestion {
  type: 'score'
  instructions: string
  /** 低い順のレベル文言 */
  criteria: string[]
}

export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string
  /** { 選択肢名: 説明 }。選択肢名がそのまま probabilities のキーになる */
  criteria: Record<string, string>
}

export type JevQuestion = JevBooleanQuestion | JevScoreQuestion | JevChoiceQuestion

export interface JevEvaluateRequest {
  state: unknown
  /** キーはモデルに渡らない（応答の対応付けにだけ使われる） */
  questions: Record<string, JevQuestion>
}

export const JEV_MODEL_ID = 'typesafe-ai/jev'
export const JEV_ENDPOINT = 'https://ai-gateway.vercel.sh/v1/evaluate'
