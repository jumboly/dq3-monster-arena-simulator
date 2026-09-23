/**
 * vendor/dqbook の txt 群から GameData を組み立てる純粋な変換。
 *
 * ファイル書き出しと分離しているのは、生成スクリプト（build-data.ts）と
 * 検証・一覧スクリプト（list-effective-commands.ts）が同じ変換結果を共有するため。
 * 値の変換規則は dqbook/book/dq3_{monsters,commands,damage,matchmake}.xml の構造体表に従う。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CommandDef,
  CommandFlags,
  DamageDef,
  GameData,
  MatchCardDef,
  MonsterDef,
} from '../../src/core/data/types'
import { createCommandNameResolver, type ParsedCommand } from './commandNames'
import { NA, parseDqbookTable, readBool, readDec, readHex, readHexString, type DqbookTable } from './dqbookTable'

const MONSTER_HEADER = [
  '名前', 'レベル', 'ドラゴン', '（ゾンビ）', '経験値', 'ゴールド', '攻撃力', '守備力', 'パレット', 'すばやさ', 'MP',
  'アイテム', 'スプライト',
  ...range(8).map((k) => `コマンド ${k}`),
  ...range(8).map((k) => `コマンド制約 ${k}`),
  ...range(9).map((k) => `コマンドアニメ ${k}`),
  'コマンド選択判断', 'コマンド決定戦略', 'みかわし', 'アイテム確率', '複数回', '自動回復', '集中攻撃',
  ...range(14).map((k) => `耐性 ${hex2(k)}`),
  'HP', '（メタル）', '（未使用）',
] as const

/**
 * commands.txt のフラグ列名 → CommandFlags のキー。
 *
 * txt の列名は dq3_commands.xml の属性名と一部表記が異なる（括弧内が XML 側の名前とビット位置）。
 * 列の並びは XML のビット配置（#$18 bit6 .. #$1C bit4）と同順であることを確認済み。
 */
const COMMAND_FLAG_COLUMNS: ReadonlyArray<readonly [column: string, key: keyof CommandFlags]> = [
  ['マホトーン考慮', 'considersSilence'], // マホトーン状態を考慮 #$18 & #$40
  ['マホカンタ考慮', 'considersReflect'], // マホカンタ状態を考慮 #$18 & #$80
  ['フバーハ考慮', 'considersFubaha'], // フバーハ状態を考慮 #$19 & #$01
  ['マヌーサ考慮', 'considersManusa'], // マヌーサ状態を考慮 #$19 & #$02
  ['仲間からの攻撃で目が覚める', 'wakesAlly'], // 覚醒考慮 #$19 & #$04
  ['呪い装備考慮', 'damageTransferEquip'], // ダメージ転嫁装備考慮 #$19 & #$08
  ['みかわし考慮', 'considersEvasion'], // #$19 & #$10
  ['バイキルト考慮', 'considersBaikiruto'], // #$19 & #$20
  ['会心の一撃考慮', 'considersCritical'], // #$19 & #$40
  ['集中攻撃考慮', 'considersConcentration'], // #$19 & #$80
  ['空振り時対象再抽選', 'retargetOnWhiff'], // 空振り時対象再抽選考慮 #$1A & #$01
  ['コマンド選択能力考慮', 'considersSelectionJudgment'], // コマンド選択判断考慮 #$1A & #$02
  ['アストロン考慮', 'considersAstron'], // #$1A & #$04
  ['攻撃ミス抽選有効', 'missEquip'], // 攻撃ミス装備考慮 #$1A & #$08
  ['キラー考慮', 'killerEquip'], // キラー装備考慮 #$1A & #$10
  ['どくばりダメージ固定化', 'poisonNeedleFixed'], // #$1A & #$20
  ['どくばり即死考慮', 'instantDeathEquip'], // 即死装備考慮 #$1A & #$40
  ['はやぶさのけん考慮', 'hayabusa'], // #$1A & #$80
  ['経験値取得', 'grantsExp'], // #$1B & #$01
  ['メッセージ抑制', 'suppressMessage'], // #$1B & #$02
  ['演出タイミング', 'effectTiming'], // #$1B & #$04
  ['敵陣全体演出', 'effectWholeEnemySide'], // 演出を敵陣全体に作用させる #$1B & #$08
  ['うんのよさ考慮', 'considersLuck'], // #$1B & #$10
  ['コマンド対象確定考慮（自陣側）', 'fixTargetOwnSide'], // #$1B & #$20
  // 対象生存条件（#$1B & #$C0）は 2 ビット値なので CommandFlags ではなく targetAliveCondition へ
  ['コマンド対象確定考慮（敵陣側）', 'fixTargetEnemySide'], // #$1C & #$01
  ['格闘場許可', 'arenaAllowed'], // 格闘場使用許可 #$1C & #$02
  ['ゴールド取得', 'grantsGold'], // #$1C & #$04
  ['倒した相手を記憶', 'remembersKill'], // 倒した標的を記憶する #$1C & #$08
  ['混乱時通常攻撃化', 'confusedToAttack'], // #$1C & #$10
]

const COMMAND_HEADER = [
  '名前', '対象決定判断 0', '対象決定判断 1', '対象決定判断 2', '効果音？', '戦闘モード', 'メッセージ', '説明',
  '表示エフェクト 0', '表示エフェクト 1', '表示エフェクト 2', 'ダメージ', '打撃ダメージ算出', '移動モード処理',
  '対象範囲', 'MP', '対象分類', '耐性分類', '（調査中）', '成功率係数 0', '成功率係数 1', '戦闘終了時述語',
  ...COMMAND_FLAG_COLUMNS.slice(0, 24).map(([c]) => c),
  '対象生存条件',
  ...COMMAND_FLAG_COLUMNS.slice(24).map(([c]) => c),
] as const

const DAMAGE_HEADER = ['自陣側実行時の下限値', '敵陣側実行時の下限値', '自陣側実行時の上限値', '敵陣側実行時の上限値'] as const

const MATCHMAKE_HEADER = range(4).flatMap((k) => [`モンスター ${k}`, `オッズ ${k}`])

/** dq3_monsters.xml: 160 個 / dq3_commands.xml は個数の明記なし / dq3_damage.xml: 50 個 / 格闘場: 38 試合 */
const MONSTER_COUNT = 160
const DAMAGE_COUNT = 50
const MATCH_CARD_COUNT = 38

export interface BuildResult {
  gameData: GameData
  /** コマンド表の解析結果（原典の名前・メッセージなど GameData 型に載せない情報を含む。検証用） */
  parsedCommands: ParsedCommand[]
}

export function buildGameData(vendorDir: string): BuildResult {
  const read = (rel: string) => readFileSync(join(vendorDir, rel), 'utf8')

  const commandsTable = parseDqbookTable('dq3_C21860_commands.txt', read('data/dq3_C21860_commands.txt'), COMMAND_HEADER)
  const parsedCommands = commandsTable.rows.map((row) => parseCommand(commandsTable, row))
  const resolver = createCommandNameResolver(parsedCommands)
  const commands = parsedCommands.map((c) => ({ ...c.def, name: resolver.displayName(c.def.id) }))

  const monstersTable = parseDqbookTable('dq3_C20000_monsters.txt', read('data/dq3_C20000_monsters.txt'), MONSTER_HEADER)
  if (monstersTable.rows.length !== MONSTER_COUNT) {
    throw new Error(`モンスター数 ${monstersTable.rows.length}（期待値 ${MONSTER_COUNT}）`)
  }
  const monsters = monstersTable.rows.map((row) => parseMonster(monstersTable, row, resolver.resolve))

  const damageTable = parseDqbookTable('dq3_C23BB4_damage.txt', read('data/dq3_C23BB4_damage.txt'), DAMAGE_HEADER)
  if (damageTable.rows.length !== DAMAGE_COUNT) {
    throw new Error(`ダメージ数 ${damageTable.rows.length}（期待値 ${DAMAGE_COUNT}）`)
  }
  // ダメージ表だけは ID 0 のダミー行（n/a）が無く、先頭データ行が ID 0（全 0）
  const damages = damageTable.rows.map((row): DamageDef => ({
    id: row.index,
    // 各値は 10 ビット（#$03FF 等のマスク）。1023 はマジックナンバーとしてそのまま保持する
    pcMin: readDec(damageTable, row, '自陣側実行時の下限値', 1023),
    enemyMin: readDec(damageTable, row, '敵陣側実行時の下限値', 1023),
    pcMax: readDec(damageTable, row, '自陣側実行時の上限値', 1023),
    enemyMax: readDec(damageTable, row, '敵陣側実行時の上限値', 1023),
  }))
  for (const c of commands) {
    if (c.damageId >= damages.length) throw new Error(`コマンド ${c.id}: ダメージ ID ${c.damageId} が範囲外`)
  }

  const matchTable = parseDqbookTable('dq3_C30DC5_matchmake.txt', read('data/dq3_C30DC5_matchmake.txt'), MATCHMAKE_HEADER)
  if (matchTable.rows.length !== MATCH_CARD_COUNT) {
    throw new Error(`試合数 ${matchTable.rows.length}（期待値 ${MATCH_CARD_COUNT}）`)
  }
  const resolveMonster = createMonsterNameResolver(monsters)
  const matchCards = matchTable.rows.map((row) => parseMatchCard(matchTable, row, resolveMonster))

  return {
    gameData: {
      sourceCommit: readSourceCommit(read('SOURCE.md')),
      monsters,
      commands,
      damages,
      matchCards,
    },
    parsedCommands,
  }
}

function parseCommand(t: DqbookTable, row: DqbookTable['rows'][number]): ParsedCommand {
  const flags = Object.fromEntries(COMMAND_FLAG_COLUMNS.map(([column, key]) => [key, readBool(t, row, column)])) as unknown as CommandFlags
  const def: CommandDef = {
    id: row.index,
    // 表示名は名前解決規則が確定してから差し替える（名前 = n/a のものに便宜名を付けるため）
    name: row.get('名前'),
    targetJudgment: [0, 1, 2].map((k) => readHex(t, row, `対象決定判断 ${k}`, 2)),
    soundEffect: readHex(t, row, '効果音？', 2),
    battleHandler: readHexString(t, row, '戦闘モード', 6),
    damageId: readHex(t, row, 'ダメージ', 2),
    hitDamageRecalc: readDec(t, row, '打撃ダメージ算出'),
    targetScope: readDec(t, row, '対象範囲', 3), // #$15 & #$03
    mp: readDec(t, row, 'MP', 63), // #$15 & #$FC
    targetSide: readDec(t, row, '対象分類', 4), // 対象陣営 #$16 & #$07（値の定義は 0..4）
    category: readHex(t, row, '耐性分類', 2), // 系統分類 #$16 & #$F8
    successRate: [readDec(t, row, '成功率係数 0', 15), readDec(t, row, '成功率係数 1', 15)],
    endPredicate: readDec(t, row, '戦闘終了時述語', 3), // #$18 & #$30
    flags,
    targetAliveCondition: readDec(t, row, '対象生存条件', 3), // #$1B & #$C0（定義は 0..2）
  }
  return { def, rawName: row.get('名前'), message: row.get('メッセージ'), description: row.get('説明') }
}

function parseMonster(
  t: DqbookTable,
  row: DqbookTable['rows'][number],
  resolveCommand: (label: string, context: string) => number,
): MonsterDef {
  const name = row.get('名前')
  return {
    id: row.index,
    name,
    level: readDec(t, row, 'レベル', 63), // #$02 & #$3F
    isDragon: readBool(t, row, 'ドラゴン'),
    exp: readDec(t, row, '経験値', 0xffff),
    gold: readDec(t, row, 'ゴールド', 1023), // #$05 & #$03FF
    attack: readDec(t, row, '攻撃力', 1023), // #$06 & #$0FFC
    defense: readDec(t, row, '守備力', 1023), // #$07 & #$3FF0
    agility: readDec(t, row, 'すばやさ', 255),
    mp: readDec(t, row, 'MP', 255),
    maxHp: readDec(t, row, 'HP', 0xffff),
    commands: range(8).map((k) =>
      resolveCommand(row.get(`コマンド ${k}`), `${t.file}:${row.line} ${name} [コマンド ${k}]`),
    ),
    commandConstraints: range(8).map((k) => readBool(t, row, `コマンド制約 ${k}`)),
    selectionJudgment: readDec(t, row, 'コマンド選択判断', 3), // #$1C & #$30
    strategy: readDec(t, row, 'コマンド決定戦略', 3), // #$1C & #$C0
    evasion: readDec(t, row, 'みかわし', 7), // #$1D & #$07
    itemRate: readDec(t, row, 'アイテム確率', 7), // #$1D & #$38
    multiAction: readDec(t, row, '複数回', 3), // #$1D & #$C0
    autoHeal: readDec(t, row, '自動回復', 3), // #$1E & #$03
    // XML 上は 2 ビット（#$1E & #$0C）だが、全データが 0/1 でありブール属性として説明されているため 0/1 以外は拒否する
    concentrate: readBool(t, row, '集中攻撃'),
    resistances: range(14).map((k) => readDec(t, row, `耐性 ${hex2(k)}`, 3)),
    metal: readBool(t, row, '（メタル）'),
  }
}

function createMonsterNameResolver(monsters: readonly MonsterDef[]): (name: string, context: string) => number {
  const byName = new Map<string, number[]>()
  for (const m of monsters) {
    if (m.name === NA) continue
    byName.set(m.name, [...(byName.get(m.name) ?? []), m.id])
  }
  return (name, context) => {
    const ids = byName.get(name)
    if (!ids) throw new Error(`${context}: モンスター名 "${name}" を解決できない`)
    // 同名モンスター（やまたのおろち・ゾーマ・カンダタ・カンダタこぶん）は格闘場には出ないが、
    // 将来の原典改版で出場した場合に黙ってどちらかを選ばないよう失敗させる
    if (ids.length > 1) throw new Error(`${context}: モンスター名 "${name}" は ID [${ids}] に該当し曖昧`)
    return ids[0]
  }
}

function parseMatchCard(
  t: DqbookTable,
  row: DqbookTable['rows'][number],
  resolveMonster: (name: string, context: string) => number,
): MatchCardDef {
  const entries: MatchCardDef['entries'] = []
  let ended = false
  for (const k of range(4)) {
    const name = row.get(`モンスター ${k}`)
    const baseOdds = readDec(t, row, `オッズ ${k}`, 255)
    if (name === NA) {
      // 空き枠（モンスター ID 0）はオッズ 0 で末尾に詰められている前提。崩れていたら解釈を見直す必要がある
      if (baseOdds !== 0) throw new Error(`${t.file}:${row.line}: 空き枠 ${k} のオッズが 0 でない`)
      ended = true
      continue
    }
    if (ended) throw new Error(`${t.file}:${row.line}: 空き枠の後に出場枠 ${k} がある`)
    entries.push({ monsterId: resolveMonster(name, `${t.file}:${row.line} [モンスター ${k}]`), baseOdds })
  }
  if (entries.length < 2) throw new Error(`${t.file}:${row.line}: 出場が 2 体未満`)
  return { index: row.index, entries }
}

function readSourceCommit(sourceMd: string): string {
  const m = /Commit:\s*`([0-9a-f]{40})`/.exec(sourceMd)
  if (!m) throw new Error('vendor/dqbook/SOURCE.md からコミット ID を読めない')
  return m[1]
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0')
}
