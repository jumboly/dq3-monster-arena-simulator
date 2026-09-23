/**
 * セッション進行の純関数群（React 非依存）。
 *
 * 格闘場の中身（マッチメイク・戦闘・配当）は ArenaGame に委ね、ここでは
 * 「どの seed で何を呼び、結果をどう履歴に積むか」だけを扱う。
 * Human / Jev / Auto Play がすべて同じ関数を通ることで、賭け方が違っても
 * 所持金・履歴の更新規則が 1 か所に保たれる。
 */
import type { ArenaGame } from '../../core/arena/ArenaGame'
import type { ArenaRoundResult, MatchOffer } from '../../core/arena/types'
import type { StatRecord } from '../../core/stats/sessionStats'
import { randomSeed } from '../../core/rng/RandomSource'
import type { BetDecision, InformationMode, MatchObservation } from '../../ai/BettingAgent'
import { summarize, type HistoryEntry, type PlayerMode, type Prediction, type Session } from '../../storage/session'

export const HERO_LEVEL_MIN = 1
export const HERO_LEVEL_MAX = 99
export const DEFAULT_HERO_LEVEL = 30
export const DEFAULT_INITIAL_GOLD = 10_000

/**
 * (sessionSeed, round, 用途) から 32bit シードを導出する。
 * 試合と戦闘のシードを別にするのは、同じ試合に別の賭け方をしたときの比較や、
 * 将来マッチメイクと戦闘の乱数源を分けたくなった時にも系列が干渉しないようにするため。
 */
export function deriveSeed(sessionSeed: number, round: number, salt: 'offer' | 'battle'): number {
  let h = (sessionSeed ^ Math.imul(round, 0x9e3779b1) ^ (salt === 'offer' ? 0x6f666672 : 0x62746c65)) >>> 0
  // murmur3 の fmix32。近い入力でも出力を十分散らすため
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export interface NewSessionParams {
  heroLevel: number
  initialGold: number
  informationMode: InformationMode
  playerMode: PlayerMode
  seed?: number
  now?: Date
}

export function clampHeroLevel(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_HERO_LEVEL
  return Math.min(HERO_LEVEL_MAX, Math.max(HERO_LEVEL_MIN, Math.round(n)))
}

export function createSession(p: NewSessionParams): Session {
  const seed = p.seed ?? randomSeed()
  const now = p.now ?? new Date()
  return {
    id: `${now.getTime().toString(36)}-${seed.toString(36)}`,
    createdAt: now.toISOString(),
    heroLevel: clampHeroLevel(p.heroLevel),
    initialGold: Math.max(0, Math.floor(p.initialGold)),
    gold: Math.max(0, Math.floor(p.initialGold)),
    round: 1,
    informationMode: p.informationMode,
    playerMode: p.playerMode,
    seed,
    phase: 'match',
  }
}

export function currentOffer(game: ArenaGame, s: Session): MatchOffer {
  return game.createOffer({ heroLevel: s.heroLevel, round: s.round, seed: deriveSeed(s.seed, s.round, 'offer') })
}

export function canAfford(game: ArenaGame, s: Session): boolean {
  return s.gold >= game.stakeFor(s.heroLevel)
}

export interface PlayOutcome {
  session: Session
  entry: HistoryEntry
  result: ArenaRoundResult
}

/** 賭けて戦闘し、セッションと履歴エントリを返す。所持金更新は ArenaGame の goldAfter をそのまま使う */
export function playBet(
  game: ArenaGame,
  s: Session,
  betSlot: number,
  opts: { prediction?: Prediction; auto?: boolean; now?: Date } = {},
): PlayOutcome {
  if (s.phase !== 'match') throw new Error('結果表示中は賭けられません')
  if (!canAfford(game, s)) throw new Error('所持金が足りません')
  const offer = currentOffer(game, s)
  const battleSeed = deriveSeed(s.seed, s.round, 'battle')
  const result = game.resolveBet({ offer, betSlot, goldBefore: s.gold, battleSeed })
  const entry: HistoryEntry = {
    sessionId: s.id,
    round: s.round,
    playedAt: (opts.now ?? new Date()).toISOString(),
    offer,
    betSlot,
    won: result.won,
    payout: result.payout,
    delta: result.delta,
    goldBefore: result.goldBefore,
    goldAfter: result.goldAfter,
    battleSeed,
    summary: summarize(result.battle),
    battle: result.battle,
    ...(opts.prediction ? { prediction: opts.prediction } : {}),
    ...(opts.auto ? { auto: true } : {}),
  }
  return { session: { ...s, gold: result.goldAfter, phase: 'result' }, entry, result }
}

export function nextMatch(s: Session): Session {
  return s.phase === 'result' ? { ...s, round: s.round + 1, phase: 'match' } : s
}

/**
 * 履歴からログを取り出す。刈り込み済み（battle なし）なら resolveBet で再生成する。
 * regenerated=true はエンジン更新で当時と異なる可能性があることを UI で注記するため。
 */
export function battleFor(game: ArenaGame, e: HistoryEntry): { result: ArenaRoundResult; regenerated: boolean } {
  if (e.battle) {
    return {
      result: {
        offer: e.offer,
        betSlot: e.betSlot,
        battle: e.battle,
        won: e.won,
        payout: e.payout,
        delta: e.delta,
        goldBefore: e.goldBefore,
        goldAfter: e.goldAfter,
        battleSeed: e.battleSeed,
      },
      regenerated: false,
    }
  }
  return {
    result: game.resolveBet({ offer: e.offer, betSlot: e.betSlot, goldBefore: e.goldBefore, battleSeed: e.battleSeed }),
    regenerated: true,
  }
}

/**
 * BetDecision.bet（観測上の id）を betSlot に戻す。
 * 契約上 id の採番規則は ArenaGame.observe 次第なので、UI は「observe の contestants[k] と
 * offer.contestants[k] が同じ選手」という順序対応だけを前提にする。
 */
export function slotForDecision(offer: MatchOffer, obs: MatchObservation, d: BetDecision): number | null {
  const k = obs.contestants.findIndex((c) => c.id === d.bet)
  if (k < 0 || k >= offer.contestants.length) return null
  return offer.contestants[k].slot
}

export function winnerSlotOf(e: HistoryEntry): number | null {
  return e.summary.outcome.kind === 'winner' ? e.summary.outcome.slot : null
}

export function winnerName(e: HistoryEntry): string | null {
  const w = winnerSlotOf(e)
  return w === null ? null : (e.offer.contestants.find((c) => c.slot === w)?.name ?? null)
}

export function resultLabel(e: Pick<HistoryEntry, 'won' | 'summary'>): 'WIN' | 'LOSE' | 'DRAW' {
  if (e.won) return 'WIN'
  return e.summary.outcome.kind === 'draw' ? 'DRAW' : 'LOSE'
}

function oddsOf(offer: MatchOffer, slot: number): number | undefined {
  const c = offer.contestants.find((x) => x.slot === slot)
  return c ? c.odds.integer + c.odds.tenths / 10 : undefined
}

/**
 * 保存済み予測を offer のスロットで引ける形に戻す。
 * 予測確率は観測 id で保存しているので、observationIds（= offer.contestants 順）で対応付ける。
 */
export function predictionBySlot(e: Pick<HistoryEntry, 'offer' | 'prediction'>): Record<number, number> | null {
  const p = e.prediction
  if (!p) return null
  const ids = p.observationIds ?? e.offer.contestants.map((c) => String(c.slot))
  const out: Record<number, number> = {}
  e.offer.contestants.forEach((c, k) => {
    out[c.slot] = p.decision.probabilities[ids[k]] ?? 0
  })
  return out
}

/**
 * 履歴 → 統計用レコード。
 * 予測確率は保存時の観測 id のまま持っているので、ここでも順序対応でスロットに戻す。
 */
export function toStatRecord(e: HistoryEntry): StatRecord {
  const slots = e.offer.contestants.map((c) => c.slot)
  const odds: Record<number, number> = {}
  for (const s of slots) odds[s] = oddsOf(e.offer, s) ?? 0
  const probabilities = predictionBySlot(e) ?? undefined
  return {
    won: e.won,
    draw: e.summary.outcome.kind === 'draw',
    stake: e.offer.stake,
    delta: e.delta,
    betSlot: e.betSlot,
    winnerSlot: winnerSlotOf(e),
    slots,
    odds,
    ...(probabilities ? { probabilities } : {}),
  }
}
