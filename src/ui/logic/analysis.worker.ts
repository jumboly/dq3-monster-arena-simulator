/**
 * Analysis 用の Web Worker エントリ。ゲームデータは静的 import なので、Worker でもメインスレッドと
 * 同じモジュールから同じ初期化で ArenaGame を作れる。
 */
import { createDefaultArenaGame } from '../gameFactory'
import { createAnalysisHandler, type AnalysisRequest, type AnalysisResponse } from './analysisWorkerProtocol'

// tsconfig の lib は DOM（Window 前提）なので、Worker の postMessage の形だけ最小限に型付けする
const scope = self as unknown as {
  postMessage(msg: AnalysisResponse): void
  onmessage: ((e: MessageEvent<AnalysisRequest>) => void) | null
}

const handle = createAnalysisHandler(createDefaultArenaGame(), (msg) => scope.postMessage(msg))
scope.onmessage = (e) => handle(e.data)
