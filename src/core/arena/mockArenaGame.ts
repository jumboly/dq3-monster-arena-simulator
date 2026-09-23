/**
 * ArenaGame の仮実装（UI 開発用モック）。
 *
 * 本物の Battle Core / マッチメイク / オッズ計算が揃うまで UI を動かすためだけのもの。
 * ROM の仕様は一切再現していない（Approximation ですらない、ダミー）。
 * 差し替えは src/ui/arenaGameProvider.ts の 1 か所で行う。
 *
 * それでも以下は本物と同じ性質を持たせる。UI 側の前提（再生・履歴からの再生成・
 * Analysis の分布表）を本実装前に検証できるようにするため:
 * - 同じ seed なら同じ試合・同じ戦闘結果（決定的）
 * - 引き分けがありうる
 * - ログに simple / detail / internal の 3 層がある
 */
import type { InformationMode, MatchObservation } from '../../ai/BettingAgent'
import type { BattleLogEntry, BattleOutcome, BattleResult, CombatantState, GroupId } from '../battle/types'
import type { CommandDef, CommandFlags, MonsterDef } from '../data/types'
import { SeededRandom } from '../rng/RandomSource'
import type { ArenaGame, CardSummary } from './ArenaGame'
import { settle, type DrawPolicy } from './payout'
import type { ArenaRoundResult, Contestant, MatchOffer } from './types'

const NO_FLAGS: CommandFlags = {
  considersSilence: false,
  considersReflect: false,
  considersFubaha: false,
  considersManusa: false,
  wakesAlly: false,
  damageTransferEquip: false,
  considersEvasion: false,
  considersBaikiruto: false,
  considersCritical: false,
  considersConcentration: false,
  retargetOnWhiff: false,
  considersSelectionJudgment: false,
  considersAstron: false,
  missEquip: false,
  killerEquip: false,
  poisonNeedleFixed: false,
  instantDeathEquip: false,
  hayabusa: false,
  grantsExp: false,
  suppressMessage: false,
  effectTiming: false,
  effectWholeEnemySide: false,
  considersLuck: false,
  fixTargetOwnSide: false,
  fixTargetEnemySide: false,
  arenaAllowed: true,
  grantsGold: false,
  remembersKill: false,
  confusedToAttack: false,
}

function cmd(id: number, name: string, arenaAllowed = true): CommandDef {
  return {
    id,
    name,
    targetJudgment: [0, 0, 0],
    soundEffect: 0,
    battleHandler: 'mock',
    damageId: 0,
    hitDamageRecalc: 0,
    targetScope: 1,
    mp: 0,
    targetSide: 3,
    category: 0,
    successRate: [],
    endPredicate: 0,
    flags: { ...NO_FLAGS, arenaAllowed },
    targetAliveCondition: 0,
  }
}

const COMMANDS: CommandDef[] = [cmd(0, 'こうげき'), cmd(1, 'ぼうぎょ'), cmd(2, 'にげる', false), cmd(3, 'かみつく')]

function mon(id: number, name: string, maxHp: number, attack: number, defense: number, agility: number): MonsterDef {
  return {
    id,
    name,
    level: 1,
    isDragon: false,
    exp: 0,
    gold: 0,
    attack,
    defense,
    agility,
    mp: 0,
    maxHp,
    commands: [0, 0, 3, 0, 1, 0, 2, 0],
    commandConstraints: Array(8).fill(false),
    selectionJudgment: 0,
    strategy: 0,
    evasion: 0,
    itemRate: 0,
    multiAction: 0,
    autoHeal: 0,
    concentrate: false,
    resistances: Array(14).fill(0),
    metal: false,
  }
}

/** ダミー。名前は UI 確認用の最小限だけ */
const MONSTERS: MonsterDef[] = [
  mon(0, 'スライム', 8, 9, 5, 4),
  mon(1, 'ドラキー', 12, 12, 8, 14),
  mon(2, 'おおがらす', 14, 14, 6, 11),
  mon(3, 'キメラ', 30, 34, 26, 40),
  mon(4, 'さまようよろい', 45, 56, 60, 20),
  mon(5, 'ホイミスライム', 20, 18, 14, 16),
  mon(6, 'ゴーレム', 90, 20, 90, 6),
]

/** ダミーの試合カード（monsterId, baseOdds=倍率×10） */
const CARDS: Array<Array<[number, number]>> = [
  [
    [0, 52],
    [1, 21],
    [2, 28],
  ],
  [
    [3, 18],
    [4, 23],
  ],
  [
    [0, 88],
    [2, 34],
    [3, 16],
    [5, 41],
  ],
  [
    [1, 29],
    [5, 19],
    [2, 45],
  ],
  // 硬い 2 体。10 ターン打ち切り（引き分け・勝者なし）の表示確認用
  [
    [4, 21],
    [6, 25],
  ],
]

/** 実機と同じく 10 ターンで打ち切る。終了タイプ 6/7 の分岐（はずれ・引き分け）を UI で確認できるようにするため */
const TURN_LIMIT = 10

export interface MockArenaGameOptions {
  /** 本実装（createDQ3ArenaGame）と同じ名前・既定値にして、provider の差し替えを機械的にするため */
  drawPolicy?: DrawPolicy
}

export function createMockArenaGame(options: MockArenaGameOptions = {}): ArenaGame {
  const drawPolicy = options.drawPolicy ?? 'refund'
  const monster = (id: number): MonsterDef => {
    const m = MONSTERS[id]
    if (!m) throw new RangeError(`mock monster ${id} not found`)
    return m
  }
  const command = (id: number): CommandDef => {
    const c = COMMANDS[id]
    if (!c) throw new RangeError(`mock command ${id} not found`)
    return c
  }
  const stakeFor = (heroLevel: number) => heroLevel * 10
  const oddsValue = (offer: MatchOffer, slot: number) => {
    const c = offer.contestants.find((x) => x.slot === slot)
    if (!c) throw new RangeError(`slot ${slot} not in offer`)
    return c.odds.integer + c.odds.tenths / 10
  }

  const offerFor = (cardIndex: number, heroLevel: number, round: number): MatchOffer => {
      if (!CARDS[cardIndex]) throw new RangeError(`mock card ${cardIndex} not found`)
      const contestants: Contestant[] = CARDS[cardIndex].map(([monsterId, baseOdds], slot) => ({
        slot,
        monsterId,
        name: monster(monsterId).name,
        baseOdds,
        odds: { integer: Math.floor(baseOdds / 10), tenths: baseOdds % 10 },
      }))
      return { round, cardIndex, heroLevel, stake: stakeFor(heroLevel), contestants }
  }

  return {
    createOffer({ heroLevel, round, seed }) {
      return offerFor(new SeededRandom(seed).nextInt(CARDS.length), heroLevel, round)
    },

    createOfferForCard({ cardIndex, heroLevel, round }) {
      // モックのオッズは固定なので seed は使わない
      return offerFor(cardIndex, heroLevel, round)
    },

    listCards(): CardSummary[] {
      // 最後のカードを playable=false にして、本実装の「試合 38 = Phase B」表示を UI で確認できるようにする
      const all = [...CARDS, [[3, 30], [3, 30], [3, 30]] as Array<[number, number]>]
      return all.map((c, index) => ({ index, names: c.map(([id]) => monster(id).name), playable: index < CARDS.length }))
    },

    resolveBet({ offer, betSlot, goldBefore, battleSeed }): ArenaRoundResult {
      if (!offer.contestants.some((c) => c.slot === betSlot)) throw new RangeError(`betSlot ${betSlot} not in offer`)
      const battle = runDummyBattle(offer, betSlot, battleSeed, monster)
      const odds = offer.contestants.find((c) => c.slot === betSlot)!.odds
      const st = settle({ stake: offer.stake, odds, outcome: battle.outcome, betSlot, drawPolicy })
      return {
        offer,
        betSlot,
        battle,
        won: st.won,
        draw: st.draw,
        endType: battle.outcome.endType,
        drawPolicy,
        payout: st.payout,
        delta: st.delta,
        goldBefore,
        goldAfter: goldBefore + st.delta,
        battleSeed,
      }
    },

    stakeFor,
    oddsValue,
    monster,
    command,

    observe(offer: MatchOffer, mode: InformationMode): MatchObservation {
      return {
        informationMode: mode,
        heroLevel: offer.heroLevel,
        stake: offer.stake,
        contestants: offer.contestants.map((c): MatchObservation['contestants'][number] => {
          const base = { id: String(c.slot), name: c.name, odds: oddsValue(offer, c.slot) }
          if (mode === 'classic') return base
          const m = monster(c.monsterId)
          return {
            ...base,
            stats: { maxHp: m.maxHp, mp: m.mp, attack: m.attack, defense: m.defense, agility: m.agility },
            actions: m.commands.map((id) => ({
              name: command(id).name,
              forbiddenInArena: !command(id).flags.arenaAllowed,
              weight: 1 / 8,
            })),
            ai: {
              strategy: 'ランダム（モック）',
              selectionJudgment: m.selectionJudgment,
              selectionJudgmentLabel: '単純',
              multiAction: '1回',
              concentrate: m.concentrate,
            },
            traits: m.metal ? ['メタル'] : [],
            resistances: { ギラ: 0, ヒャド: 0, ラリホー: 0 },
          }
        }),
      }
    },
  }
}

/** ダミー戦闘: 素早さ順に通常攻撃を殴り合うだけ。UI の表示確認用 */
function runDummyBattle(
  offer: MatchOffer,
  betSlot: number,
  seed: number,
  monster: (id: number) => MonsterDef,
): BattleResult {
  const rng = new SeededRandom(seed)
  const states: CombatantState[] = offer.contestants.map((c, i) => {
    const m = monster(c.monsterId)
    const group = (c.slot === betSlot ? 4 : Math.min(i, 3)) as GroupId
    return {
      slot: c.slot,
      combatantIndex: i,
      transformMonsterId: c.monsterId,
      monsterId: c.monsterId,
      name: c.name,
      hp: m.maxHp,
      maxHp: m.maxHp,
      mp: m.mp,
      attack: m.attack,
      defense: m.defense,
      agility: m.agility,
      active: true,
      dead: false,
      sleepCounter: 0,
      paralyzed: false,
      confused: false,
      silenced: false,
      manusa: false,
      poisoned: false,
      defending: false,
      resting: false,
      mpShortage: false,
      defenseModifier: 0,
      agilityModifier: 0,
      turnAgility: m.agility,
      groupId: group,
      originalGroupId: group,
      isBetTarget: c.slot === betSlot,
      rotationCounter: 0,
      duplicateIndex: 0,
    }
  })
  const log: BattleLogEntry[] = [
    { turn: 0, kind: 'battle-start', simple: `${states.map((s) => s.name).join('、')}が あらわれた！`, internal: { seed, mock: true } },
  ]
  const alive = () => states.filter((s) => s.active && !s.dead)
  let turn = 0
  let outcome: BattleOutcome | null = null

  while (!outcome) {
    turn += 1
    if (turn > TURN_LIMIT) {
      // 10 ターン経過: 賭けた選手が生きていれば引き分け(7)、倒れていれば はずれ(6)
      const bet = states.find((x) => x.isBetTarget)
      const survivors = alive().map((x) => x.slot)
      outcome =
        bet && !bet.dead
          ? { kind: 'draw', reason: 'turn-limit', turn: TURN_LIMIT, endType: 7 }
          : { kind: 'no-winner', reason: 'turn-limit', turn: TURN_LIMIT, endType: 6, survivors }
      break
    }
    log.push({ turn, kind: 'turn-start', simple: `― ターン ${turn} ―` })
    const order = alive()
      .map((s) => ({ s, key: s.agility + rng.nextInt(Math.max(1, s.agility)) }))
      .sort((a, b) => b.key - a.key)
      .map((x) => x.s)
    log.push({
      turn,
      kind: 'turn-order',
      simple: `行動順: ${order.map((s) => s.name).join(' → ')}`,
      internal: { order: order.map((s) => s.slot).join(',') },
    })
    for (const actor of order) {
      if (actor.dead) continue
      const targets = alive().filter((s) => s !== actor)
      if (targets.length === 0) break
      const target = targets[rng.nextInt(targets.length)]
      const r = rng.nextInt(4)
      const base = Math.max(0, Math.floor((actor.attack - target.defense / 2) / 2))
      // 攻撃力が低くても試合が終わるよう最低 1 は通す（ダミーなので実機準拠ではない）
      const damage = Math.max(1, base + r)
      target.hp = Math.max(0, target.hp - damage)
      log.push({
        turn,
        kind: 'damage',
        actorSlot: actor.slot,
        targetSlots: [target.slot],
        simple: `${actor.name}の こうげき！ ${target.name}に ${damage}の ダメージ！`,
        detail: { attack: actor.attack, defense: target.defense, base, rand: r, damage, targetHp: target.hp },
        internal: { commandId: 0, targetMask: 1 << target.slot, rngState: rng.snapshot },
      })
      if (target.hp === 0) {
        target.dead = true
        log.push({ turn, kind: 'defeat', targetSlots: [target.slot], simple: `${target.name}を たおした！` })
      }
      const rest = alive()
      if (rest.length === 1) {
        outcome = { kind: 'winner', slot: rest[0].slot, turn, endType: rest[0].slot === betSlot ? 5 : 6 }
        break
      }
      if (rest.length === 0) {
        outcome = { kind: 'draw', reason: 'all-inactive', turn, endType: 7 }
        break
      }
    }
    log.push({ turn, kind: 'turn-end', simple: '', internal: { alive: alive().length } })
  }

  // while (!outcome) を抜けた時点で必ず代入済み（ループ内のクロージャ越しの代入で TS の絞り込みが切れるため明示）
  const final = outcome as BattleOutcome
  const endText =
    final.kind === 'winner'
      ? `${states.find((x) => x.slot === final.slot)?.name}の かち！`
      : final.kind === 'no-winner'
        ? '10ターンが すぎた！ しょうしゃは きまらなかった…'
        : 'ひきわけ！'
  log.push({ turn: final.turn, kind: 'battle-end', simple: endText, internal: { outcome: final.kind, endType: final.endType } })
  return { outcome: final, turns: final.turn, log, finalStates: states, fidelityHits: { 'mock-battle': 1 } }
}
