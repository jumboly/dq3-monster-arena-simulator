/**
 * Analysis（Simulate × N）の分割実行。
 *
 * 画面からは analysisClient 経由で Web Worker 内で呼ばれる。テストではメインスレッドで直接呼び、
 * Worker 経由の結果と一致することを確かめる（同じ関数なので同じ seed なら同じ表になる）。
 * 時間予算で区切って次のチャンクを setTimeout に回すのは、チャンクの合間に中止メッセージを受け取るため。
 * 集計は core/stats の純関数に任せ、ここはスケジューリングだけを持つ。
 *
 * 所持金には影響させない: goldBefore はダミー値を渡し、ArenaStore は一切触らない。
 */
import type { ArenaGame } from '../../core/arena/ArenaGame'
import type { MatchOffer } from '../../core/arena/types'
import { SeededRandom } from '../../core/rng/RandomSource'
import { createWinDistribution, recordRound, type WinDistribution } from '../../core/stats/winDistribution'

export interface AnalysisOptions {
  game: ArenaGame
  offer: MatchOffer
  trialsPerBet: number
  /** 戦闘シード列の元。表示しておけば同じ表を再現できる */
  seed: number
  signal?: AbortSignal
  budgetMs?: number
  onProgress?: (done: number, total: number, dist: WinDistribution) => void
  /** テスト用に同期スケジューラへ差し替えられるようにする */
  schedule?: (fn: () => void) => void
}

export function runAnalysis(o: AnalysisOptions): Promise<{ dist: WinDistribution; aborted: boolean }> {
  const slots = o.offer.contestants.map((c) => c.slot)
  const dist = createWinDistribution(slots)
  const rng = new SeededRandom(o.seed)
  const total = slots.length * o.trialsPerBet
  const budget = o.budgetMs ?? 12
  const schedule = o.schedule ?? ((fn) => setTimeout(fn, 0))
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  let done = 0

  return new Promise((resolve, reject) => {
    const step = () => {
      try {
        if (o.signal?.aborted) return resolve({ dist, aborted: true })
        const start = now()
        // 賭け先ごとに試行を交互に回す。途中で止めても各行の試行数が揃うようにするため
        while (done < total && now() - start < budget) {
          const betSlot = slots[done % slots.length]
          const battleSeed = rng.nextInt(0x7fffffff)
          recordRound(dist, o.game.resolveBet({ offer: o.offer, betSlot, goldBefore: 0, battleSeed }))
          done += 1
        }
        o.onProgress?.(done, total, dist)
        if (done >= total) resolve({ dist, aborted: false })
        else schedule(step)
      } catch (e) {
        reject(e)
      }
    }
    schedule(step)
  })
}
