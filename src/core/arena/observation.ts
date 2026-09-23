/**
 * 賭ける前に公開してよい情報だけから MatchObservation を作る。
 *
 * 人間の Analyst 表示と AI への入力を同じ関数から作るのは、両者に与える情報量を一致させ、
 * 判断の比較を公平にするため。RNG シード・実際の初期 HP（最大 HP の 90〜100% で抽選）・
 * あやしいかげの実体など、戦闘開始後に決まる値はここに入れない。
 */
import type { InformationMode, MatchObservation, ObservedAction } from '../../ai/BettingAgent'
import type { CommandDef, MonsterDef } from '../data/types'
import { oddsToNumber } from './odds'
import type { MatchOffer } from './types'

/** モンスター耐性 #$00..#$0D の系統名（dqbook dq3_monsters「モンスター耐性表」） */
export const RESISTANCE_NAMES = [
  'メラ・ギラ・イオ',
  'ヒャド',
  'バギ',
  'デイン',
  'ザキ',
  'メガンテ',
  'ラリホー',
  'マホトーン',
  'ルカニ',
  'マヌーサ',
  'マホトラ',
  'メダパニ',
  'ボミオス・バシルーラ',
  'ニフラム・せいすい',
] as const

/** コマンド決定戦略の重み（$0268CD、分母 256）。戦略 3 はローテーション用マスクなので重みを持たない */
const STRATEGY_WEIGHTS: ReadonlyArray<ReadonlyArray<number> | null> = [
  [32, 32, 32, 32, 32, 32, 32, 32],
  [18, 22, 26, 30, 34, 38, 42, 46],
  [2, 4, 6, 8, 10, 12, 14, 200],
  null,
]

const STRATEGY_LABELS = ['均等', '後ろほど多い', '最後の行動に偏る', 'ローテーション']
const JUDGMENT_LABELS = ['単純', '標準', '賢い']
const MULTI_ACTION_LABELS = ['1回', '1/2で2回', '1〜3回', '2回']

/** 観測上の id。出場順に a, b, c, d（同名モンスターでも区別できるように） */
export function contestantId(slot: number): string {
  return `monster-${String.fromCharCode(0x61 + slot)}`
}

function observedActions(m: MonsterDef, command: (id: number) => CommandDef): ObservedAction[] {
  const weights = STRATEGY_WEIGHTS[m.strategy]
  return m.commands.map((id, i) => {
    const c = command(id)
    const action: ObservedAction = { name: c.name, forbiddenInArena: !c.flags.arenaAllowed }
    if (weights) action.weight = weights[i] / 256
    return action
  })
}

function traits(m: MonsterDef): string[] {
  const t: string[] = []
  if (m.mp === 255) t.push('MPが減らない')
  if (m.evasion > 0) t.push(`みかわし ${m.evasion}/7`)
  if (m.concentrate && m.selectionJudgment > 0) t.push('同じ相手を狙い続ける')
  if (m.metal) t.push('メタル系')
  if (m.isDragon) t.push('ドラゴン系')
  if (m.autoHeal > 0) t.push(`自動回復 ${m.autoHeal}`)
  return t
}

export function buildObservation(
  offer: MatchOffer,
  mode: InformationMode,
  monster: (id: number) => MonsterDef,
  command: (id: number) => CommandDef,
): MatchObservation {
  return {
    informationMode: mode,
    heroLevel: offer.heroLevel,
    stake: offer.stake,
    contestants: offer.contestants.map((c) => {
      const base = { id: contestantId(c.slot), name: c.name, odds: oddsToNumber(c.odds) }
      if (mode === 'classic') return base
      const m = monster(c.monsterId)
      return {
        ...base,
        stats: { maxHp: m.maxHp, mp: m.mp, attack: m.attack, defense: m.defense, agility: m.agility },
        actions: observedActions(m, command),
        ai: {
          strategy: STRATEGY_LABELS[m.strategy] ?? String(m.strategy),
          selectionJudgment: m.selectionJudgment,
          selectionJudgmentLabel: JUDGMENT_LABELS[m.selectionJudgment] ?? String(m.selectionJudgment),
          multiAction: MULTI_ACTION_LABELS[m.multiAction] ?? String(m.multiAction),
          concentrate: m.concentrate,
        },
        traits: traits(m),
        resistances: Object.fromEntries(RESISTANCE_NAMES.map((name, i) => [name, m.resistances[i]])),
      }
    }),
  }
}
