/**
 * ROM 解析資料（showa-yojyo/dqbook の data/*.txt）から機械変換したデータの型。
 *
 * 生成物（src/data/generated/*.json）はリポジトリに含めず、scripts/ がビルド時に
 * 固定コミットの dqbook から取得して生成する。手入力の重複を避け、出典を一意にするため。
 * フィールドは原典の属性名に 1 対 1 で対応させ、解釈はここではなく Battle Core で行う。
 */

/** $C20000 モンスター構造体（#$25 バイト × 160） */
export interface MonsterDef {
  /** 配列添字 = モンスター ID */
  id: number
  name: string
  level: number
  isDragon: boolean
  exp: number
  gold: number
  attack: number
  defense: number
  agility: number
  /** 255 は「MP が減らない」マジックナンバー（戦闘員 MP を 65535 で初期化） */
  mp: number
  maxHp: number
  /** コマンド 0..7 のコマンド ID */
  commands: number[]
  /** コマンド制約 0..7（同一グループ内で先約済みなら選ばない） */
  commandConstraints: boolean[]
  /** コマンド選択判断 0..2（コマンドの対象決定判断 k の添字） */
  selectionJudgment: number
  /** コマンド決定戦略 0..3 */
  strategy: number
  /** みかわし 0..7 */
  evasion: number
  itemRate: number
  /** 複数回 0..3 */
  multiAction: number
  /** 自動回復 0..3 */
  autoHeal: number
  /** 集中攻撃 */
  concentrate: boolean
  /** 耐性 #$00..#$0D（各 0..3） */
  resistances: number[]
  metal: boolean
}

/** $C21860 コマンド構造体 */
export interface CommandDef {
  /** 配列添字 = コマンド ID */
  id: number
  name: string
  /** 対象決定判断 0..2（コマンド選択判断の添字で引くジャンプテーブル行） */
  targetJudgment: number[]
  soundEffect: number
  battleHandler: string
  damageId: number
  /** 打撃ダメージ算出（空振り時の再計算方式） */
  hitDamageRecalc: number
  /** 対象範囲 0:なし 1:単体 2:グループ 3:全体 */
  targetScope: number
  mp: number
  /** 対象陣営 0:なし 1:自身 2:自グループ 3:反対陣営 4:全員 */
  targetSide: number
  /** 系統分類（耐性分類） */
  category: number
  successRate: number[]
  /** 戦闘終了時述語 0..3 */
  endPredicate: number
  flags: CommandFlags
  /** 対象生存条件 0:生存 1:死亡 2:不問 */
  targetAliveCondition: number
}

export interface CommandFlags {
  considersSilence: boolean
  considersReflect: boolean
  considersFubaha: boolean
  considersManusa: boolean
  wakesAlly: boolean
  damageTransferEquip: boolean
  considersEvasion: boolean
  considersBaikiruto: boolean
  considersCritical: boolean
  considersConcentration: boolean
  retargetOnWhiff: boolean
  considersSelectionJudgment: boolean
  considersAstron: boolean
  missEquip: boolean
  killerEquip: boolean
  poisonNeedleFixed: boolean
  instantDeathEquip: boolean
  hayabusa: boolean
  grantsExp: boolean
  suppressMessage: boolean
  effectTiming: boolean
  effectWholeEnemySide: boolean
  considersLuck: boolean
  fixTargetOwnSide: boolean
  fixTargetEnemySide: boolean
  /** 格闘場使用許可。0 のコマンドは通常攻撃に置き換わる */
  arenaAllowed: boolean
  grantsGold: boolean
  remembersKill: boolean
  confusedToAttack: boolean
}

/** $C23BB4 ダメージ構造体（5 バイト × 50）。1023 はマジックナンバー（抽選せず 65535） */
export interface DamageDef {
  id: number
  pcMin: number
  enemyMin: number
  pcMax: number
  enemyMax: number
}

/** $C30DC5 マッチメイク（8 バイト × 38） */
export interface MatchCardDef {
  /** 0 始まりの試合 ID。UI 上の「試合 N」は index + 1 */
  index: number
  entries: Array<{ monsterId: number; baseOdds: number }>
}

export interface GameData {
  /** 取得元の dqbook コミット（出典の固定） */
  sourceCommit: string
  monsters: MonsterDef[]
  commands: CommandDef[]
  damages: DamageDef[]
  matchCards: MatchCardDef[]
}
