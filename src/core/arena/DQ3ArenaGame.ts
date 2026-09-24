/**
 * ArenaGame の本実装。マッチメイク・オッズ・戦闘・配当をつなぐ。
 *
 * 戦闘エンジンは注入する。格闘場の窓口処理と戦闘メインループは ROM 上でも別バンク
 * （$03 と $02）で、差し替え（SfcDq3Rng 版エンジン等）を窓口側に波及させないため。
 */
import type { InformationMode, MatchObservation } from '../../ai/BettingAgent'
import type { BattleEngine } from '../battle/types'
import { getCommand, getGameData, getMatchCard, getMonster } from '../data/gameData'
import type { CommandDef, MonsterDef } from '../data/types'
import { SeededRandom, type RandomSource } from '../rng/RandomSource'
import type { ArenaGame, CardSummary } from './ArenaGame'
import { pickCard, SHADOW_MATCH_INDEX } from './matchmaking'
import { buildObservation } from './observation'
import { oddsToNumber, rollOdds } from './odds'
import { settle, stakeFor, type DrawPolicy } from './payout'
import type { ArenaRoundResult, Contestant, MatchOffer } from './types'

export interface ArenaGameOptions {
  engine: BattleEngine
  /** 引き分けの扱いは設定画面で試合の合間に変わるので、値ではなく読み出し関数で受け取る */
  drawPolicy?: () => DrawPolicy
  /** 試合 38（あやしいかげ）をマッチメイクの候補に含めるか。Phase B 完了まで既定 false */
  includeShadowMatch?: boolean
}

function buildContestants(cardIndex: number, rng: RandomSource): { contestants: Contestant[]; provisional: number } {
  let provisional = 0
  const contestants = getMatchCard(cardIndex).entries.map((e, slot) => {
    const roll = rollOdds(e.baseOdds, rng)
    if (roll.usedProvisionalBoundary) provisional++
    return { slot, monsterId: e.monsterId, name: getMonster(e.monsterId).name, baseOdds: e.baseOdds, odds: roll.odds }
  })
  return { contestants, provisional }
}

export function createDQ3ArenaGame(options: ArenaGameOptions): ArenaGame {
  const getDrawPolicy = options.drawPolicy ?? (() => 'refund')
  const includeShadowMatch = options.includeShadowMatch ?? false

  const offerFor = (cardIndex: number, heroLevel: number, round: number, rng: RandomSource, excludedShadowMatch: boolean): MatchOffer => {
    const { contestants, provisional } = buildContestants(cardIndex, rng)
    return {
      round,
      cardIndex,
      heroLevel,
      stake: stakeFor(heroLevel),
      contestants,
      excludedShadowMatch,
      provisionalOddsCount: provisional,
    }
  }

  return {
    createOffer({ heroLevel, round, seed }) {
      // 実機ではカード抽選とオッズ抽選が同じ乱数列を消費するので、同じ rng を順に使う
      const rng = new SeededRandom(seed)
      const pick = pickCard(heroLevel, rng, includeShadowMatch)
      return offerFor(pick.cardIndex, heroLevel, round, rng, pick.excludedShadowMatch)
    },

    createOfferForCard({ cardIndex, heroLevel, round, seed }) {
      return offerFor(cardIndex, heroLevel, round, new SeededRandom(seed), false)
    },

    listCards(): CardSummary[] {
      return getGameData().matchCards.map((card) => ({
        index: card.index,
        names: card.entries.map((e) => getMonster(e.monsterId).name),
        playable: includeShadowMatch || card.index !== SHADOW_MATCH_INDEX,
      }))
    },

    resolveBet({ offer, betSlot, goldBefore, battleSeed }): ArenaRoundResult {
      const battle = options.engine.runArena(
        { monsterIds: offer.contestants.map((c) => c.monsterId), heroLevel: offer.heroLevel, betSlot },
        new SeededRandom(battleSeed),
      )
      const drawPolicy = getDrawPolicy()
      const s = settle({ stake: offer.stake, odds: offer.contestants[betSlot].odds, outcome: battle.outcome, betSlot, drawPolicy })
      return {
        offer,
        betSlot,
        battle,
        won: s.won,
        draw: s.draw,
        endType: battle.outcome.endType,
        drawPolicy,
        payout: s.payout,
        delta: s.delta,
        goldBefore,
        goldAfter: goldBefore + s.delta,
        battleSeed,
      }
    },

    stakeFor,
    oddsValue: (offer, slot) => oddsToNumber(offer.contestants[slot].odds),
    monster: (id: number): MonsterDef => getMonster(id),
    command: (id: number): CommandDef => getCommand(id),
    observe: (offer: MatchOffer, mode: InformationMode): MatchObservation => buildObservation(offer, mode, getMonster, getCommand),
  }
}
