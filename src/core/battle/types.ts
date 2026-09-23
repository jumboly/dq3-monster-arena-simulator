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
  /** 戦闘員インデックス 0..23。行動順の同値タイブレークと複数対象の処理順に効く */
  combatantIndex: number
  /** あやしいかげの実体など、ステータスの出どころとなるモンスター ID（通常は monsterId と同じ） */
  transformMonsterId: number
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

  /**
   * 基礎値との差（表示用）。ROM は補正量ではなく現在値（defense / agility）を直接書き換える
   * （$0299F5）ので、計算には使わず、現在値 − 基礎値として導出する。
   */
  defenseModifier: number
  agilityModifier: number
  /** ターン中の素早さ（コマンド実行優位 $2045） */
  turnAgility: number

  groupId: GroupId
  originalGroupId: GroupId
  /** 賭け対象か。groupId === 4 と同義だが「陣営」とは別概念なので独立に持つ */
  isBetTarget: boolean
  /** 戦闘コマンド決定用カウンター（戦略 3 のローテーション） */
  rotationCounter: number
  /** 同一モンスター識別子（A/B/C 表記用） */
  duplicateIndex: number
}

/**
 * 戦闘の結末。ROM の終了タイプ（$7E23AB bit0-3）5 当たり / 6 ハズレ / 7 引き分け を保持する。
 *
 * winner / draw だけでは「10 ターン経過時に賭けた選手が死亡し、他が 2 体以上生存」
 * （タイプ 6 だが単独の勝者がいない）を表せないため no-winner を分けている
 * （docs/research/battle-spec.md §8.2, §8.3）。
 */
export type ArenaEndType = 5 | 6 | 7

export type BattleOutcome =
  /** 生存者が 1 体になった。賭けた選手なら endType 5、それ以外なら 6 */
  | { kind: 'winner'; slot: number; turn: number; endType: 5 | 6 }
  /** 生存 0 体、または 10 ターン終了時に賭けた選手が生存（endType 7） */
  | { kind: 'draw'; reason: 'all-inactive' | 'turn-limit'; turn: number; endType: 7 }
  /** 10 ターン終了時、賭けた選手は既に倒れ、他が 2 体以上生存（endType 6） */
  | { kind: 'no-winner'; reason: 'turn-limit'; turn: number; endType: 6; survivors: number[] }

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
  /**
   * 賭けたスロット。Group 4 の分岐が結果分布を変えうるため入力に含める。
   * null（賭けなし観戦）は SFC に存在しないので、Group 4 なしで走らせ fidelityHits に計上する。
   */
  betSlot: number | null
  /** 隊列先頭のレベル。あやしいかげの実体決定に使う（主人公レベルとは別。省略時 heroLevel） */
  leaderLevel?: number
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
