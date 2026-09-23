import type { BattleLogEntry } from '../../core/battle/types'

export type LogLayer = 'simple' | 'detail' | 'internal'

export interface TurnGroup {
  turn: number
  entries: BattleLogEntry[]
}

/** ターン単位にまとめる（Replay の 1 ステップ = 1 グループ）。出現順を保つため Map は使わず線形に走査する */
export function groupByTurn(log: BattleLogEntry[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  for (const e of log) {
    const last = groups[groups.length - 1]
    if (last && last.turn === e.turn) last.entries.push(e)
    else groups.push({ turn: e.turn, entries: [e] })
  }
  return groups
}

/**
 * レイヤーごとに見せるべきエントリか。
 * Simple 層は文が空のイベント（turn-end 等の内部区切り）を出すとノイズになるので除く。
 */
export function visibleIn(layer: LogLayer, e: BattleLogEntry): boolean {
  if (layer === 'simple') return e.simple.trim() !== ''
  return true
}

export function formatKv(obj: Record<string, number | string | boolean> | undefined): string {
  if (!obj) return ''
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('  ')
}
