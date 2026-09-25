import { describe, expect, it } from 'vitest'
import { analyze, type AnalysisWorkerLike } from '../../src/ui/logic/analysisClient'
import { runAnalysis } from '../../src/ui/logic/analysisRunner'
import { createAnalysisHandler, type AnalysisRequest, type AnalysisResponse } from '../../src/ui/logic/analysisWorkerProtocol'
import { createDefaultArenaGame } from '../../src/ui/gameFactory'

const game = createDefaultArenaGame()
const offer = game.createOfferForCard({ cardIndex: 20, heroLevel: 30, round: 0, seed: 5 })
const sync = (fn: () => void) => fn()

/**
 * 本物の Worker の代わりに、同じ処理本体（createAnalysisHandler）へ非同期でメッセージを中継する。
 * structuredClone を通すのは、Worker 境界で関数やクラスが落ちることをテストでも再現するため。
 */
class FakeWorker implements AnalysisWorkerLike {
  onmessage: ((e: MessageEvent<AnalysisResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  private readonly handle = createAnalysisHandler(createDefaultArenaGame(), (msg) =>
    setTimeout(() => !this.terminated && this.onmessage?.({ data: structuredClone(msg) } as MessageEvent<AnalysisResponse>)),
  )
  postMessage(msg: AnalysisRequest): void {
    setTimeout(() => this.handle(structuredClone(msg)))
  }
  terminate(): void {
    this.terminated = true
  }
}

describe('Analysis の Worker 実行', () => {
  it('Worker 側の処理本体はメインスレッド実行と同じ表を返す', async () => {
    const main = await runAnalysis({ game, offer, trialsPerBet: 40, seed: 99, schedule: sync })
    const posted: AnalysisResponse[] = []
    createAnalysisHandler(game, (m) => posted.push(m), sync)({ type: 'start', id: 1, offer, trialsPerBet: 40, seed: 99 })
    await new Promise((r) => setTimeout(r))
    const done = posted.find((m) => m.type === 'done')
    expect(done).toEqual({ type: 'done', id: 1, dist: main.dist, aborted: false })
  })

  it('analyze はメッセージ経由でも同じ表になり、進捗を返して最後に Worker を捨てる', async () => {
    const main = await runAnalysis({ game, offer, trialsPerBet: 40, seed: 7, schedule: sync })
    const worker = new FakeWorker()
    let progressCalls = 0
    const r = await analyze({ offer, trialsPerBet: 40, seed: 7, createWorker: () => worker, onProgress: () => progressCalls++ })
    expect(r).toEqual({ dist: main.dist, aborted: false })
    expect(progressCalls).toBeGreaterThan(0)
    expect(worker.terminated).toBe(true)
  })

  it('中止すると途中までの表を返し、賭け先ごとの試行数は揃っている', async () => {
    const ac = new AbortController()
    const worker = new FakeWorker()
    const r = await analyze({
      offer,
      trialsPerBet: 100000,
      seed: 1,
      signal: ac.signal,
      createWorker: () => worker,
      onProgress: () => ac.abort(),
    })
    expect(r.aborted).toBe(true)
    const trials = r.dist.slots.map((s) => r.dist.rows[s].trials)
    expect(trials[0]).toBeLessThan(100000)
    expect(Math.max(...trials) - Math.min(...trials)).toBeLessThanOrEqual(1)
  })

  it('Worker の起動に失敗したらエラーにする', async () => {
    const worker = new FakeWorker()
    worker.postMessage = () => setTimeout(() => worker.onerror?.({ message: 'boom' } as ErrorEvent))
    await expect(analyze({ offer, trialsPerBet: 10, seed: 1, createWorker: () => worker })).rejects.toThrow('boom')
    expect(worker.terminated).toBe(true)
  })
})
