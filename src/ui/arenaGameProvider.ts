/**
 * UI が使う ArenaGame の唯一の生成箇所。
 *
 * 本実装が揃ったら、createInstance() の中身を createDQ3ArenaGame({ engine, drawPolicy }) に
 * 差し替えるだけで画面全体が本物に切り替わる（UI 側は ArenaGame インターフェースしか見ない）。
 *
 * drawPolicy は生成時オプションなので、設定変更のたびに実体を作り直す必要がある。
 * ArenaStore などは生成済みの ArenaGame 参照を握っているため、ここでは「委譲するだけの
 * 固定の窓口」を返し、中身の実体だけを差し替える。こうすると設定変更が次の試合から即反映される。
 */
import type { ArenaGame } from '../core/arena/ArenaGame'
import { createMockArenaGame } from '../core/arena/mockArenaGame'
import type { DrawPolicy } from '../core/arena/payout'
import { DEFAULT_SETTINGS, loadSettings, type Stores } from '../storage/session'

export interface ArenaGameConfig {
  drawPolicy: DrawPolicy
}

/** 保存済み設定から ArenaGame の生成オプションを読む（メインが本実装の provider でも使えるよう公開） */
export function readArenaGameConfig(stores: Stores): ArenaGameConfig {
  return { drawPolicy: loadSettings(stores).drawPolicy }
}

function createInstance(config: ArenaGameConfig): ArenaGame {
  // TODO(main): Battle Core 完成後に createDQ3ArenaGame({ engine, drawPolicy: config.drawPolicy }) へ
  return createMockArenaGame({ drawPolicy: config.drawPolicy })
}

let config: ArenaGameConfig = { drawPolicy: DEFAULT_SETTINGS.drawPolicy }
let instance: ArenaGame | null = null

/** 設定が変わったら呼ぶ。同じ設定なら作り直さない（データ読み込みを伴う本実装で無駄を避ける） */
export function configureArenaGame(next: ArenaGameConfig): void {
  if (instance && next.drawPolicy === config.drawPolicy) return
  config = { ...next }
  instance = null
}

function current(): ArenaGame {
  instance ??= createInstance(config)
  return instance
}

const facade: ArenaGame = {
  createOffer: (p) => current().createOffer(p),
  createOfferForCard: (p) => current().createOfferForCard(p),
  listCards: () => current().listCards(),
  resolveBet: (p) => current().resolveBet(p),
  stakeFor: (lv) => current().stakeFor(lv),
  oddsValue: (o, s) => current().oddsValue(o, s),
  monster: (id) => current().monster(id),
  command: (id) => current().command(id),
  observe: (o, m) => current().observe(o, m),
}

export function getArenaGame(): ArenaGame {
  return facade
}

/** 本物か判別して「モック動作中」の注意を出すため */
export const ARENA_GAME_IS_MOCK = true
