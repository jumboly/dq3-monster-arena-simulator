/**
 * Analysis を Web Worker で回すときのメッセージ形式と、Worker 側の処理本体。
 *
 * 処理本体を Worker のエントリ（analysis.worker.ts）から分けているのは、Node（Vitest）でも
 * 同じコードを動かし、メインスレッド実行と結果が一致することを確かめられるようにするため。
 */
import type { ArenaGame } from '../../core/arena/ArenaGame'
import type { MatchOffer } from '../../core/arena/types'
import type { WinDistribution } from '../../core/stats/winDistribution'
import { runAnalysis } from './analysisRunner'

export type AnalysisRequest =
  | { type: 'start'; id: number; offer: MatchOffer; trialsPerBet: number; seed: number }
  | { type: 'abort'; id: number }

export type AnalysisResponse =
  | { type: 'progress'; id: number; done: number; total: number; dist: WinDistribution }
  | { type: 'done'; id: number; dist: WinDistribution; aborted: boolean }
  | { type: 'error'; id: number; message: string }

/**
 * Worker 側は画面描画を止める心配が無いので、メインスレッド（12ms）より長く区切る。
 * 区切りごとの待ちと進捗メッセージの回数を減らすため。区切り方は乱数の消費順に影響しないので結果は変わらない。
 */
const WORKER_BUDGET_MS = 50

export function createAnalysisHandler(
  game: ArenaGame,
  post: (msg: AnalysisResponse) => void,
  schedule?: (fn: () => void) => void,
): (msg: AnalysisRequest) => void {
  const running = new Map<number, AbortController>()
  return (msg) => {
    if (msg.type === 'abort') {
      running.get(msg.id)?.abort()
      return
    }
    const ac = new AbortController()
    running.set(msg.id, ac)
    runAnalysis({
      game,
      offer: msg.offer,
      trialsPerBet: msg.trialsPerBet,
      seed: msg.seed,
      signal: ac.signal,
      budgetMs: WORKER_BUDGET_MS,
      schedule,
      onProgress: (done, total, dist) => post({ type: 'progress', id: msg.id, done, total, dist }),
    })
      .then(({ dist, aborted }) => post({ type: 'done', id: msg.id, dist, aborted }))
      .catch((e: unknown) => post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) }))
      .finally(() => running.delete(msg.id))
  }
}
