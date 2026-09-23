/**
 * UI が使う ArenaGame の唯一の生成箇所。
 *
 * 本実装が揃ったら、ここの createMockArenaGame() を本物の生成関数に差し替えるだけで
 * 画面全体が本物のマッチメイク・戦闘に切り替わる（UI 側は ArenaGame インターフェースしか見ない）。
 */
import type { ArenaGame } from '../core/arena/ArenaGame'
import { createMockArenaGame } from '../core/arena/mockArenaGame'

let instance: ArenaGame | null = null

export function getArenaGame(): ArenaGame {
  // データ読み込みを伴う本実装でも 1 回だけ生成されるよう遅延シングルトンにする
  instance ??= createMockArenaGame()
  return instance
}

/** 本物か判別して「モック動作中」の注意を出すため */
export const ARENA_GAME_IS_MOCK = true
