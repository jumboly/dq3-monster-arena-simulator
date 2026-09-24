import { useRef, type KeyboardEvent } from 'react'
import type { Session } from '../../storage/session'
import { useArenaDeps } from '../hooks/arenaContext'
import { matchesPlayed, sortBooks } from '../logic/books'
import { formatGold } from '../logic/format'

/**
 * 冒険の書の一覧。▶ カーソルと ↑↓ キーで選ぶ DQ の選択画面に寄せる。
 * 行はすべて button なので Tab / Enter でも操作でき、支援技術からも普通のボタン列に見える。
 */
export function BookList({
  books,
  activeId,
  highlightId,
  onPick,
  disabled,
  autoFocus,
}: {
  books: Session[]
  activeId?: string | null
  /** 直前にうつした冊など、目立たせたい冊 */
  highlightId?: string | null
  onPick: (s: Session) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  const { game } = useArenaDeps()
  const ref = useRef<HTMLUListElement>(null)
  const sorted = sortBooks(books)

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  return (
    <ul className="book-list" ref={ref} onKeyDown={onKeyDown}>
      {sorted.map((b, i) => {
        const broke = b.gold < game.stakeFor(b.heroLevel)
        return (
          <li key={b.id}>
            <button
              type="button"
              className={`book-row${b.id === highlightId ? ' is-highlight' : ''}`}
              onClick={() => onPick(b)}
              disabled={disabled}
              autoFocus={autoFocus && (highlightId ? b.id === highlightId : i === 0)}
              aria-current={b.id === activeId ? 'true' : undefined}
            >
              <span className="book-name">
                {b.name}
                {b.id === activeId && <span className="tag">いま</span>}
                {broke && <span className="tag tag-lose">破産</span>}
              </span>
              <span className="book-gold">{formatGold(b.gold)}</span>
              <span className="book-sub muted small">
                Lv.{b.heroLevel} ・ {b.informationMode === 'analyst' ? 'Analyst' : 'Classic'} / {b.playerMode === 'jev' ? 'Jev' : 'Human'} ・{' '}
                {matchesPlayed(b)} 試合 ・ {new Date(b.updatedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
