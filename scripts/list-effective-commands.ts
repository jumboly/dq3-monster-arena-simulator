/**
 * `npx tsx scripts/list-effective-commands.ts`
 *
 * 試合 1..37（index 0..36）の出場モンスターが持つコマンドを集め、
 * 格闘場使用許可 = 0 のものを通常攻撃に置き換えた「実効コマンド一覧」を
 * docs/research/effective-commands-1-37.md に書き出す。
 *
 * Battle Core が実装すべきコマンドの範囲を、手作業の想定ではなくデータから確定させるため。
 * 試合 38（あやしいかげ）は出場モンスターが戦闘開始時に決まる別扱い（Phase B）なので対象外。
 * 生成済み JSON ではなく vendor から直接組み立てるのは、`npm run data` の実行順に依存させないため。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORY_LABELS, TARGET_SCOPE_LABELS, TARGET_SIDE_LABELS } from '../src/core/data/labels'
import type { CommandDef, GameData } from '../src/core/data/types'
import { buildGameData } from './lib/buildGameData'
import { AMBIGUOUS_NAME_CHOICES, LABEL_RULES } from './lib/commandNames'

const NORMAL_ATTACK_COMMAND_ID = 1
const PHASE_A_CARD_COUNT = 37

/**
 * 当初想定されていた実効コマンド（依頼時のリスト）。モンスター表の表記に揃えてある
 * （例: 想定の「ベギラマ」は原典では「べギラマ」、「痛恨」は「（痛恨の一撃）」）。
 */
const EXPECTED_LABELS = [
  'こうげき', '（痛恨の一撃）', '（どくこうげき）', '（まひこうげき）', '（ねむりこうげき）', 'ぼうぎょ',
  '（様子を見る）', '（にげる）', '（ふしぎなおどり）', 'メラ', 'メラミ', 'ギラ', 'べギラマ', 'ヒャド', 'マヒャド',
  'バギ', 'ホイミ', 'べホイミ', 'べホマ', 'ラリホー', 'マホトーン', 'マヌーサ', 'メダパニ', 'ルカナン', 'ボミオス',
  'スクルト', 'マホトラ', 'ザキ', 'ザラキ', 'バシルーラ', '（ひのいき）', '（かえん）', '（つめたいいき）',
  '（こおりのいき）', '（どくのいき）', '（あまいいき）', '（やけつくいき）', 'メガンテ',
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'docs/research/effective-commands-1-37.md')

const { gameData } = buildGameData(join(root, 'vendor/dqbook'))
const report = analyze(gameData)
writeFileSync(ensureDir(outFile), render(gameData, report))
console.log(`${relative(root, outFile)} を書き出した`)
console.log(`  出場モンスター: ${report.monsterIds.length} 種`)
console.log(`  実効コマンド: ${report.effective.length} 種（置換で消えるコマンド ${report.forbidden.length} 種）`)
console.log(`  想定にあって実データに無い: ${report.missingFromData.join(' / ') || 'なし'}`)
console.log(`  実データにあって想定に無い: ${report.extraInData.join(' / ') || 'なし'}`)

interface Usage {
  command: CommandDef
  /** このコマンドを（置換前・置換後いずれかの意味で）使うモンスター ID 一覧 */
  monsterIds: Set<number>
  /** 置換で由来したコマンド ID（通常攻撃の出現元の内訳用） */
  replacedFrom: Set<number>
}

interface Report {
  monsterIds: number[]
  effective: Usage[]
  forbidden: Usage[]
  missingFromData: string[]
  extraInData: string[]
}

function analyze(data: GameData): Report {
  const monsterIds = [
    ...new Set(data.matchCards.slice(0, PHASE_A_CARD_COUNT).flatMap((c) => c.entries.map((e) => e.monsterId))),
  ].sort((a, b) => a - b)

  const effective = new Map<number, Usage>()
  const forbidden = new Map<number, Usage>()
  const touch = (m: Map<number, Usage>, id: number) => {
    let u = m.get(id)
    if (!u) m.set(id, (u = { command: data.commands[id], monsterIds: new Set(), replacedFrom: new Set() }))
    return u
  }
  for (const mid of monsterIds) {
    for (const cid of data.monsters[mid].commands) {
      const cmd = data.commands[cid]
      if (cmd.flags.arenaAllowed) {
        touch(effective, cid).monsterIds.add(mid)
      } else {
        touch(forbidden, cid).monsterIds.add(mid)
        const u = touch(effective, NORMAL_ATTACK_COMMAND_ID)
        u.monsterIds.add(mid)
        u.replacedFrom.add(cid)
      }
    }
  }
  const byId = (a: Usage, b: Usage) => a.command.id - b.command.id
  const effectiveList = [...effective.values()].sort(byId)
  const effectiveNames = new Set(effectiveList.map((u) => u.command.name))
  return {
    monsterIds,
    effective: effectiveList,
    forbidden: [...forbidden.values()].sort(byId),
    missingFromData: EXPECTED_LABELS.filter((l) => !effectiveNames.has(l)),
    extraInData: effectiveList.map((u) => u.command.name).filter((n) => !EXPECTED_LABELS.includes(n)),
  }
}

function render(data: GameData, r: Report): string {
  const monsterNames = (ids: Iterable<number>) =>
    [...ids].sort((a, b) => a - b).map((id) => data.monsters[id].name).join('、')
  const damageText = (c: CommandDef) => {
    if (c.damageId === 0) return '0'
    const d = data.damages[c.damageId]
    // 格闘場の出場者は全員敵陣側（グループ 0..3）なので、敵陣側実行時の値を併記する
    return `${c.damageId}（敵 ${d.enemyMin}–${d.enemyMax}）`
  }
  const cat = (c: CommandDef) => `${CATEGORY_LABELS[c.category] ?? '?'}（#$${hex2(c.category)}）`
  const fidelityOf = (c: CommandDef) => {
    const rule = LABEL_RULES.find((x) => x.commandId === c.id)
    if (rule) return rule.fidelity
    if (AMBIGUOUS_NAME_CHOICES.some((x) => x.commandId === c.id)) return 'unknown（同名変種）'
    return 'confirmed'
  }

  const lines: string[] = []
  lines.push('# 試合 1～37 の実効コマンド一覧')
  lines.push('')
  lines.push('> 自動生成: `npx tsx scripts/list-effective-commands.ts`。手で編集しないこと。')
  lines.push(`> 出典: showa-yojyo/dqbook \`${data.sourceCommit}\`（vendor/dqbook）`)
  lines.push('')
  lines.push('## 方法')
  lines.push('')
  lines.push(`- 試合 1～${PHASE_A_CARD_COUNT}（index 0..${PHASE_A_CARD_COUNT - 1}）に直接登場するモンスター **${r.monsterIds.length} 種** のコマンド 0..7 を集計。`)
  lines.push('- 格闘場使用許可 = 0 のコマンドは通常攻撃（ID 1）に置換（dq3_commands.xml「格闘場使用許可」）。')
  lines.push('- 試合 38（あやしいかげ）は対象外（Phase B）。')
  lines.push('- 名前 = n/a のコマンドは dqbook モンスター表の便宜名（括弧付き）で示す。名前解決の根拠は `scripts/lib/commandNames.ts`。')
  lines.push('- 「解決」列: confirmed = データ/逆アセンブルで一意、likely = 資料から強く示唆、unknown = 同名変種のうち代表 ID を暫定採用。')
  lines.push('')
  lines.push(`## 実効コマンド（${r.effective.length} 種）`)
  lines.push('')
  lines.push('| ID | 名前 | 対象範囲 | 対象陣営 | 系統 | MP | ダメージID | 解決 | 出現モンスター |')
  lines.push('|---:|---|---|---|---|---:|---|---|---|')
  for (const u of r.effective) {
    const c = u.command
    let who = monsterNames(u.monsterIds)
    if (u.replacedFrom.size > 0) {
      who += `（うち置換由来: ${[...u.replacedFrom].sort((a, b) => a - b).map((id) => data.commands[id].name).join('・')}）`
    }
    lines.push(
      `| ${c.id} | ${c.name} | ${TARGET_SCOPE_LABELS[c.targetScope]} | ${TARGET_SIDE_LABELS[c.targetSide]} | ${cat(c)} | ${c.mp} | ${damageText(c)} | ${fidelityOf(c)} | ${who} |`,
    )
  }
  lines.push('')
  lines.push(`## 格闘場で禁止され通常攻撃に置換されるコマンド（${r.forbidden.length} 種）`)
  lines.push('')
  lines.push('| ID | 名前 | 置換先 | 解決 | 出現モンスター |')
  lines.push('|---:|---|---|---|---|')
  for (const u of r.forbidden) {
    const c = u.command
    lines.push(`| ${c.id} | ${c.name} | ${NORMAL_ATTACK_COMMAND_ID} ${data.commands[NORMAL_ATTACK_COMMAND_ID].name} | ${fidelityOf(c)} | ${monsterNames(u.monsterIds)} |`)
  }
  lines.push('')
  lines.push('## 当初想定との差分')
  lines.push('')
  lines.push(`- 想定にあって実効一覧に無い: ${r.missingFromData.join('、') || 'なし'}`)
  lines.push(`- 実効一覧にあって想定に無い: ${r.extraInData.join('、') || 'なし'}`)
  lines.push('')
  lines.push('## 同名コマンドの暫定解決（Unknown）')
  lines.push('')
  lines.push('モンスター表は名前しか持たず、同名の変種（対象陣営・対象決定判断のみ異なる）のどれを使うかは原典から判別できない。')
  lines.push('「説明」列を持つ代表 ID を暫定採用している。')
  lines.push('')
  lines.push('| 名前 | 採用 ID | 候補 ID（対象陣営） |')
  lines.push('|---|---:|---|')
  for (const a of AMBIGUOUS_NAME_CHOICES) {
    const cands = a.candidates.map((id) => `${id}（${TARGET_SIDE_LABELS[data.commands[id].targetSide]}）`).join(' / ')
    lines.push(`| ${a.name} | ${a.commandId} | ${cands} |`)
  }
  lines.push('')
  lines.push('## 出場モンスター（試合 1～37）')
  lines.push('')
  lines.push(r.monsterIds.map((id) => `${id} ${data.monsters[id].name}`).join(' / '))
  lines.push('')
  return lines.join('\n')
}

function ensureDir(file: string): string {
  mkdirSync(dirname(file), { recursive: true })
  return file
}

function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0')
}
