import { useEffect, useMemo, useState } from 'react'
import type { BattleLogEntry } from '../../core/battle/types'
import { groupByTurn, visibleIn, type LogLayer } from '../logic/logView'
import { LogEntryLine, LogLayerTabs } from './BattleLogView'

const SPEEDS = [
  { ms: 1200, label: '遅い' },
  { ms: 600, label: '普通' },
  { ms: 200, label: '速い' },
]

/** ログをターン単位で段階表示する簡易リプレイ。戦闘を再計算せず、確定済みログを見せるだけ */
export function ReplayView({ log }: { log: BattleLogEntry[] }) {
  const groups = useMemo(() => groupByTurn(log), [log])
  const [step, setStep] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(600)
  const [layer, setLayer] = useState<LogLayer>('simple')
  const atEnd = step >= groups.length

  useEffect(() => {
    if (!playing || atEnd) return
    const t = setTimeout(() => setStep((s) => s + 1), speed)
    return () => clearTimeout(t)
  }, [playing, atEnd, step, speed])

  const shown = groups.slice(0, step)
  const current = groups[step - 1]

  return (
    <div className="replay">
      <div className="replay-controls">
        <button type="button" className="dq-btn dq-btn-small" onClick={() => setStep(1)} disabled={step <= 1}>
          ⏮ 最初
        </button>
        <button type="button" className="dq-btn dq-btn-small" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step <= 1}>
          ◀ 前へ
        </button>
        <button type="button" className="dq-btn dq-btn-small dq-btn-primary" onClick={() => setStep((s) => s + 1)} disabled={atEnd}>
          次へ ▶
        </button>
        <button
          type="button"
          className="dq-btn dq-btn-small"
          onClick={() => {
            if (atEnd) setStep(1)
            setPlaying((p) => !p || atEnd)
          }}
        >
          {playing && !atEnd ? '⏸ 停止' : '▶ 自動再生'}
        </button>
        <select className="dq-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="再生速度">
          {SPEEDS.map((s) => (
            <option key={s.ms} value={s.ms}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="muted">
          {current ? (current.turn === 0 ? '開始' : `ターン ${current.turn}`) : ''}（{step}/{groups.length}）
        </span>
      </div>
      <LogLayerTabs layer={layer} onChange={setLayer} />
      <div className="battle-log-body replay-body">
        {shown.map((g, gi) => (
          <ol key={gi} className={`log-turn${gi === shown.length - 1 ? ' is-current' : ''}`}>
            {g.entries
              .filter((e) => visibleIn(layer, e))
              .map((e, i) => (
                <LogEntryLine key={i} entry={e} layer={layer} />
              ))}
          </ol>
        ))}
      </div>
    </div>
  )
}
