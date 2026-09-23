/**
 * 生成パイプライン（scripts/lib）の検証。
 * 書式違反や名前解決不能を黙って通さないこと、生成物が最新であることを確かめる。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGameData } from '../../scripts/lib/buildGameData'
import { createCommandNameResolver, LABEL_RULES } from '../../scripts/lib/commandNames'
import { parseDqbookTable, readBool, readDec, readHex } from '../../scripts/lib/dqbookTable'

const root = join(__dirname, '../..')

describe('dqbookTable', () => {
  const t = parseDqbookTable('x.txt', 'a:b:c\n0F:12:1\n', ['a', 'b', 'c'])
  const row = t.rows[0]

  it('固定桁 16 進・10 進・ブールを読む', () => {
    expect(readHex(t, row, 'a', 2)).toBe(15)
    expect(readDec(t, row, 'b')).toBe(12)
    expect(readBool(t, row, 'c')).toBe(true)
  })

  it('書式違反は例外（16 進列の桁違い、10 進列の先頭 0、ビット幅超過）', () => {
    expect(() => readHex(t, row, 'b', 4)).toThrow()
    expect(() => readDec(t, row, 'a')).toThrow()
    expect(() => readDec(t, row, 'b', 7)).toThrow()
    expect(() => readBool(t, row, 'b')).toThrow()
  })

  it('ヘッダ不一致・列数不一致は例外', () => {
    expect(() => parseDqbookTable('x.txt', 'a:b\n1:2\n', ['a', 'c'])).toThrow()
    expect(() => parseDqbookTable('x.txt', 'a:b\n1\n', ['a', 'b'])).toThrow()
  })
})

describe('コマンド名解決', () => {
  const { gameData, parsedCommands } = buildGameData(join(root, 'vendor/dqbook'))
  const resolver = createCommandNameResolver(parsedCommands)

  it('名前・便宜名・n/a を ID に解決し、未知の名前は例外', () => {
    expect(resolver.resolve('n/a', 'test')).toBe(0)
    expect(resolver.resolve('メラ', 'test')).toBe(6)
    expect(resolver.resolve('（痛恨の一撃）', 'test')).toBe(2)
    expect(resolver.resolve('ホイミ', 'test')).toBe(31)
    expect(() => resolver.resolve('（存在しない）', 'test')).toThrow(/解決できない/)
    // 同名規則の無い重複名（やくそう = 131/169）は黙って選ばず曖昧として失敗する
    expect(() => resolver.resolve('やくそう', 'test')).toThrow(/曖昧/)
  })

  it('便宜名規則はすべてモンスター表で使われている（死んだ規則を残さない）', () => {
    const used = new Set(gameData.monsters.flatMap((m) => m.commands))
    for (const rule of LABEL_RULES) expect(used.has(rule.commandId), rule.label).toBe(true)
  })
})

describe('生成物', () => {
  it('src/data/generated/game-data.json は vendor から再生成した結果と一致する', () => {
    const generated = JSON.parse(readFileSync(join(root, 'src/data/generated/game-data.json'), 'utf8'))
    expect(generated).toEqual(buildGameData(join(root, 'vendor/dqbook')).gameData)
  })
})
