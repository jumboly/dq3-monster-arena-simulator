/** 冒険の書の一覧表示用の純関数 */
import type { Session } from '../../storage/session'

/** 最後に遊んだ冊を上に出す（チャット履歴と同じく、続きから遊ぶ冊ほど探しやすくするため） */
export function sortBooks(books: Session[]): Session[] {
  return [...books].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

/** 遊んだ試合数。round は「これから遊ぶ試合番号」なので、結果表示中かどうかで 1 ずれる */
export function matchesPlayed(s: Session): number {
  return s.phase === 'result' ? s.round : s.round - 1
}
