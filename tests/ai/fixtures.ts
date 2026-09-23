/**
 * テスト共通の観測データとモック。
 * キー文字列は実キーと無関係なダミー。露出検査で検索しやすいよう特徴的な値にしている。
 */
import type { MatchObservation } from '../../src/ai/BettingAgent'
import type { FetchLike } from '../../src/ai/VercelGatewayClient'

export const FAKE_KEY = 'vck_TEST_SECRET_do_not_leak_1234567890'

export function slimeMatch(mode: 'classic' | 'analyst' = 'classic'): MatchObservation {
  return {
    informationMode: mode,
    heroLevel: 10,
    stake: 100,
    contestants: [
      { id: 'monster-a', name: 'スライム', odds: 1.5, ...(mode === 'analyst' ? { stats: { maxHp: 8, mp: 0, attack: 9, defense: 5, agility: 4 } } : {}) },
      { id: 'monster-b', name: 'おおがらす', odds: 3.2 },
      { id: 'monster-c', name: 'いっかくうさぎ', odds: 6.0 },
    ],
  }
}

export function almirajMatch(): MatchObservation {
  return {
    informationMode: 'classic',
    heroLevel: 10,
    stake: 100,
    contestants: ['a', 'b', 'c', 'd'].map((s) => ({ id: `monster-${s}`, name: 'アルミラージ', odds: 4.0 })),
  }
}

export interface MockResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
  /** true なら fetch 自体を reject する（ネットワーク断） */
  networkError?: boolean
}

export function mockFetch(responses: MockResponse[]) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    if (r.networkError) throw new TypeError('Failed to fetch')
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})
    return new Response(text, { status: r.status, headers: r.headers })
  }
  return { fn, calls }
}

export function choiceBody(probabilities: Record<string, number>, extra: Record<string, unknown> = {}) {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0]
  return {
    model: 'typesafe-ai/jev',
    answers: { winner: { type: 'choice', choice, probabilities, confidence: 0.5, ...extra } },
    usage: { inputTokens: 900, outputTokens: 100 },
    providerMetadata: { typesafe: { confidence: { winner: 0.5 } }, gateway: { generationId: 'gen_TEST' } },
  }
}

export const noSleep = async () => {}
