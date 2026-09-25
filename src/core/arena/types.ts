/**
 * 格闘場（窓口・マッチメイク・オッズ・配当）の契約。
 */
import type { ArenaEndType, BattleResult } from '../battle/types'

/** 表示オッズ。実機は整数部と小数 1 桁を別々に持つので、浮動小数ではなく整数対で保持する */
export interface Odds {
  integer: number
  tenths: number
}

export interface Contestant {
  slot: number
  monsterId: number
  name: string
  baseOdds: number
  odds: Odds
}

/** 賭ける前に公開してよい試合情報 */
export interface MatchOffer {
  round: number
  /** 0 始まりの試合 ID（$C30DC5 の添字） */
  cardIndex: number
  heroLevel: number
  /** 暫定のオッズ境界処理（U-18）を通った選手数 */
  provisionalOddsCount?: number
  stake: number
  contestants: Contestant[]
}

export interface ArenaRoundResult {
  offer: MatchOffer
  betSlot: number
  battle: BattleResult
  won: boolean
  /** 引き分け（終了タイプ 7） */
  draw: boolean
  /** ROM の終了タイプ 5 当たり / 6 ハズレ / 7 引き分け */
  endType: ArenaEndType
  /** 払い戻し額（賭け金を含む総額。負けなら 0） */
  payout: number
  /** 所持金の増減（payout - stake） */
  delta: number
  goldBefore: number
  goldAfter: number
  /** 戦闘の再現用シード（Hidden。AI には渡さない） */
  battleSeed: number
}
