/**
 * 本番の ArenaGame の組み立て。メインスレッドと Analysis の Web Worker が同じ初期化を
 * 共有するため 1 か所にまとめる（別々に組み立てると、Worker だけ別の設定で戦闘する事故が起きうる）。
 */
import type { ArenaGame } from '../core/arena/ArenaGame'
import { createDQ3ArenaGame } from '../core/arena/DQ3ArenaGame'
import { DQ3BattleEngine } from '../core/battle/DQ3BattleEngine'

export function createDefaultArenaGame(): ArenaGame {
  return createDQ3ArenaGame({ engine: new DQ3BattleEngine() })
}
