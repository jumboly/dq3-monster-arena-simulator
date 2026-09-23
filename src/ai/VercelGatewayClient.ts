/**
 * Vercel AI Gateway の `/v1/evaluate`（Jev）をブラウザから直接呼ぶクライアント。
 *
 * 設計の要点:
 * - 本サイトは静的配信でバックエンドが無いので、キーは呼び出しごとに引数で受け取り保持しない。
 *   インスタンスがキーを持たなければ、誤ってシリアライズ・ログされる経路も減る。
 * - 失敗は AiGatewayError に分類する。再試行の可否を種別で決め、UI・自動プレイにも同じ種別を見せる。
 * - fetch / sleep / 乱数を注入できるようにし、実時間を使わずに再試行をテストする。
 * - エラー文言・meta にキーを絶対に入れない。Request/Headers オブジェクトは例外にもログにも載せない。
 */
import { AiGatewayError, RETRYABLE_KINDS, abortError, redactSecrets } from './errors'
import type { AiFailureKind } from './errors'
import { JEV_ENDPOINT, JEV_MODEL_ID } from './jevTypes'
import type { JevEvaluateRequest } from './jevTypes'
import type { AgentExchange } from './BettingAgent'
import { SchemaError } from './schemas/validation'
import { validateEvaluateEnvelope } from './schemas/evaluateResponse'
import type { EvaluateEnvelope } from './schemas/evaluateResponse'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface VercelGatewayClientOptions {
  fetch?: FetchLike
  endpoint?: string
  model?: string
  /** 試行回数の上限（初回を含む）。別プロジェクトの実測で 503 の連続を 6 回で抜けられた */
  maxAttempts?: number
  /** 試行 n 回目の失敗後の待ち（ms）。上流の不調は数百 ms で解けることがあるので短く刻む */
  backoffMs?: readonly number[]
  /** 1 試行のタイムアウト。Jev は通常 1 秒前後で返るので 30 秒は障害判定用 */
  timeoutMs?: number
  /**
   * Retry-After がこれより長ければ待たずに rate_limit で返す。
   * なぜ: 429 の Retry-After は約 50 秒で、クライアント内で 5 回待つと数分固まる。
   * 長い待機は AbortSignal と進捗表示を持つ呼び出し側（autoPlay）に任せる。
   */
  maxRetryAfterMs?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
  now?: () => number
  /** 試行ごとの観測（キーは含まない）。レイテンシ計測・デバッグ用 */
  onAttempt?: (info: AttemptInfo) => void
}

export interface AttemptInfo {
  attempt: number
  status: number | null
  kind: AiFailureKind | null
  latencyMs: number
  waitMs: number | null
  generationId: string | null
}

export interface EvaluateResult extends EvaluateEnvelope {
  attempts: number
  /** 再試行の待ちを含む全体の所要時間 */
  elapsedMs: number
  /** 成功した試行だけの往復時間 */
  latencyMs: number
  /** 保存・調査用の生応答（キーは含まれない：リクエストヘッダは載せていないため） */
  raw: unknown
  /** 実際のリクエストとレスポンス（表示用。Authorization は伏せ字） */
  exchange: AgentExchange
}

export interface EvaluateOptions {
  apiKey: string
  signal?: AbortSignal
}

const DEFAULTS = {
  maxAttempts: 6,
  backoffMs: [300, 700, 1500, 3000, 6000] as readonly number[],
  timeoutMs: 30_000,
  maxRetryAfterMs: 10_000,
}

const DETAIL_MAX = 200
/** JSON でない応答本文（HTML のエラーページ等）を表示用に残す上限 */
const RAW_TEXT_MAX = 4000

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function classifyStatus(status: number): AiFailureKind {
  if (status === 429) return 'rate_limit'
  if (status === 529) return 'overloaded'
  if (status === 401 || status === 403) return 'auth'
  if (status >= 500) return 'server'
  return 'invalid'
}

/** Retry-After は秒数か HTTP-date。読めないときは null（指数バックオフに戻る） */
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

function upstreamDetail(parsed: unknown, text: string): string {
  // Gateway のエラー本文は { error: { type, message } }。type だけでも原因の切り分けに足りる
  const err = (parsed as { error?: { type?: unknown; message?: unknown } } | null)?.error
  if (err && (typeof err.type === 'string' || typeof err.message === 'string')) {
    return [err.type, err.message].filter((v) => typeof v === 'string').join(': ')
  }
  return text
}

function truncate(text: string): string {
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text
}

function generationIdOf(parsed: unknown): string | null {
  const g = (parsed as { providerMetadata?: { gateway?: { generationId?: unknown } } } | null)?.providerMetadata
    ?.gateway?.generationId
  return typeof g === 'string' ? g : null
}

export class VercelGatewayClient {
  private readonly fetchImpl: FetchLike
  private readonly endpoint: string
  private readonly model: string
  private readonly maxAttempts: number
  private readonly backoffMs: readonly number[]
  private readonly timeoutMs: number
  private readonly maxRetryAfterMs: number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly random: () => number
  private readonly now: () => number
  private readonly onAttempt?: (info: AttemptInfo) => void

  constructor(options: VercelGatewayClientOptions = {}) {
    // globalThis.fetch をそのまま保持すると、ブラウザでは this 束縛が外れて Illegal invocation になる
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.endpoint = options.endpoint ?? JEV_ENDPOINT
    this.model = options.model ?? JEV_MODEL_ID
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULTS.maxAttempts)
    this.backoffMs = options.backoffMs ?? DEFAULTS.backoffMs
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULTS.maxRetryAfterMs
    this.sleep = options.sleep ?? defaultSleep
    this.random = options.random ?? Math.random
    this.now = options.now ?? (() => Date.now())
    this.onAttempt = options.onAttempt
  }

  get modelId(): string {
    return this.model
  }

  async evaluate(request: JevEvaluateRequest, { apiKey, signal }: EvaluateOptions): Promise<EvaluateResult> {
    if (!apiKey || !apiKey.trim()) {
      throw new AiGatewayError({ kind: 'auth', status: null, attempts: 0, elapsedMs: 0, detail: 'API キーが未設定です' })
    }
    const key = apiKey.trim()
    const body = JSON.stringify({ model: this.model, state: request.state, questions: request.questions })
    const startedAll = this.now()
    const redact = (s: string) => truncate(redactSecrets(s, [key]))
    // 表示用のやり取り。本文は送ったものそのまま（キーは本文に入らない）、ヘッダだけ伏せ字にする
    const exchangeOf = (status: number | null, parsed: unknown, text: string, attempt: number, latencyMs: number | null): AgentExchange => ({
      endpoint: this.endpoint,
      method: 'POST',
      requestHeaders: { Authorization: 'Bearer [REDACTED]', 'Content-Type': 'application/json' },
      requestBody: JSON.parse(body) as unknown,
      status,
      // 念のため応答にもキー文字列の伏せ字処理を通す（上流がエラー本文に入力を反射する場合に備える）
      responseBody: parsed !== null ? (JSON.parse(redactSecrets(JSON.stringify(parsed), [key])) as unknown) : redactSecrets(text, [key]).slice(0, RAW_TEXT_MAX),
      attempts: attempt,
      latencyMs,
      elapsedMs: this.now() - startedAll,
    })

    let last: AiGatewayError | null = null

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) throw abortError(signal)

      const started = this.now()
      let status: number | null = null
      let kind: AiFailureKind
      let detail = ''
      let retryAfterMs: number | null = null
      let parsed: unknown = null
      let text = ''

      // 利用者の中断とタイムアウトを区別するため、タイムアウト用の controller を別に持つ
      const timeoutController = new AbortController()
      const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs)
      const onUserAbort = () => timeoutController.abort()
      signal?.addEventListener('abort', onUserAbort, { once: true })

      try {
        const res = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body,
          signal: timeoutController.signal,
        })
        status = res.status
        text = await res.text()
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = null
        }

        if (res.ok) {
          try {
            const envelope = validateEvaluateEnvelope(parsed)
            const latencyMs = this.now() - started
            this.onAttempt?.({ attempt, status, kind: null, latencyMs, waitMs: null, generationId: envelope.generationId })
            return {
              ...envelope,
              attempts: attempt,
              elapsedMs: this.now() - startedAll,
              latencyMs,
              raw: parsed,
              exchange: exchangeOf(status, parsed, text, attempt, latencyMs),
            }
          } catch (e) {
            // 200 で形が違うのは契約の不一致。同じリクエストの再送では直らないので invalid で抜ける
            kind = 'invalid'
            detail = e instanceof SchemaError ? e.message : 'JSON として読めない応答'
          }
        } else {
          kind = classifyStatus(res.status)
          retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), this.now())
          detail = upstreamDetail(parsed, text)
        }
      } catch (e) {
        if (signal?.aborted) throw abortError(signal)
        if (timeoutController.signal.aborted) {
          kind = 'timeout'
          detail = `${this.timeoutMs}ms 以内に応答がありません`
        } else {
          kind = 'network'
          // TypeError: Failed to fetch 等。err 本体（Request を含みうる）ではなく name/message だけ使う
          detail = e instanceof Error ? `${e.name}: ${e.message}` : 'fetch に失敗しました'
        }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onUserAbort)
      }

      const generationId = generationIdOf(parsed)
      last = new AiGatewayError({
        kind,
        status,
        attempts: attempt,
        elapsedMs: this.now() - startedAll,
        detail: detail ? redact(detail) : undefined,
        retryAfterMs,
        generationId,
        exchange: exchangeOf(status, parsed, text || detail, attempt, null),
      })

      const retryable = RETRYABLE_KINDS.has(kind)
      const tooLongRetryAfter = retryAfterMs !== null && retryAfterMs > this.maxRetryAfterMs
      const willRetry = retryable && attempt < this.maxAttempts && !tooLongRetryAfter
      const waitMs = willRetry ? this.waitFor(attempt, retryAfterMs) : null
      this.onAttempt?.({ attempt, status, kind, latencyMs: this.now() - started, waitMs, generationId })

      if (!willRetry || waitMs === null) throw last
      await this.sleep(waitMs, signal)
    }

    // ループは必ず return か throw で抜ける。型検査のためだけに残す
    throw last ?? new AiGatewayError({ kind: 'server', status: null, attempts: this.maxAttempts, elapsedMs: 0 })
  }

  private waitFor(attempt: number, retryAfterMs: number | null): number {
    // Retry-After は上流の明示的な指示なのでジッタで早めない（早めると再び 429 になる）
    if (retryAfterMs !== null) return retryAfterMs
    const base = this.backoffMs[Math.min(attempt - 1, this.backoffMs.length - 1)] ?? 6000
    // ±30% のジッタ。複数タブ・並列呼び出しが同時に再試行して再び弾かれるのを避ける
    return Math.round(base * (0.7 + this.random() * 0.6))
  }
}
