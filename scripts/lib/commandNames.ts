/**
 * モンスター表（dq3_C20000_monsters.txt）のコマンド欄に書かれた「名前」を
 * コマンド ID に解決するための規則。
 *
 * 背景: モンスター表のコマンド欄は ID ではなく名前で書かれている。
 * - 名前文字列を持つコマンド（呪文など）は、コマンド表の「名前」列と同じ文字列で書かれる。
 * - 名前文字列を持たないコマンド（コマンド表で名前 = n/a）は、dqbook 作者が付けた
 *   括弧付きの便宜名（例 `（にげる）`）か、PC 用コマンド名（`こうげき` `ぼうぎょ`）で書かれる。
 *   これらはコマンド表側には現れないので、ここで ID との対応を明示する。
 * - 同じ名前文字列を持つコマンドが複数ある（例 ホイミ = 31/32/33/166）ため、
 *   名前だけでは一意に決まらないものがある。その選び方もここで明示する。
 *
 * 対応は推測で増やさない。各規則は根拠と、データ側の検証条件（verify）を持ち、
 * 検証に失敗したらビルドを止める（原典の改版で対応がずれたことに気付くため）。
 */
import type { CommandDef } from '../../src/core/data/types'
import type { Fidelity } from '../../src/core/fidelity'

/** 規則の検証に使う、コマンド表 1 行分の解析結果 */
export interface ParsedCommand {
  def: CommandDef
  /** コマンド表の「名前」列そのまま（n/a を含む） */
  rawName: string
  /** 「メッセージ」列（戦闘時最初に表示される文） */
  message: string
  /** 「説明」列（呪文選択時の記述。PC が選べる呪文にだけある） */
  description: string
}

export interface LabelRule {
  /** モンスター表に現れる表記 */
  label: string
  commandId: number
  fidelity: Extract<Fidelity, 'confirmed' | 'likely'>
  evidence: string
  verify: (c: ParsedCommand) => boolean
  /**
   * verify を満たす名前なしコマンドが commandId ただ 1 つであることも検査するか（既定 true）。
   * 「この条件を満たすのはこの ID のみ」を根拠にする規則で、その前提自体を機械的に保証するため。
   * 逆アセンブル等の外部根拠で区別している規則だけ false にする。
   */
  unique?: boolean
}

const hasMessage = (s: string) => (c: ParsedCommand) => c.message.includes(s)
const ATTACK_MESSAGE = '[BC][B7]の こうげき！[B1]'
const CALL_MESSAGE = '[BC][B7]は なかまを よんだ！[B1]'

/**
 * コマンド表で名前 = n/a のコマンドに対する、モンスター表側の表記との対応。
 *
 * 根拠の略記:
 * - RGH nnn = research/README.md の RetroGameHackers「DQ3戦闘部分解説」第 nnn 回
 * - 系統分類 = dq3_commands.xml「系統分類」表
 */
export const LABEL_RULES: readonly LabelRule[] = [
  {
    label: 'こうげき',
    commandId: 1,
    fidelity: 'confirmed',
    evidence:
      'RGH 008 $025F50「直接攻撃戦闘行動ID LDA #$0001」、RGH 011 $02679D「行動が決められない場合は直接攻撃 LDA #$0001」。' +
      'メッセージ「こうげき！」を持つ 1..5,172,173 のうち系統分類 0・単体で痛恨でないもの',
    verify: (c) => c.message === ATTACK_MESSAGE && c.def.category === 0 && c.def.targetScope === 1,
    unique: false,
  },
  {
    label: '（痛恨の一撃）',
    commandId: 2,
    fidelity: 'confirmed',
    evidence: 'RGH 020 $0290D1「CMP #$0002 戦闘行動が「つうこん」か」',
    verify: (c) => c.message === ATTACK_MESSAGE && c.def.category === 0 && c.def.targetScope === 1,
    unique: false,
  },
  {
    label: '（ねむりこうげき）',
    commandId: 3,
    fidelity: 'confirmed',
    evidence: '通常攻撃メッセージかつ系統分類 #$15（眠り攻撃）はこの ID のみ',
    verify: (c) => c.message === ATTACK_MESSAGE && c.def.category === 0x15,
  },
  {
    label: '（どくこうげき）',
    commandId: 4,
    fidelity: 'confirmed',
    evidence: '通常攻撃メッセージかつ系統分類 #$16（毒攻撃）はこの ID のみ',
    verify: (c) => c.message === ATTACK_MESSAGE && c.def.category === 0x16,
  },
  {
    label: '（まひこうげき）',
    commandId: 5,
    fidelity: 'confirmed',
    evidence: '通常攻撃メッセージかつ系統分類 #$17（マヒ攻撃）はこの ID のみ',
    verify: (c) => c.message === ATTACK_MESSAGE && c.def.category === 0x17,
  },
  {
    label: '（ひのいき）',
    commandId: 87,
    fidelity: 'confirmed',
    evidence: 'メッセージ「ひの いきを はきだした」はこの ID のみ',
    verify: hasMessage('ひの いきを はきだした'),
  },
  {
    label: '（かえん）',
    commandId: 88,
    fidelity: 'confirmed',
    evidence:
      'メッセージ「もえさかる かえんをはいた」は 88 と 170。170 は系統分類 #$13（ドラゴラム）なので、' +
      '系統分類 #$0F（炎）の 88 を採る',
    verify: (c) => hasMessage('もえさかる かえんをはいた')(c) && c.def.category === 0x0f,
  },
  {
    label: '（はげしいほのお）',
    commandId: 89,
    fidelity: 'confirmed',
    evidence: 'メッセージ「はげしいほのおを はいた」はこの ID のみ',
    verify: hasMessage('はげしいほのおを はいた'),
  },
  {
    label: '（しゃくねつ）',
    commandId: 269,
    fidelity: 'confirmed',
    evidence: 'メッセージ「しゃくねつの ほのおを はいた」はこの ID のみ',
    verify: hasMessage('しゃくねつの ほのおを はいた'),
  },
  {
    label: '（つめたいいき）',
    commandId: 90,
    fidelity: 'confirmed',
    evidence: 'メッセージ「つめたい いきをはきだした」はこの ID のみ',
    verify: hasMessage('つめたい いきをはきだした'),
  },
  {
    label: '（こおりのいき）',
    commandId: 91,
    fidelity: 'confirmed',
    evidence: 'メッセージ「こおりつく いきを はいた」はこの ID のみ（吹雪系で 90 と 92 の間の威力）',
    verify: hasMessage('こおりつく いきを はいた'),
  },
  {
    label: '（こごえるふぶき）',
    commandId: 92,
    fidelity: 'confirmed',
    evidence: 'メッセージ「こごえる ふぶきを はいた」はこの ID のみ',
    verify: hasMessage('こごえる ふぶきを はいた'),
  },
  {
    label: '（どくのいき）',
    commandId: 93,
    fidelity: 'confirmed',
    evidence: 'メッセージ「どくのいきを はいた」はこの ID のみ',
    verify: hasMessage('どくのいきを はいた'),
  },
  {
    label: '（あまいいき）',
    commandId: 94,
    fidelity: 'confirmed',
    evidence: 'メッセージ「あまい いきを はいた」はこの ID のみ',
    verify: hasMessage('あまい いきを はいた'),
  },
  {
    label: '（やけつくいき）',
    commandId: 95,
    fidelity: 'confirmed',
    evidence: 'メッセージ「やけつくいきを はいた」はこの ID のみ',
    verify: hasMessage('やけつくいきを はいた'),
  },
  // 仲間呼び 96..101: 6 つともメッセージ・属性がほぼ同一で、データだけでは呼ぶ種類を区別できない。
  // RGH 023 の「戦闘行動実行後の追加処理」対象リスト（$028AAB）が
  // 同種→ホイミスライム→だいまじん→くさったしたい→ごくらくちょう→ゾンビマスター の順で並び、
  // 対象決定判断 0 が 96 だけ異なる（#$00、他は #$42）ことから、96 を同種、以降をリスト順と対応させた。
  // リストの並びと ID 順の一致は逆アセンブルで確認していないので likely とする。
  {
    label: '（仲間呼び）',
    commandId: 96,
    fidelity: 'likely',
    evidence: 'RGH 023 追加処理リスト「08 仲間呼び(同種)」。対象決定判断 0 = #$00 は 96 のみ',
    verify: (c) => c.message === CALL_MESSAGE && c.def.targetJudgment[0] === 0x00,
  },
  ...(
    [
      ['（ホイミスライム呼び）', 97],
      ['（だいまじん呼び）', 98],
      ['（くさったしたい呼び）', 99],
      ['（ごくらくちょう呼び）', 100],
      ['（ゾンビマスター呼び）', 101],
    ] as const
  ).map(
    ([label, commandId]): LabelRule => ({
      label,
      commandId,
      fidelity: 'likely',
      evidence: 'RGH 023 追加処理リスト 09..0D（ホイミスライム/だいまじん/くさったしたい/ごくらくちょう/ゾンビマスター）の順を 97..101 に対応',
      verify: (c) => c.message === CALL_MESSAGE && c.def.targetJudgment[0] === 0x42,
      unique: false,
    }),
  ),
  {
    label: '（ふしぎなおどり）',
    commandId: 102,
    fidelity: 'confirmed',
    evidence: 'メッセージ「ふしぎなおどりを おどった」はこの ID のみ',
    verify: hasMessage('ふしぎなおどりを おどった'),
  },
  {
    label: '（いてつくはどう）',
    commandId: 103,
    fidelity: 'confirmed',
    evidence: 'メッセージ「いてつく はどうが ほとばしった」はこの ID のみ',
    verify: hasMessage('いてつく はどうが ほとばしった'),
  },
  {
    label: 'ぼうぎょ',
    commandId: 104,
    fidelity: 'confirmed',
    evidence:
      'メッセージ「みをまもっている。」はこの ID のみ。同じ処理アドレス C29F4A の 178 は' +
      '「いうことを きかず…」で遊び人の遊び',
    verify: (c) => c.message === '[BC][B7]は みをまもっている。[B1]',
  },
  {
    label: '（様子を見る）',
    commandId: 105,
    fidelity: 'confirmed',
    evidence: 'メッセージ「ようすを みている。」はこの ID のみ（179「なにも せず…」は遊び人の遊び）',
    verify: (c) => c.message === '[BC][B7]は ようすを みている。[B1]',
  },
  {
    label: '（にげる）',
    commandId: 106,
    fidelity: 'likely',
    evidence:
      '戦闘終了時述語 1（「[B7]は にげだした！」）・対象陣営 1（自身）で、処理アドレス C29F5A は' +
      '離脱系（82: 述語 2「さっていった」、遊び人 200/209）と共通。' +
      'メッセージ「いきなり にげだした」の 181 は遊び人の遊びの ID 帯（178..221）にあり、処理アドレスも' +
      '何もしない C28DA7 なので除外。また全 274 コマンド中で格闘場使用許可 = 0 なのは 0（空）・仲間呼び 96..101・' +
      '106 だけで、「格闘場では仲間呼びと逃走を禁じる」という設計と整合する。逃走処理本体の逆アセンブルは未確認',
    verify: (c) =>
      c.rawName === 'n/a' && c.def.endPredicate === 1 && c.def.targetSide === 1 && c.def.battleHandler === 'C29F5A',
  },
  {
    label: '（にらみつける）',
    commandId: 270,
    fidelity: 'confirmed',
    evidence: 'メッセージ「にらみつけた」はこの ID のみ',
    verify: hasMessage('にらみつけた'),
  },
  {
    label: '（かみくだく）',
    commandId: 271,
    fidelity: 'confirmed',
    evidence: 'メッセージ「するどいキバで…かみくだいたっ」はこの ID のみ',
    verify: hasMessage('かみくだいたっ'),
  },
  {
    label: '（のしかかる）',
    commandId: 272,
    fidelity: 'confirmed',
    evidence: 'メッセージ「のしかかってきたっ」はこの ID のみ',
    verify: hasMessage('のしかかってきたっ'),
  },
]

/**
 * 同じ名前文字列を持つコマンドが複数あるときの選択。
 *
 * 例: ホイミは 31/32/33/166 の 4 つ。31/33 は対象陣営 2（自グループ）、32 は 1（自身）、
 * 166 は対象陣営 3・処理アドレス C28E66（ダメージ系）で、MP・ダメージ・系統・格闘場許可は 31..33 で同一。
 * モンスター表は名前しか持たず、原典からはどの変種を使うか判別できない（Unknown）。
 * そこで「説明」列を持つ（= PC の呪文一覧に載る代表の）ID を暫定採用する。
 * 実機が別変種を使う場合、差は対象選択（対象決定判断・対象陣営）に限られる。
 */
export interface AmbiguousNameChoice {
  name: string
  commandId: number
  candidates: readonly number[]
  fidelity: Extract<Fidelity, 'unknown'>
}

export const AMBIGUOUS_NAME_CHOICES: readonly AmbiguousNameChoice[] = [
  { name: 'ホイミ', commandId: 31, candidates: [31, 32, 33, 166], fidelity: 'unknown' },
  { name: 'べホイミ', commandId: 34, candidates: [34, 35, 36, 167], fidelity: 'unknown' },
  { name: 'べホマ', commandId: 37, candidates: [37, 38, 39, 168], fidelity: 'unknown' },
  { name: 'べホマラー', commandId: 40, candidates: [40, 41, 42], fidelity: 'unknown' },
  { name: 'スカラ', commandId: 55, candidates: [55, 56, 57], fidelity: 'unknown' },
  { name: 'スクルト', commandId: 58, candidates: [58, 59, 60, 61], fidelity: 'unknown' },
]

/**
 * 同名コマンドのモンスター別の上書き（AMBIGUOUS_NAME_CHOICES より優先）。
 *
 * dqwiz「SFC/GBC モンスターの行動」は回復呪文を「（自分）」「（仲間）」と使い手ごとに区別しており、
 * 「自分」はコマンド表で対象陣営 1（自身）の変種 32/35/38 だけに当てはまる（構造が一致する）。
 * 生の ID を ROM で確かめたわけではないので Likely。スクルト（全）= 61 は格闘場での「全体」の
 * 意味が決まらないため上書きせず、代表 ID のまま（docs/research/fidelity-review.md #11）。
 */
export interface MonsterCommandOverride {
  monster: string
  name: string
  commandId: number
  fidelity: Extract<Fidelity, 'likely'>
}

export const MONSTER_COMMAND_OVERRIDES: readonly MonsterCommandOverride[] = [
  { monster: 'わらいぶくろ', name: 'ホイミ', commandId: 32, fidelity: 'likely' },
  { monster: 'マージマタンゴ', name: 'ホイミ', commandId: 32, fidelity: 'likely' },
  { monster: 'バーナバス', name: 'べホイミ', commandId: 35, fidelity: 'likely' },
  { monster: 'まほうおばば', name: 'べホイミ', commandId: 35, fidelity: 'likely' },
  { monster: 'エビルマージ', name: 'べホマ', commandId: 38, fidelity: 'likely' },
]

/** モンスター表で `n/a` と書かれたコマンド欄。ID 0（全属性 0 の空コマンド）に対応させる */
export const NULL_COMMAND_ID = 0

export interface CommandNameResolver {
  /** monster を渡すと MONSTER_COMMAND_OVERRIDES を優先する */
  resolve(label: string, context: string, monster?: string): number
  /** 表示名。名前 = n/a のコマンドには規則の表記（括弧付き便宜名）を与える */
  displayName(commandId: number): string
}

export function createCommandNameResolver(commands: readonly ParsedCommand[]): CommandNameResolver {
  const byName = new Map<string, number[]>()
  for (const c of commands) {
    if (c.rawName === 'n/a') continue
    const ids = byName.get(c.rawName) ?? []
    ids.push(c.def.id)
    byName.set(c.rawName, ids)
  }

  const labelMap = new Map<string, number>()
  const labelById = new Map<number, string>()
  for (const rule of LABEL_RULES) {
    const c = commands[rule.commandId]
    if (!c) throw new Error(`規則 ${rule.label}: コマンド ID ${rule.commandId} が存在しない`)
    // 便宜名は名前文字列を持たないコマンドにだけ付ける。名前を持つなら名前で引けるはずなので規則が誤り
    if (c.rawName !== 'n/a') throw new Error(`規則 ${rule.label}: ID ${rule.commandId} は名前 "${c.rawName}" を持つ`)
    if (!rule.verify(c)) throw new Error(`規則 ${rule.label}: ID ${rule.commandId} がデータ側の検証条件を満たさない`)
    if (rule.unique !== false) {
      const matched = commands.filter((x) => x.rawName === 'n/a' && rule.verify(x)).map((x) => x.def.id)
      if (matched.length !== 1) throw new Error(`規則 ${rule.label}: 検証条件が一意でない（該当 ID [${matched}]）`)
    }
    if (byName.has(rule.label)) throw new Error(`規則 ${rule.label}: 同名のコマンド名が存在し曖昧`)
    if (labelMap.has(rule.label) || labelById.has(rule.commandId)) {
      throw new Error(`規則 ${rule.label}: 表記または ID が重複`)
    }
    labelMap.set(rule.label, rule.commandId)
    labelById.set(rule.commandId, rule.label)
  }

  const ambiguousMap = new Map<string, number>()
  for (const choice of AMBIGUOUS_NAME_CHOICES) {
    const ids = byName.get(choice.name) ?? []
    // 候補集合が原典と一致しない = 原典が変わったか規則が古い。黙って使い続けない
    if (ids.join(',') !== choice.candidates.join(',')) {
      throw new Error(`同名規則 ${choice.name}: 候補 [${choice.candidates}] が実データ [${ids}] と一致しない`)
    }
    if (commands[choice.commandId].description === 'n/a') {
      throw new Error(`同名規則 ${choice.name}: 採用 ID ${choice.commandId} が説明列を持たない`)
    }
    ambiguousMap.set(choice.name, choice.commandId)
  }

  const overrideMap = new Map<string, number>()
  for (const o of MONSTER_COMMAND_OVERRIDES) {
    const ids = byName.get(o.name) ?? []
    // 候補外の ID を指す上書きは、原典の改版か規則の書き間違い
    if (!ids.includes(o.commandId)) throw new Error(`上書き ${o.monster} ${o.name}: ID ${o.commandId} は候補 [${ids}] に無い`)
    overrideMap.set(`${o.monster}\t${o.name}`, o.commandId)
  }

  return {
    resolve(label, context, monster) {
      if (label === 'n/a') return NULL_COMMAND_ID
      const overridden = monster === undefined ? undefined : overrideMap.get(`${monster}\t${label}`)
      if (overridden !== undefined) return overridden
      const byLabel = labelMap.get(label)
      if (byLabel !== undefined) return byLabel
      const ids = byName.get(label)
      if (!ids) throw new Error(`${context}: コマンド名 "${label}" を解決できない`)
      if (ids.length === 1) return ids[0]
      const chosen = ambiguousMap.get(label)
      if (chosen === undefined) {
        throw new Error(`${context}: コマンド名 "${label}" は ID [${ids}] に該当し曖昧。AMBIGUOUS_NAME_CHOICES に規則が必要`)
      }
      return chosen
    },
    displayName(commandId) {
      return labelById.get(commandId) ?? commands[commandId].rawName
    },
  }
}
