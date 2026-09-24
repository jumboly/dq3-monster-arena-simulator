/**
 * Auto Play の実行状態を保持するコントローラ（React 非依存）。
 *
 * コンポーネントの state に置くとタブ切替（アンマウント）で進捗表示と Stop が失われるため、
 * ArenaStore と同じく外部ストアとしてアプリ全体で 1 つだけ持つ。
 */
import type { ArenaGame } from '../../core/arena/ArenaGame'
import type { BettingAgent } from '../../ai/BettingAgent'
import type { ArenaStore } from './arenaStore'
import { runAutoPlay, type AutoPlayProgress, type AutoPlayEndReason } from './autoPlay'

export interface AutoPlayState {
  running: boolean
  progress: AutoPlayProgress | null
  lastStop: { reason: AutoPlayEndReason; progress: AutoPlayProgress; agentLabel: string } | null
}

export class AutoPlayController {
  private state: AutoPlayState = { running: false, progress: null, lastStop: null }
  private listeners = new Set<() => void>()
  private abort: AbortController | null = null

  private readonly game: ArenaGame
  private readonly store: ArenaStore

  constructor(game: ArenaGame, store: ArenaStore) {
    this.game = game
    this.store = store
  }

  getState = (): AutoPlayState => this.state
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private set(patch: Partial<AutoPlayState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  async start(agent: BettingAgent, count: number, failureLimit: number): Promise<void> {
    // 二重起動すると同じ試合に 2 回賭けに行くので、実行中は無視する
    if (this.state.running) return
    const ac = new AbortController()
    this.abort = ac
    this.store.setLocked(true)
    this.set({ running: true, progress: null, lastStop: null })
    try {
      const { reason, progress } = await runAutoPlay({
        store: this.store,
        game: this.game,
        agent,
        count,
        failureLimit,
        signal: ac.signal,
        onProgress: (p) => this.set({ progress: p }),
      })
      this.set({ running: false, progress, lastStop: { reason, progress, agentLabel: agent.label } })
    } catch (e) {
      // runAutoPlay 内で想定外の例外（ArenaGame の不具合など）が出ても UI を「実行中」のまま固めない
      const progress = this.state.progress ?? {
        played: 0,
        target: count,
        failures: 1,
        consecutiveFailures: 1,
        lastError: null,
        waitingMs: null,
      }
      const withErr = { ...progress, lastError: e instanceof Error ? e.message : String(e) }
      this.set({ running: false, progress: withErr, lastStop: { reason: 'failures', progress: withErr, agentLabel: agent.label } })
    } finally {
      this.abort = null
      this.store.setLocked(false)
    }
  }

  stop(): void {
    this.abort?.abort()
  }

  dismiss(): void {
    this.set({ lastStop: null, progress: null })
  }
}
