import type { ReactNode } from 'react'

/** ドラクエ風の黒地・白枠ウィンドウ。見た目の統一のため全画面の枠をこれに寄せる */
export function Window({
  title,
  children,
  className,
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`dq-window${className ? ` ${className}` : ''}`}>
      {title !== undefined && <h2 className="dq-window-title">{title}</h2>}
      {children}
    </section>
  )
}
