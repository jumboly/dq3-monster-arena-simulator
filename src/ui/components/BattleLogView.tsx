import { useState } from 'react'
import type { BattleLogEntry } from '../../core/battle/types'
import { formatKv, groupByTurn, visibleIn, type LogLayer } from '../logic/logView'

const LAYERS: Array<{ id: LogLayer; label: string }> = [
  { id: 'simple', label: 'Simple' },
  { id: 'detail', label: 'Detail' },
  { id: 'internal', label: 'Internal' },
]

export function LogLayerTabs({ layer, onChange }: { layer: LogLayer; onChange: (l: LogLayer) => void }) {
  return (
    <div className="dq-tabs" role="tablist" aria-label="ログの詳しさ">
      {LAYERS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="tab"
          aria-selected={layer === l.id}
          className={`dq-tab${layer === l.id ? ' is-active' : ''}`}
          onClick={() => onChange(l.id)}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

export function LogEntryLine({ entry, layer }: { entry: BattleLogEntry; layer: LogLayer }) {
  return (
    <li className={`log-entry log-${entry.kind}`}>
      {entry.simple && <span className="log-simple">{entry.simple}</span>}
      {layer !== 'simple' && !entry.simple && <span className="log-kind">[{entry.kind}]</span>}
      {layer !== 'simple' && entry.detail && <code className="log-kv">{formatKv(entry.detail)}</code>}
      {layer === 'internal' && (
        <code className="log-kv log-internal">
          kind={entry.kind}
          {entry.actorSlot !== undefined ? `  actor=${entry.actorSlot}` : ''}
          {entry.targetSlots ? `  targets=${entry.targetSlots.join(',')}` : ''}
          {entry.internal ? `  ${formatKv(entry.internal)}` : ''}
        </code>
      )}
    </li>
  )
}

export function BattleLogView({ log, initialLayer = 'simple' }: { log: BattleLogEntry[]; initialLayer?: LogLayer }) {
  const [layer, setLayer] = useState<LogLayer>(initialLayer)
  const groups = groupByTurn(log)
  return (
    <div className="battle-log">
      <LogLayerTabs layer={layer} onChange={setLayer} />
      <div className="battle-log-body">
        {groups.map((g, gi) => {
          const entries = g.entries.filter((e) => visibleIn(layer, e))
          if (entries.length === 0) return null
          return (
            <ol key={gi} className="log-turn">
              {entries.map((e, i) => (
                <LogEntryLine key={i} entry={e} layer={layer} />
              ))}
            </ol>
          )
        })}
      </div>
    </div>
  )
}
