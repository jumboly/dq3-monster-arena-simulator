import { describe, expect, it, vi } from 'vitest'
import { AUTO_PLAY_MAX_ROUNDS, runAutoPlay } from '../../src/ai/autoPlay'
import { AiGatewayError } from '../../src/ai/errors'

const sleepSpy = () => vi.fn(async (_ms: number, _signal?: AbortSignal) => {})
const gw = (kind: AiGatewayError['kind'], retryAfterMs: number | null = null) =>
  new AiGatewayError({ kind, status: null, attempts: 1, elapsedMs: 0, retryAfterMs })

describe('runAutoPlay', () => {
  it('上限回数まで回す', async () => {
    const rounds: number[] = []
    const r = await runAutoPlay({ maxRounds: 5, playRound: async ({ round }) => (rounds.push(round), {}), sleep: sleepSpy() })
    expect(r.stopReason).toBe('max_rounds')
    expect(rounds).toEqual([0, 1, 2, 3, 4])
  })

  it('上限は 1000 回に切り詰める', async () => {
    const play = vi.fn(async () => ({}))
    const r = await runAutoPlay({ maxRounds: 5000, playRound: play, sleep: sleepSpy() })
    expect(r.roundsCompleted).toBe(AUTO_PLAY_MAX_ROUNDS)
    expect(play).toHaveBeenCalledTimes(1000)
  })

  it('AbortSignal で止まる（待機中の中断も含む）', async () => {
    const c = new AbortController()
    const r = await runAutoPlay({
      maxRounds: 10,
      signal: c.signal,
      playRound: async ({ round }) => {
        if (round === 2) c.abort()
        return {}
      },
    })
    expect(r.stopReason).toBe('aborted')
    expect(r.roundsCompleted).toBe(3)

    const c2 = new AbortController()
    const r2 = await runAutoPlay({
      maxRounds: 10,
      signal: c2.signal,
      failureBackoffMs: 10_000,
      playRound: async () => {
        setTimeout(() => c2.abort(), 1)
        throw gw('server')
      },
    })
    expect(r2.stopReason).toBe('aborted')
  })

  it('連続失敗で止まり、成功で連続カウントが戻る。失敗した試合はやり直す', async () => {
    const script = ['ok', 'fail', 'fail', 'ok', 'fail', 'fail', 'fail']
    let i = 0
    const rounds: Array<[number, number]> = []
    const r = await runAutoPlay({
      maxRounds: 10,
      maxConsecutiveFailures: 3,
      sleep: sleepSpy(),
      playRound: async ({ round, attempt }) => {
        rounds.push([round, attempt])
        if (script[i++] === 'fail') throw gw('server')
        return {}
      },
    })
    expect(r.stopReason).toBe('consecutive_failures')
    expect(r.roundsCompleted).toBe(2)
    expect(rounds.slice(0, 4)).toEqual([[0, 1], [1, 1], [1, 2], [1, 3]])
  })

  it('レート制限は Retry-After（上限付き）だけ待ってからやり直す', async () => {
    const sleep = sleepSpy()
    let n = 0
    const r = await runAutoPlay({
      maxRounds: 2,
      sleep,
      maxRateLimitWaitMs: 90_000,
      playRound: async () => {
        n++
        if (n === 1) throw gw('rate_limit', 50_000)
        if (n === 2) throw gw('rate_limit', 999_000)
        if (n === 3) throw gw('rate_limit', null)
        return {}
      },
      maxConsecutiveFailures: 5,
    })
    expect(r.stopReason).toBe('max_rounds')
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([50_000, 90_000, 60_000])
  })

  it('auth / invalid は待っても直らないので即停止', async () => {
    for (const kind of ['auth', 'invalid'] as const) {
      const play = vi.fn(async () => { throw gw(kind) })
      const r = await runAutoPlay({ maxRounds: 10, sleep: sleepSpy(), playRound: play })
      expect(r.stopReason).toBe('fatal_error')
      expect(play).toHaveBeenCalledTimes(1)
    }
  })

  it('playRound が stop を返したら終了（所持金不足など）', async () => {
    const r = await runAutoPlay({ maxRounds: 10, playRound: async ({ round }) => ({ stop: round === 1 }) })
    expect(r.stopReason).toBe('requested')
    expect(r.roundsCompleted).toBe(2)
  })

  it('イベントを通知する', async () => {
    const events: string[] = []
    let n = 0
    await runAutoPlay({
      maxRounds: 1,
      sleep: sleepSpy(),
      onEvent: (e) => events.push(e.type),
      playRound: async () => {
        if (n++ === 0) throw gw('server')
        return {}
      },
    })
    expect(events).toEqual(['round_failed', 'waiting', 'round_completed'])
  })
})
