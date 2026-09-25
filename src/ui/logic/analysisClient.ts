/**
 * Analysis の実行口。計算は常に Web Worker で回す（アプリが動くブラウザなら Worker は必ず使えるので、
 * メインスレッドへの切り替えは持たない）。runAnalysis と同じ Promise の形で返す。
 */
import type { MatchOffer } from '../../core/arena/types'
import { createWinDistribution, type WinDistribution } from '../../core/stats/winDistribution'
import type { AnalysisRequest, AnalysisResponse } from './analysisWorkerProtocol'

/** Worker の差し替え口。テストで Worker を使わずにメッセージ経路を確かめるため */
export interface AnalysisWorkerLike {
  postMessage(msg: AnalysisRequest): void
  onmessage: ((e: MessageEvent<AnalysisResponse>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  terminate(): void
}

export interface AnalyzeOptions {
  offer: MatchOffer
  trialsPerBet: number
  seed: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number, dist: WinDistribution) => void
  createWorker?: () => AnalysisWorkerLike
}

function defaultCreateWorker(): AnalysisWorkerLike {
  return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }) as AnalysisWorkerLike
}

let nextId = 1

export function analyze(o: AnalyzeOptions): Promise<{ dist: WinDistribution; aborted: boolean }> {
  const worker = (o.createWorker ?? defaultCreateWorker)()
  const id = nextId++
  return new Promise((resolve, reject) => {
    const finish = () => {
      o.signal?.removeEventListener('abort', onAbort)
      // 1 回の実行ごとに作って捨てる。実行間で状態を持ち越さないようにするため
      worker.terminate()
    }
    const onAbort = () => worker.postMessage({ type: 'abort', id })
    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'progress') o.onProgress?.(msg.done, msg.total, msg.dist)
      else if (msg.type === 'done') {
        finish()
        resolve({ dist: msg.dist, aborted: msg.aborted })
      } else {
        finish()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      finish()
      reject(new Error(e.message || 'Analysis の Worker を起動できませんでした'))
    }
    if (o.signal?.aborted) {
      finish()
      resolve({ dist: createWinDistribution(o.offer.contestants.map((c) => c.slot)), aborted: true })
      return
    }
    o.signal?.addEventListener('abort', onAbort)
    worker.postMessage({ type: 'start', id, offer: o.offer, trialsPerBet: o.trialsPerBet, seed: o.seed })
  })
}
