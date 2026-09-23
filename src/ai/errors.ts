/**
 * AI Gateway / Jev 呼び出しの失敗を「原因別」に表すエラー。
 *
 * なぜ分類するか: Jev は公開直後で 503 が通常運用でも頻発し、まとまると 429 が混ざる。
 * UI・自動プレイが「待てば直る失敗」と「キーや入力を直さないと直らない失敗」を
 * 区別できないと、無意味な再試行でレート制限を悪化させたり、逆に一時障害で止まったりする。
 */
import type { AgentExchange } from './BettingAgent'

export type AiFailureKind =
  /** 429。Gateway 側のレート制限。Retry-After（≈50 秒）を守る */
  | 'rate_limit'
  /** 529。上流推論基盤の過負荷 */
  | 'overloaded'
  /** 500/502/503 など上流・Gateway の一時障害 */
  | 'server'
  /** 1 試行あたりのタイムアウト（利用者による中断は含めない） */
  | 'timeout'
  /** 接続断・CORS 拒否など、HTTP 応答自体が得られない */
  | 'network'
  /** 4xx の入力不正、または 200 だがレスポンス形式が契約と違う。再試行しても直らない */
  | 'invalid'
  /** 401/403。キーが無効。再試行しない */
  | 'auth'

/** 待てば回復しうる種別。invalid/auth は同じリクエストを繰り返しても結果が変わらない */
export const RETRYABLE_KINDS: ReadonlySet<AiFailureKind> = new Set<AiFailureKind>([
  'rate_limit',
  'overloaded',
  'server',
  'timeout',
  'network',
])

const KIND_MESSAGES: Record<AiFailureKind, string> = {
  // 5xx・429 は Jev の混雑（利用集中）が主因。キーや設定の問題と誤解させない文言にする
  rate_limit: 'Jev へのリクエストが集中しています（レート制限）。しばらく待って再試行してください',
  overloaded: 'Jev が混雑しています（過負荷）。しばらく待って再試行してください',
  server: 'Jev が混雑しているか一時的に応答できません。しばらく待って再試行してください',
  timeout: 'Jev の応答がタイムアウトしました（混雑の可能性）。しばらく待って再試行してください',
  network: 'AI Gateway に接続できませんでした（ネットワークまたは CORS）',
  invalid: 'Jev へのリクエストまたは応答が不正です',
  auth: 'API キーが無効か、権限がありません。Settings でキーを確認してください',
}

export interface AiGatewayErrorInit {
  kind: AiFailureKind
  status: number | null
  attempts: number
  elapsedMs: number
  /** 上流の短い説明（キー文字列は除去済みであること） */
  detail?: string
  retryAfterMs?: number | null
  generationId?: string | null
  exchange?: AgentExchange
}

export class AiGatewayError extends Error {
  /** 失敗した最後の試行のやり取り（画面で「何が返ってきたか」を見せるため。キーは含まない） */
  readonly exchange: AgentExchange | undefined
  readonly kind: AiFailureKind
  readonly status: number | null
  readonly attempts: number
  readonly elapsedMs: number
  readonly detail: string | undefined
  /** 429 のとき、次に試してよいまでの待ち時間。自動プレイの待機に使う */
  readonly retryAfterMs: number | null
  readonly generationId: string | null

  constructor(init: AiGatewayErrorInit) {
    const statusPart = init.status === null ? '' : ` (HTTP ${init.status})`
    const detailPart = init.detail ? `: ${init.detail}` : ''
    super(`${KIND_MESSAGES[init.kind]}${statusPart}${detailPart}`)
    this.name = 'AiGatewayError'
    this.kind = init.kind
    this.status = init.status
    this.attempts = init.attempts
    this.elapsedMs = init.elapsedMs
    this.detail = init.detail
    this.retryAfterMs = init.retryAfterMs ?? null
    this.generationId = init.generationId ?? null
    this.exchange = init.exchange
  }

  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind)
  }
}

export function isAiGatewayError(value: unknown): value is AiGatewayError {
  return value instanceof AiGatewayError
}

/** 利用者の中断を表す。fetch の AbortError と同じ name にして呼び出し側の判定を揃える */
export function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const err = new Error('中断されました')
  err.name = 'AbortError'
  return err
}

export function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError'
}

/**
 * 文字列からキーらしきものを除去する。
 *
 * なぜ必要か: 上流のエラー本文は基本的にキーを含まないが、プロキシやブラウザ拡張が
 * ヘッダを反射する可能性をゼロにできない。表示・ログに流す前に必ず通す。
 * 既知のキー値そのものに加え、Bearer トークン形式と Vercel キー接頭辞 `vck_` も伏せる。
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('[REDACTED]')
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bvck_[A-Za-z0-9_-]+/g, '[REDACTED]')
}
