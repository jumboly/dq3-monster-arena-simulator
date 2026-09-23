/**
 * API キー無し・Jev 実装未統合でも Jev モードの UI を動かすためのモックエージェント。
 *
 * 予測は「表示オッズの逆数を正規化したもの」＝ 胴元の見立てをそのまま信じる素朴な
 * ベースライン。統計ベースラインとしても意味があるので、本物の Jev と比べる用途にも使える。
 */
import type { BetDecision, BettingAgent, MatchObservation } from '../../ai/BettingAgent'
import type { JevPolicy } from '../../storage/session'

export interface MockAgentOptions {
  policy: JevPolicy
  /** 応答待ちの UI（ローディング・Stop）を確認できるよう、わざと遅延させる */
  delayMs?: number
  /** 0..1。失敗時の UI（エラー表示・再試行・連続失敗停止）を確認するための故意の失敗率 */
  failureRate?: number
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortErr())
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(abortErr())
      },
      { once: true },
    )
  })
}

function abortErr(): Error {
  const e = new Error('中断されました')
  e.name = 'AbortError'
  return e
}

export class MockBettingAgent implements BettingAgent {
  readonly id = 'mock-inverse-odds'
  readonly label = 'Mock Jev（オッズ逆数ベースライン）'

  private readonly opts: MockAgentOptions
  constructor(opts: MockAgentOptions) {
    this.opts = opts
  }

  async decide(observation: MatchObservation, signal?: AbortSignal): Promise<BetDecision> {
    await sleep(this.opts.delayMs ?? 400, signal)
    if (this.opts.failureRate && Math.random() < this.opts.failureRate) {
      throw new Error('モックエージェントの故意の失敗（failureRate）')
    }
    const inv = observation.contestants.map((c) => (c.odds > 0 ? 1 / c.odds : 0))
    const total = inv.reduce((a, b) => a + b, 0) || 1
    const probabilities: Record<string, number> = {}
    observation.contestants.forEach((c, i) => {
      probabilities[c.id] = inv[i] / total
    })
    const score = (id: string, odds: number) =>
      this.opts.policy === 'max-ev' ? probabilities[id] * odds : probabilities[id]
    let best = observation.contestants[0]
    for (const c of observation.contestants) if (score(c.id, c.odds) > score(best.id, best.odds)) best = c
    return {
      bet: best.id,
      probabilities,
      reason:
        this.opts.policy === 'max-ev'
          ? `オッズの逆数を勝率とみなし、期待値（勝率×倍率）が最大の ${best.name} に賭けます。`
          : `オッズの逆数を勝率とみなし、最も勝ちやすい ${best.name} に賭けます。`,
      meta: { agent: this.id, policy: this.opts.policy },
    }
  }
}
