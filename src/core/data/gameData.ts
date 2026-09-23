/**
 * 生成済みゲームデータ（src/data/generated/game-data.json）の型付きローダ。
 *
 * JSON を静的 import するのは、Vite（本番バンドル）と Vitest（node 環境）の双方で
 * 同じコードパスのまま読めるようにするため。fs で読むと UI 側で動かない。
 * 生成物が無い場合は import 解決で失敗するので、先に `npm run data` を実行すること。
 */
import rawGameData from '../../data/generated/game-data.json'
import type { CommandDef, DamageDef, GameData, MatchCardDef, MonsterDef } from './types'

// JSON の推論型は構造的に GameData と互換だが、number[] の長さなどの意味的制約までは表せない。
// 形の整合は生成時（scripts/lib/buildGameData.ts）と tests/data で検証済みという前提で型を与える
const gameData: GameData = rawGameData as GameData

export function getGameData(): GameData {
  return gameData
}

function lookup<T>(table: readonly T[], id: number, kind: string): T {
  // 範囲外 ID を undefined のまま戦闘ロジックへ流すと原因が追いにくいので即座に失敗させる
  if (!Number.isInteger(id) || id < 0 || id >= table.length) {
    throw new RangeError(`${kind} ID ${id} は範囲外（0..${table.length - 1}）`)
  }
  return table[id]
}

export function getMonster(id: number): MonsterDef {
  return lookup(gameData.monsters, id, 'モンスター')
}

export function getCommand(id: number): CommandDef {
  return lookup(gameData.commands, id, 'コマンド')
}

export function getDamage(id: number): DamageDef {
  return lookup(gameData.damages, id, 'ダメージ')
}

/** index は 0 始まり（UI の「試合 N」は index + 1） */
export function getMatchCard(index: number): MatchCardDef {
  return lookup(gameData.matchCards, index, '試合')
}

/**
 * 通常攻撃のコマンド ID。
 * RGH 008 $025F50「直接攻撃戦闘行動ID」/ RGH 011 $02679D「行動が決められない場合は直接攻撃」が #$0001。
 */
export const NORMAL_ATTACK_COMMAND_ID = 1

/**
 * 格闘場で実際に実行されるコマンド ID。
 * dq3_commands.xml「格闘場使用許可」: 0 のコマンドは普通の攻撃に置き換わる。
 * 置換先が ID 1 そのものかはコードで未確認（fidelity: likely）。
 */
export function toArenaCommandId(commandId: number): number {
  return getCommand(commandId).flags.arenaAllowed ? commandId : NORMAL_ATTACK_COMMAND_ID
}
