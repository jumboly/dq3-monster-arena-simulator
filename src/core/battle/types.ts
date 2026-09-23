/**
 * Battle Core の入出力契約。React から独立しており、UI・AI・Monte Carlo すべてが
 * この型だけを介して戦闘を扱う。
 *
 * 設計: 格闘場専用エンジンではなく「DQ3BattleEngine + ArenaMode」。
 * SFC 版は通常戦・イベント戦・格闘場が同一の戦闘メインループ（$0259F5）を共有するため、
 * モード差分は BattleMode で分岐させ、ループ本体は共通にする。
 */
import type { RandomSource } from '../rng/RandomSource'

export type BattleMode = { kind: 'arena'; betSlot: number | null }

/** グループ ID。0..3: 敵陣グループ, 4: 格闘場で賭けた選手のグループ, 5: 自陣（PC） */
export type GroupId = 0 | 1 | 2 | 3 | 4 | 5
export const BET_GROUP: GroupId = 4

/**
 * 戦闘員の実行時状態。
 *
 * HP > 0 だけで生存判定しないこと。DQ3 では死亡・バシルーラ・逃走などの離脱が
 * 別の概念（死亡状態 / アクティブフラグ）で表現される（dqbook dq3_combatants）。
 */
export interface CombatantState {
  /** 戦闘員スロット（格闘場では出場順 0..3） */
  slot: number
  monsterId: number
  name: string
  hp: number
  maxHp: number
  mp: number
  attack: number
  defense: number
  agility: number

  /** 戦闘の場にいる（死亡でも true のことがある。バシルーラ・逃走で false） */
  active: boolean
  dead: boolean
  /** ラリホーカウンター。0 なら起きている */
  sleepCounter: number
  paralyzed: boolean
  confused: boolean
  silenced: boolean
  manusa: boolean
  poisoned: boolean
  defending: boolean
  resting: boolean
  mpShortage: boolean

  /** スクルト・ルカナン等の累積補正（実装側で解釈を定義する） */
  defenseModifier: number
  agilityModifier: number

  groupId: GroupId
  originalGroupId: GroupId
  /** 賭け対象か。groupId === 4 と同義だが「陣営」とは別概念なので独立に持つ */
  isBetTarget: boolean
  /** 戦闘コマンド決定用カウンター（戦略 3 のローテーション） */
  rotationCounter: number
  /** 同一モンスター識別子（A/B/C 表記用） */
  duplicateIndex: number
}

export type BattleOutcome =
  | { kind: 'winner'; slot: number; turn: number }
  | { kind: 'draw'; reason: 'all-inactive' | 'turn-limit'; turn: number }

/** ログ 1 件。Simple / Detail / Internal の 3 層を同じイベントに持たせる。 */
export interface BattleLogEntry {
  turn: number
  kind:
    | 'battle-start'
    | 'turn-start'
    | 'turn-order'
    | 'action'
    | 'damage'
    | 'heal'
    | 'status'
    | 'miss'
    | 'defeat'
    | 'leave'
    | 'turn-end'
    | 'battle-end'
    | 'note'
  actorSlot?: number
  targetSlots?: number[]
  /** 通常画面で見せる短文（日本語） */
  simple: string
  /** 計算根拠（攻撃力・守備力・乱数など） */
  detail?: Record<string, number | string | boolean>
  /** 開発・解析用の内部値（command ID, target mask, rng state など） */
  internal?: Record<string, number | string | boolean>
}

export interface ArenaBattleSetup {
  /** マッチメイクで決まった出場モンスター ID（出場順） */
  monsterIds: number[]
  heroLevel: number
  /** 賭けたスロット。Group 4 の分岐が結果分布を変えうるため入力に含める */
  betSlot: number | null
}

export interface BattleResult {
  outcome: BattleOutcome
  turns: number
  log: BattleLogEntry[]
  finalStates: CombatantState[]
  /** 戦闘中に実装上の近似・未解明分岐を通った回数（再現度の可視化用） */
  fidelityHits: Record<string, number>
}

export interface BattleEngine {
  runArena(setup: ArenaBattleSetup, rng: RandomSource): BattleResult
}
