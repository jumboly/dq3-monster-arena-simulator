import { useEffect, useRef, type ReactNode } from 'react'

/**
 * ネイティブ <dialog> を使ったモーダル。
 * フォーカス閉じ込め・Esc で閉じる・背面の無効化をブラウザ標準に任せられるため自作しない。
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`dq-window dq-modal${wide ? ' dq-modal-wide' : ''}`}
      onClose={onClose}
      onClick={(e) => {
        // 背景（dialog 自身）クリックで閉じる。中身のクリックは target が子要素になる
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {open && (
        <div className="dq-modal-body">
          <div className="dq-modal-head">
            <h2 className="dq-window-title">{title}</h2>
            <button type="button" className="dq-btn dq-btn-small" onClick={onClose} aria-label="閉じる">
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'はい',
  cancelLabel = 'いいえ',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: ReactNode
  children: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <div className="dq-confirm">{children}</div>
      <div className="dq-actions">
        <button type="button" className="dq-btn dq-btn-primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="dq-btn" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </Modal>
  )
}
