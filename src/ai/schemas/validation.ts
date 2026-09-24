/**
 * 外部応答の検証失敗。
 *
 * なぜ zod ではなく手書きか: 検証対象が Jev の `/v1/evaluate` 応答の数フィールドだけで、
 * 依存追加（静的サイトのバンドル増）に見合わない。失敗箇所を JSON パスで示せば十分に追える。
 */
export class SchemaError extends Error {
  constructor(path: string, message: string) {
    super(`Jev 応答の形式が想定と違います (${path}): ${message}`)
    this.name = 'SchemaError'
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
