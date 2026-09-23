import { describe, expect, it, vi } from 'vitest'
import { VercelGatewayClient, parseRetryAfter } from '../../src/ai/VercelGatewayClient'
import { AiGatewayError, redactSecrets } from '../../src/ai/errors'
import { FAKE_KEY, choiceBody, mockFetch, noSleep } from './fixtures'

const request = { state: { a: 1 }, questions: { q: { type: 'boolean' as const, instructions: 'x' } } }
const ok = { status: 200, body: choiceBody({ A: 1 }) }
const unavailable = { status: 503, body: { error: { type: 'service_unavailable_error', message: 'Service temporarily unavailable.' } } }

function client(responses: Parameters<typeof mockFetch>[0], extra: ConstructorParameters<typeof VercelGatewayClient>[0] = {}) {
  const m = mockFetch(responses)
  const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => {})
  const c = new VercelGatewayClient({ fetch: m.fn, sleep, random: () => 0.5, ...extra })
  return { c, calls: m.calls, sleep }
}

async function catchError(p: Promise<unknown>): Promise<AiGatewayError> {
  try {
    await p
  } catch (e) {
    return e as AiGatewayError
  }
  throw new Error('例外が投げられなかった')
}

describe('VercelGatewayClient', () => {
  it('リクエスト形式: model / state / questions と Bearer ヘッダ', async () => {
    const { c, calls } = client([ok])
    const r = await c.evaluate(request, { apiKey: ` ${FAKE_KEY} ` })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://ai-gateway.vercel.sh/v1/evaluate')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ model: 'typesafe-ai/jev', ...request })
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(r.model).toBe('typesafe-ai/jev')
    expect(r.generationId).toBe('gen_TEST')
    expect(r.inputTokens).toBe(900)
    expect(r.attempts).toBe(1)
  })

  it('503 は再試行し、成功すれば attempts に回数が残る', async () => {
    const { c, calls, sleep } = client([unavailable, unavailable, ok])
    const r = await c.evaluate(request, { apiKey: FAKE_KEY })
    expect(calls).toHaveLength(3)
    expect(r.attempts).toBe(3)
    // random=0.5 → ジッタ係数 1.0 なので既定バックオフそのまま
    expect(sleep.mock.calls.map((a) => a[0])).toEqual([300, 700])
  })

  it('再試行を使い切ると最後の種別で失敗する（最大 6 回）', async () => {
    const { c, calls } = client([unavailable])
    const e = await catchError(c.evaluate(request, { apiKey: FAKE_KEY }))
    expect(e).toBeInstanceOf(AiGatewayError)
    expect(e.kind).toBe('server')
    expect(e.attempts).toBe(6)
    expect(calls).toHaveLength(6)
    expect(e.message).toContain('service_unavailable_error')
  })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [400, 'invalid'],
  ])('%i は再試行せず %s', async (status, kind) => {
    const { c, calls } = client([{ status, body: { error: { type: 'x' } } }])
    const e = await catchError(c.evaluate(request, { apiKey: FAKE_KEY }))
    expect(e.kind).toBe(kind)
    expect(e.retryable).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('529 は overloaded として再試行する', async () => {
    const { c, calls } = client([{ status: 529 }, ok])
    await c.evaluate(request, { apiKey: FAKE_KEY })
    expect(calls).toHaveLength(2)
  })

  it('429 は Retry-After を優先して待つ（短い場合）', async () => {
    const { c, sleep } = client([{ status: 429, headers: { 'retry-after': '2' } }, ok])
    await c.evaluate(request, { apiKey: FAKE_KEY })
    expect(sleep.mock.calls[0][0]).toBe(2000)
  })

  it('429 の Retry-After が長ければ待たずに rate_limit と待ち時間を返す', async () => {
    const { c, calls, sleep } = client([{ status: 429, headers: { 'retry-after': '50' } }, ok])
    const e = await catchError(c.evaluate(request, { apiKey: FAKE_KEY }))
    expect(e.kind).toBe('rate_limit')
    expect(e.retryAfterMs).toBe(50_000)
    expect(calls).toHaveLength(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('ネットワーク断は network として再試行する', async () => {
    const { c, calls } = client([{ status: 0, networkError: true }, ok])
    const r = await c.evaluate(request, { apiKey: FAKE_KEY })
    expect(r.attempts).toBe(2)
    expect(calls).toHaveLength(2)
  })

  it('タイムアウトは timeout に分類する', async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    const c = new VercelGatewayClient({ fetch: hang, timeoutMs: 5, maxAttempts: 2, sleep: noSleep })
    const e = await catchError(c.evaluate(request, { apiKey: FAKE_KEY }))
    expect(e.kind).toBe('timeout')
    expect(e.attempts).toBe(2)
  })

  it('利用者の中断は AbortError で、再試行しない', async () => {
    const controller = new AbortController()
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        controller.abort()
      })
    const c = new VercelGatewayClient({ fetch: hang, sleep: noSleep })
    const e = await catchError(c.evaluate(request, { apiKey: FAKE_KEY, signal: controller.signal }))
    expect(e.name).toBe('AbortError')
    expect(e).not.toBeInstanceOf(AiGatewayError)
  })

  it('200 でも answers が無ければ invalid（再試行しない）', async () => {
    const { c, calls } = client([{ status: 200, body: { foo: 1 } }])
    const e = await catchError(c.evaluate(request, { apiKey: FAKE_KEY }))
    expect(e.kind).toBe('invalid')
    expect(calls).toHaveLength(1)
  })

  it('キー未設定は通信せず auth', async () => {
    const { c, calls } = client([ok])
    const e = await catchError(c.evaluate(request, { apiKey: '  ' }))
    expect(e.kind).toBe('auth')
    expect(calls).toHaveLength(0)
  })

  describe('キー非露出', () => {
    it('上流がキーを反射してもエラーメッセージ・detail に含めない', async () => {
      const echo = { status: 400, body: { error: { type: 'invalid', message: `bad header Authorization: Bearer ${FAKE_KEY}` } } }
      const { c } = client([echo])
      const e = await catchError(c.evaluate(request, { apiKey: FAKE_KEY }))
      expect(e.message).not.toContain(FAKE_KEY)
      expect(String(e.detail)).not.toContain(FAKE_KEY)
      expect(JSON.stringify(e)).not.toContain(FAKE_KEY)
      expect(String(e.stack)).not.toContain(FAKE_KEY)
    })

    it('ネットワーク例外のメッセージにキーが入っても伏せる', async () => {
      const fetchWithKeyInError = async () => {
        throw new TypeError(`Failed to fetch with ${FAKE_KEY}`)
      }
      const c = new VercelGatewayClient({ fetch: fetchWithKeyInError, maxAttempts: 1 })
      const e = await catchError(c.evaluate(request, { apiKey: FAKE_KEY }))
      expect(e.kind).toBe('network')
      expect(e.message).not.toContain(FAKE_KEY)
    })

    it('onAttempt の観測・成功結果にキーを含めない', async () => {
      const seen: unknown[] = []
      const { c } = client([unavailable, ok], { onAttempt: (i) => seen.push(i) })
      const r = await c.evaluate(request, { apiKey: FAKE_KEY })
      expect(JSON.stringify(seen)).not.toContain(FAKE_KEY)
      expect(JSON.stringify(r)).not.toContain(FAKE_KEY)
    })

    it('redactSecrets は Bearer 形式と vck_ 接頭辞も伏せる', () => {
      expect(redactSecrets('Bearer abc.def-123 and vck_xyz')).toBe('Bearer [REDACTED] and [REDACTED]')
    })
  })

  it('parseRetryAfter は秒と HTTP-date を読む', () => {
    expect(parseRetryAfter('50', 0)).toBe(50_000)
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10_000)
    expect(parseRetryAfter('nonsense', 0)).toBeNull()
    expect(parseRetryAfter(null, 0)).toBeNull()
  })
})
