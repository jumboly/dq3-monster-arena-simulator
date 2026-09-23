import { describe, expect, it } from 'vitest'
import { restrictAndNormalize, validateChoiceAnswer, validateEvaluateEnvelope } from '../../src/ai/schemas/evaluateResponse'
import { assertBetDecision } from '../../src/ai/schemas/betDecision'
import { SchemaError } from '../../src/ai/schemas/validation'
import { choiceBody, slimeMatch } from './fixtures'

const opts = ['A', 'B', 'C']

describe('validateEvaluateEnvelope', () => {
  it('実測形式から model / usage / generationId / confidence を取り出す', () => {
    const e = validateEvaluateEnvelope(choiceBody({ A: 1 }))
    expect(e.model).toBe('typesafe-ai/jev')
    expect(e.inputTokens).toBe(900)
    expect(e.outputTokens).toBe(100)
    expect(e.generationId).toBe('gen_TEST')
    expect(e.confidenceByKey.winner).toBe(0.5)
  })

  it('answers が無ければ SchemaError', () => {
    expect(() => validateEvaluateEnvelope({})).toThrow(SchemaError)
    expect(() => validateEvaluateEnvelope(null)).toThrow(SchemaError)
  })
})

describe('validateChoiceAnswer', () => {
  it('合計 1 ならそのまま（normalized=false）', () => {
    const a = validateChoiceAnswer({ type: 'choice', choice: 'A', probabilities: { A: 0.5, B: 0.3, C: 0.2 } }, opts)
    expect(a.normalized).toBe(false)
    expect(a.probabilities).toEqual({ A: 0.5, B: 0.3, C: 0.2 })
    expect(a.choice).toBe('A')
  })

  it('丸め誤差で合計が 1 から外れたら正規化して記録する', () => {
    const a = validateChoiceAnswer({ type: 'choice', probabilities: { A: 0.34, B: 0.34, C: 0.34 } }, opts)
    expect(a.normalized).toBe(true)
    expect(a.rawSum).toBeCloseTo(1.02)
    const sum = Object.values(a.probabilities).reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 10)
    expect(a.probabilities.A).toBeCloseTo(1 / 3)
  })

  it('欠けた選択肢は 0 で補い、記録する', () => {
    const a = validateChoiceAnswer({ probabilities: { A: 0.7, B: 0.3 } }, opts)
    expect(a.probabilities.C).toBe(0)
    expect(a.missingOptions).toEqual(['C'])
  })

  it('未知の選択肢・範囲外・合計 0・大幅なずれは SchemaError', () => {
    expect(() => validateChoiceAnswer({ probabilities: { A: 0.5, X: 0.5 } }, opts)).toThrow(/未知の選択肢/)
    expect(() => validateChoiceAnswer({ probabilities: { A: 1.5 } }, opts)).toThrow(SchemaError)
    expect(() => validateChoiceAnswer({ probabilities: { A: '0.5' } }, opts)).toThrow(SchemaError)
    expect(() => validateChoiceAnswer({ probabilities: { A: 0, B: 0, C: 0 } }, opts)).toThrow(/合計が 0/)
    expect(() => validateChoiceAnswer({ probabilities: { A: 0.9, B: 0.9 } }, opts)).toThrow(/大きく外れ/)
    expect(() => validateChoiceAnswer({ type: 'score', score: 1 }, opts)).toThrow(/choice ではなく/)
    expect(() => validateChoiceAnswer(undefined, opts)).toThrow(SchemaError)
  })

  it('choice が選択肢外なら null（確率分布だけを信用する）', () => {
    const a = validateChoiceAnswer({ choice: 'Z', probabilities: { A: 1 } }, opts)
    expect(a.choice).toBeNull()
  })

  it('confidence は回答内 → providerMetadata の順で拾う', () => {
    expect(validateChoiceAnswer({ probabilities: { A: 1 }, confidence: 0.8 }, opts, '$', 0.1).confidence).toBe(0.8)
    expect(validateChoiceAnswer({ probabilities: { A: 1 } }, opts, '$', 0.1).confidence).toBe(0.1)
  })
})

describe('restrictAndNormalize', () => {
  it('部分集合で再正規化し、全 0 なら一様', () => {
    expect(restrictAndNormalize({ a: 0.4, b: 0.4, draw: 0.2 }, ['a', 'b'])).toEqual({ a: 0.5, b: 0.5 })
    expect(restrictAndNormalize({ a: 0, b: 0, draw: 1 }, ['a', 'b'])).toEqual({ a: 0.5, b: 0.5 })
  })
})

describe('assertBetDecision', () => {
  const obs = slimeMatch()
  it('bet が出場者 id でなければ失敗', () => {
    expect(() => assertBetDecision({ bet: 'monster-z', probabilities: { 'monster-a': 1 }, reason: '' }, obs)).toThrow(SchemaError)
  })
  it('bet の確率が無ければ失敗', () => {
    expect(() => assertBetDecision({ bet: 'monster-b', probabilities: { 'monster-a': 1 }, reason: '' }, obs)).toThrow(SchemaError)
  })
  it('整合していれば通る', () => {
    expect(() => assertBetDecision({ bet: 'monster-a', probabilities: { 'monster-a': 1 }, reason: '' }, obs)).not.toThrow()
  })
})
