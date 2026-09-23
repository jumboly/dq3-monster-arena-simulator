import { describe, expect, it } from 'vitest'
import { API_KEY_STORAGE_KEY, clearApiKey, hasApiKey, loadApiKey, maskApiKey, saveApiKey } from '../../src/storage/apiKey'
import type { KeyValueStorage } from '../../src/storage/apiKey'
import { FAKE_KEY } from './fixtures'

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('quota', 'QuotaExceededError')
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError')
  },
}

describe('apiKey storage', () => {
  it('保存・読込・削除（キー名は dq3arena.aiGatewayApiKey）', () => {
    const s = memoryStorage()
    expect(hasApiKey(s)).toBe(false)
    expect(saveApiKey(`  ${FAKE_KEY}\n`, s)).toBe(true)
    expect(s.data.get(API_KEY_STORAGE_KEY)).toBe(FAKE_KEY)
    expect(API_KEY_STORAGE_KEY).toBe('dq3arena.aiGatewayApiKey')
    expect(loadApiKey(s)).toBe(FAKE_KEY)
    expect(hasApiKey(s)).toBe(true)
    expect(clearApiKey(s)).toBe(true)
    expect(loadApiKey(s)).toBeNull()
  })

  it('空文字の保存は削除として扱う', () => {
    const s = memoryStorage()
    saveApiKey(FAKE_KEY, s)
    expect(saveApiKey('   ', s)).toBe(true)
    expect(hasApiKey(s)).toBe(false)
  })

  it('localStorage が例外を投げても落ちない', () => {
    expect(loadApiKey(throwing)).toBeNull()
    expect(saveApiKey(FAKE_KEY, throwing)).toBe(false)
    expect(clearApiKey(throwing)).toBe(false)
    expect(hasApiKey(throwing)).toBe(false)
  })

  it('既定ストレージ（実行環境の localStorage。node では無いか使えない）でも例外にならない', () => {
    // 実行環境の localStorage を汚さないため読み出しだけ確かめる
    expect(() => loadApiKey()).not.toThrow()
    expect(() => hasApiKey()).not.toThrow()
  })

  it('maskApiKey は末尾 4 文字以外を見せない', () => {
    const m = maskApiKey(FAKE_KEY)
    expect(m).toBe('••••7890')
    expect(m).not.toContain('TEST_SECRET')
    expect(maskApiKey('short')).toBe('••••')
    expect(maskApiKey(null)).toBe('')
  })
})
