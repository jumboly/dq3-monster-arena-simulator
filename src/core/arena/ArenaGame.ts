/**
 * UI・AI・Monte Carlo が格闘場を操作するための唯一の窓口。
 *
 * UI はこの API だけを呼び、マッチメイク・オッズ・戦闘・配当の中身を知らない。
 * 戦闘ロジックを React コンポーネントに書かないための境界でもある。
 */
import type { CommandDef, MonsterDef } from '../data/types'
import type { InformationMode, MatchObservation } from '../../ai/BettingAgent'
import type { ArenaRoundResult, MatchOffer } from './types'

export interface ArenaGame {
  /** 所持金に関係なく試合を生成する（賭け金が払えるかの判定は呼び出し側） */
  createOffer(params: { heroLevel: number; round: number; seed: number }): MatchOffer
  /** 賭けて戦闘を実行し、配当まで確定させる。seed が同じなら結果は同じ */
  resolveBet(params: { offer: MatchOffer; betSlot: number; goldBefore: number; battleSeed: number }): ArenaRoundResult
  /** 賭け金（主人公レベル × 10G） */
  stakeFor(heroLevel: number): number
  /** 表示オッズを倍率に（例: {2, 8} → 2.8） */
  oddsValue(offer: MatchOffer, slot: number): number
  monster(id: number): MonsterDef
  command(id: number): CommandDef
  /** 賭ける前に公開してよい情報だけで観測を作る（Hidden Runtime State を含めない） */
  observe(offer: MatchOffer, mode: InformationMode): MatchObservation
}
