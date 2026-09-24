import { describe, expect, it } from 'vitest'
import { JevBettingAgent, symmetrize } from '../../src/ai/JevBettingAgent'
import type { BetStrategy } from '../../src/ai/JevBettingAgent'
import { VercelGatewayClient } from '../../src/ai/VercelGatewayClient'
import { AiGatewayError } from '../../src/ai/errors'
import { DRAW_OPTION, PROMPT_VERSION, buildState, contestantLabels } from '../../src/ai/prompt'
import type { MatchObservation } from '../../src/ai/BettingAgent'
import { FAKE_KEY, almirajMatch, choiceBody, mockFetch, noSleep, slimeMatch } from './fixtures'
import type { MockResponse } from './fixtures'

function agent(
  responses: MockResponse[],
  opts: { strategy?: BetStrategy; key?: string | null; symmetrizeIdentical?: boolean } = {},
) {
  const m = mockFetch(responses)
  const client = new VercelGatewayClient({ fetch: m.fn, sleep: noSleep })
  const a = new JevBettingAgent({
    getApiKey: () => (opts.key === undefined ? FAKE_KEY : opts.key),
    client,
    strategy: opts.strategy,
    symmetrizeIdentical: opts.symmetrizeIdentical,
  })
  return { a, calls: m.calls }
}

function sentBody(calls: Array<{ init: RequestInit }>, i = 0) {
  return JSON.parse(String(calls[i].init.body)) as {
    state: { contestants: Array<Record<string, unknown>>; informationMode: string }
    questions: { winner: { type: string; instructions: string; criteria: Record<string, string> } }
  }
}

describe('JevBettingAgent', () => {
  it('選択肢名は「番号 + 名前」で、id を Jev に見せない', async () => {
    const { a, calls } = agent([{ status: 200, body: choiceBody({ '1番 スライム': 1 }) }])
    await a.decide(slimeMatch())
    const body = sentBody(calls)
    expect(Object.keys(body.questions.winner.criteria)).toEqual(['1番 スライム', '2番 おおがらす', '3番 いっかくうさぎ', DRAW_OPTION])
    expect(JSON.stringify(body)).not.toContain('monster-a')
    expect(body.state.contestants.map((c) => c.label)).toEqual(['1番 スライム', '2番 おおがらす', '3番 いっかくうさぎ'])
  })

  it('同名モンスター（アルミラージ×4）を番号で区別し、正しい id に写像する（平均化なし）', async () => {
    const probs = { '1番 アルミラージ': 0.1, '2番 アルミラージ': 0.1, '3番 アルミラージ': 0.6, '4番 アルミラージ': 0.1, [DRAW_OPTION]: 0.1 }
    const { a, calls } = agent([{ status: 200, body: choiceBody(probs) }], { strategy: 'max_probability', symmetrizeIdentical: false })
    const d = await a.decide(almirajMatch())
    expect(new Set(Object.keys(sentBody(calls).questions.winner.criteria)).size).toBe(5)
    expect(d.bet).toBe('monster-c')
    expect(d.probabilities['monster-c']).toBeCloseTo(0.6 / 0.9)
    expect(d.meta?.jevChoice).toBe('monster-c')
  })

  it('観測が同一の選手は勝率を平均する（実測の位置バイアス対策）', async () => {
    // 実測: 1番 0.14 / 2〜4番 0.01 / 引き分け 0.83
    const probs = { '1番 アルミラージ': 0.14, '2番 アルミラージ': 0.01, '3番 アルミラージ': 0.01, '4番 アルミラージ': 0.01, [DRAW_OPTION]: 0.83 }
    const d = await agent([{ status: 200, body: choiceBody(probs) }]).a.decide(almirajMatch())
    for (const id of ['monster-a', 'monster-b', 'monster-c', 'monster-d']) expect(d.probabilities[id]).toBeCloseTo(0.25)
    expect(d.bet).toBe('monster-a') // 同点は若い番号
    expect(d.meta?.symmetrizedGroups).toBe(1)
    expect(d.meta?.symmetryGap).toBeCloseTo(0.13)
    expect(d.reason).toContain('平均済み')
  })

  it('symmetrize は同名でもオッズや能力が違えば平均しない', () => {
    const obs = { ...almirajMatch() }
    obs.contestants = obs.contestants.map((c, i) => (i === 0 ? { ...c, odds: 2.0 } : c))
    const r = symmetrize(obs, [0.4, 0.1, 0.2, 0.3])
    expect(r.values[0]).toBe(0.4)
    expect(r.values.slice(1)).toEqual([0.2, 0.2, 0.2].map((v) => expect.closeTo(v)))
    expect(r.groups).toBe(1)
  })

  it('期待値最大: 勝率は低くても勝率×オッズが大きい選手に賭ける', async () => {
    // スライム 0.5×1.5=0.75 / おおがらす 0.3×3.2=0.96 / いっかくうさぎ 0.15×6.0=0.9
    const probs = { '1番 スライム': 0.5, '2番 おおがらす': 0.3, '3番 いっかくうさぎ': 0.15, [DRAW_OPTION]: 0.05 }
    const ev = await agent([{ status: 200, body: choiceBody(probs) }]).a.decide(slimeMatch())
    expect(ev.bet).toBe('monster-b')
    expect(ev.meta?.expectedValue).toBeCloseTo(0.96)
    expect(ev.meta?.strategy).toBe('expected_value')

    const mp = await agent([{ status: 200, body: choiceBody(probs) }], { strategy: 'max_probability' }).a.decide(slimeMatch())
    expect(mp.bet).toBe('monster-a')
  })

  it('probabilities は引き分けを除いて合計 1、引き分け確率は meta に残す', async () => {
    const probs = { '1番 スライム': 0.4, '2番 おおがらす': 0.2, '3番 いっかくうさぎ': 0.2, [DRAW_OPTION]: 0.2 }
    const d = await agent([{ status: 200, body: choiceBody(probs) }]).a.decide(slimeMatch())
    expect(Object.keys(d.probabilities)).toEqual(['monster-a', 'monster-b', 'monster-c'])
    expect(Object.values(d.probabilities).reduce((s, v) => s + v, 0)).toBeCloseTo(1)
    expect(d.meta?.drawProbability).toBeCloseTo(0.2)
  })

  it('確率合計が 1 から外れたら正規化し meta に記録する', async () => {
    const probs = { '1番 スライム': 0.34, '2番 おおがらす': 0.34, '3番 いっかくうさぎ': 0.34, [DRAW_OPTION]: 0 }
    const d = await agent([{ status: 200, body: choiceBody(probs) }]).a.decide(slimeMatch())
    expect(d.meta?.normalized).toBe('true')
    expect(d.meta?.probabilitySum).toBeCloseTo(1.02)
    expect(d.reason).toContain('正規化')
  })

  it('reason は確率から組み立てたもので、Jev が理由文を生成しない旨を明示する', async () => {
    const d = await agent([{ status: 200, body: choiceBody({ '1番 スライム': 1 }) }]).a.decide(slimeMatch())
    expect(d.reason).toContain('Jev は理由文を生成しない')
    expect(d.reason).toContain('1番 スライム 100%')
  })

  it('meta にモデル・プロンプト版・試行回数を残し、キーは含めない', async () => {
    const d = await agent([{ status: 503 }, { status: 200, body: choiceBody({ '1番 スライム': 1 }) }]).a.decide(slimeMatch())
    expect(d.meta?.model).toBe('typesafe-ai/jev')
    expect(d.meta?.promptVersion).toBe(PROMPT_VERSION)
    expect(d.meta?.attempts).toBe(2)
    expect(JSON.stringify(d)).not.toContain(FAKE_KEY)
  })

  it('形式不正は 1 回取り直し、直らなければ invalid で失敗（キーを含まない）', async () => {
    const bad = { status: 200, body: choiceBody({ '9番 ゾーマ': 1 }) }
    const good = { status: 200, body: choiceBody({ '2番 おおがらす': 1 }) }
    const retried = agent([bad, good])
    const d = await retried.a.decide(slimeMatch())
    expect(d.bet).toBe('monster-b')
    expect(d.meta?.schemaFailures).toBe(1)
    expect(retried.calls).toHaveLength(2)

    const failing = agent([bad])
    const e = await failing.a.decide(slimeMatch()).then(() => { throw new Error("成功してしまった") }, (x: unknown) => x as AiGatewayError)
    expect(e).toBeInstanceOf(AiGatewayError)
    expect(e.kind).toBe('invalid')
    expect(e.message).toContain('未知の選択肢')
    expect(e.message).not.toContain(FAKE_KEY)
    expect(failing.calls).toHaveLength(2)
  })

  it('キー未設定なら通信せず auth エラー', async () => {
    const { a, calls } = agent([{ status: 200, body: choiceBody({}) }], { key: null })
    await expect(a.decide(slimeMatch())).rejects.toMatchObject({ kind: 'auth' })
    expect(calls).toHaveLength(0)
  })

  it('401 はそのまま auth で失敗し、エラーにキーを含めない', async () => {
    const { a } = agent([{ status: 401, body: { error: { type: 'authentication_error' } } }])
    const e = await a.decide(slimeMatch()).then(() => { throw new Error("成功してしまった") }, (x: unknown) => x as AiGatewayError)
    expect(e.kind).toBe('auth')
    expect(`${e.message} ${e.stack}`).not.toContain(FAKE_KEY)
  })
})

describe('prompt state (Classic / Analyst)', () => {
  const analyst: MatchObservation = {
    ...slimeMatch('analyst'),
    contestants: slimeMatch('analyst').contestants.map((c) => ({
      ...c,
      stats: c.stats ?? { maxHp: 10, mp: 0, attack: 10, defense: 10, agility: 10 },
      actions: [{ name: 'こうげき', forbiddenInArena: false }],
      ai: { strategy: 'normal', selectionJudgment: 0, multiAction: 'single', concentrate: false },
    })),
  }

  it('Classic は名前とオッズだけ（能力値を含めない）', () => {
    const obs = { ...analyst, informationMode: 'classic' as const }
    const s = buildState(obs, contestantLabels(obs)) as { contestants: Array<Record<string, unknown>> }
    expect(Object.keys(s.contestants[0]).sort()).toEqual(['label', 'name', 'odds'])
  })

  it('Analyst は能力値・行動・AI を含める', () => {
    const s = buildState(analyst, contestantLabels(analyst)) as { contestants: Array<Record<string, unknown>> }
    expect(s.contestants[0]).toHaveProperty('stats')
    expect(s.contestants[0]).toHaveProperty('actions')
    expect(s.contestants[0]).toHaveProperty('ai')
  })

  it('賭け金・主人公レベル・id は state に入れない', () => {
    const obs = slimeMatch()
    const text = JSON.stringify(buildState(obs, contestantLabels(obs)))
    expect(text).not.toContain('stake')
    expect(text).not.toContain('heroLevel')
    expect(text).not.toContain('monster-')
  })
})

describe('prompt', () => {
  it('同名の選手を「別個体として戦う」と説明する（v1 の「番号だけが区別」は引き分けに偏らせた）', () => {
    const obs = almirajMatch()
    const text = JSON.stringify(buildState(obs, contestantLabels(obs)))
    expect(text).toContain('別々の個体')
    expect(text).not.toContain('番号だけが区別')
  })
})
