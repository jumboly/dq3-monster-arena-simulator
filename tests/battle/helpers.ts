/**
 * Battle Core テスト用の補助。
 * 架空モンスターを差し込めるエンジンと、決め打ち乱数（ScriptedRandom）を提供する。
 * 架空モンスターを使うのは、実データのままだと「その分岐を必ず通る」状況を作れないため。
 */
import { DQ3BattleEngine, type DQ3BattleEngineOptions } from '../../src/core/battle/DQ3BattleEngine'
import type { ArenaBattleSetup, BattleLogEntry, BattleResult } from '../../src/core/battle/types'
import { getMonster } from '../../src/core/data/gameData'
import type { MonsterDef } from '../../src/core/data/types'
import { type RandomSource, SeededRandom } from '../../src/core/rng/RandomSource'

/** 架空モンスター ID の開始値（実データ 0..159 と衝突させない） */
export const FAKE_BASE = 1000

/** 何もしない・死なないモンスターを基準に、上書きで性質を決める */
export function fakeMonster(id: number, over: Partial<MonsterDef> = {}): MonsterDef {
  return {
    id,
    name: `テスト${id - FAKE_BASE}`,
    level: 1,
    isDragon: false,
    exp: 0,
    gold: 0,
    attack: 0,
    defense: 0,
    agility: 0,
    mp: 0,
    maxHp: 1000,
    commands: [105, 105, 105, 105, 105, 105, 105, 105], // 様子を見る
    commandConstraints: [false, false, false, false, false, false, false, false],
    selectionJudgment: 0,
    strategy: 0,
    evasion: 0,
    itemRate: 0,
    multiAction: 0,
    autoHeal: 0,
    concentrate: false,
    resistances: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    metal: false,
    ...over,
  }
}

export function engineWith(monsters: MonsterDef[], extra: Omit<DQ3BattleEngineOptions, 'getMonster'> = {}): DQ3BattleEngine {
  const table = new Map(monsters.map((m) => [m.id, m]))
  return new DQ3BattleEngine({
    ...extra,
    getMonster: (id) => table.get(id) ?? getMonster(id),
  })
}

export function run(
  engine: DQ3BattleEngine,
  monsterIds: number[],
  betSlot: number | null,
  seed: number | RandomSource,
  over: Partial<ArenaBattleSetup> = {},
): BattleResult {
  const rng = typeof seed === 'number' ? new SeededRandom(seed) : seed
  return engine.runArena({ monsterIds, heroLevel: 20, betSlot, ...over }, rng)
}

/**
 * 決め打ち乱数。values を先頭から返し、尽きたら fallback（既定は常に 0）を使う。
 * 各値は呼び出し側の maxExclusive 未満であることを検査する（テストの書き間違いを早く見つけるため）。
 */
export class ScriptedRandom implements RandomSource {
  private readonly values: number[]
  private readonly fallback: (max: number) => number
  readonly requests: number[] = []

  constructor(values: number[] = [], fallback: (max: number) => number = () => 0) {
    this.values = [...values]
    this.fallback = fallback
  }

  nextInt(maxExclusive: number): number {
    this.requests.push(maxExclusive)
    const v = this.values.length > 0 ? this.values.shift()! : this.fallback(maxExclusive)
    if (!(v >= 0 && v < maxExclusive)) throw new RangeError(`scripted ${v} is out of [0, ${maxExclusive})`)
    return v
  }
}

/** 行動ログ（kind=action）だけを取り出す */
export function actions(log: BattleLogEntry[]): BattleLogEntry[] {
  return log.filter((e) => e.kind === 'action')
}

/** ゴールデンテスト用の簡潔な行動列 "T<turn> s<slot>:<cmd>><targets>" */
export function actionTrace(log: BattleLogEntry[]): string[] {
  return actions(log).map(
    (e) => `T${e.turn} s${e.actorSlot}:${String(e.internal?.commandId)}>${(e.targetSlots ?? []).join(',')}`,
  )
}
