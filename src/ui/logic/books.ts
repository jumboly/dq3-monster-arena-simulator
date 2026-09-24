/** 冒険の書の一覧・比較表示用の純関数 */
import { brierScore, computeSessionStats, topPickAccuracy, type SessionStats } from '../../core/stats/sessionStats'
import type { HistoryEntry, Session } from '../../storage/session'
import { toStatRecord } from './arenaFlow'

/** 最後に遊んだ冊を上に出す（チャット履歴と同じく、続きから遊ぶ冊ほど探しやすくするため） */
export function sortBooks(books: Session[]): Session[] {
  return [...books].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

/** 遊んだ試合数。round は「これから遊ぶ試合番号」なので、結果表示中かどうかで 1 ずれる */
export function matchesPlayed(s: Session): number {
  return s.phase === 'result' ? s.round : s.round - 1
}

export interface BookComparisonRow {
  session: Session
  stats: SessionStats
  /** 予測付き試合の数。Brier などの母数（少ないと比較にならないので表に出す） */
  predicted: number
  brier: number | null
  topPick: number | null
}

/**
 * 冒険の書どうしの比較表の 1 行を作る。
 * 画面ごとに集計がぶれないよう、単冊の統計画面と同じ関数（computeSessionStats など）を通す。
 */
export function compareBook(session: Session, history: HistoryEntry[]): BookComparisonRow {
  const records = history.map(toStatRecord)
  const predicted = records.filter((r) => r.probabilities)
  return {
    session,
    stats: computeSessionStats(records, session.initialGold, session.gold),
    predicted: predicted.length,
    brier: brierScore(predicted).score,
    topPick: topPickAccuracy(predicted).rate,
  }
}
