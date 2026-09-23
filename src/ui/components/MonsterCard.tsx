import type { MatchObservation } from '../../ai/BettingAgent'
import type { Contestant } from '../../core/arena/types'
import { aggregateActions, formatOdds, formatPercent, slotLetter } from '../logic/format'

type ObservedContestant = MatchObservation['contestants'][number]

/**
 * 出場モンスター 1 体のカード。
 *
 * Analyst 情報は ArenaGame.observe の結果（＝エージェントに渡すのと同じ情報）から表示する。
 * MonsterDef を直接解釈しないのは、UI と AI で見せる情報を必ず一致させるため。
 */
export function MonsterCard({
  contestant,
  odds,
  observed,
  onBet,
  betDisabled,
  betLabel = 'BET',
  onDetails,
  marks,
}: {
  contestant: Contestant
  odds: number
  observed?: ObservedContestant
  onBet?: () => void
  betDisabled?: boolean
  betLabel?: string
  onDetails?: () => void
  marks?: { bet?: boolean; winner?: boolean; probability?: number; jevPick?: boolean }
}) {
  const stats = observed?.stats
  const classes = ['monster-card']
  if (marks?.bet || marks?.jevPick) classes.push('is-picked')
  if (marks?.winner) classes.push('is-winner')
  return (
    <article className={classes.join(' ')}>
      <header className="monster-card-head">
        <span className="monster-slot">{slotLetter(contestant.slot)}</span>
        <span className="monster-name">{contestant.name}</span>
      </header>
      <div className="monster-odds">{formatOdds(odds)}</div>
      {marks?.probability !== undefined && (
        <div className="monster-prob">
          Jev 予測 {formatPercent(marks.probability, 0)}
          {marks.jevPick && <span className="tag">← BET</span>}
        </div>
      )}
      {(marks?.bet || marks?.winner) && (
        <div className="monster-tags">
          {marks.bet && <span className="tag">賭けた選手</span>}
          {marks.winner && <span className="tag tag-win">勝者</span>}
        </div>
      )}
      {stats && (
        <dl className="monster-stats">
          <dt>HP</dt>
          <dd>{stats.maxHp}</dd>
          <dt>MP</dt>
          <dd>{stats.mp}</dd>
          <dt>攻撃</dt>
          <dd>{stats.attack}</dd>
          <dt>守備</dt>
          <dd>{stats.defense}</dd>
          <dt>素早さ</dt>
          <dd>{stats.agility}</dd>
        </dl>
      )}
      {observed?.actions && (
        <p className="monster-line">
          <span className="label">行動</span>
          {aggregateActions(observed.actions).map((a, i) => (
            <span
              key={i}
              className={a.forbiddenInArena ? 'struck' : undefined}
              title={a.forbiddenInArena ? '格闘場では選ばれない（他の行動から選び直す）' : `${a.slots} 枠`}
            >
              {a.name}
              {a.weight !== null && !a.forbiddenInArena && <span className="muted"> {formatPercent(a.weight, 0)}</span>}
            </span>
          ))}
        </p>
      )}
      {observed?.ai && (
        <p className="monster-line">
          <span className="label">AI</span>
          {observed.ai.strategy} / {observed.ai.selectionJudgmentLabel ?? `判断${observed.ai.selectionJudgment}`} /{' '}
          {observed.ai.multiAction}
          {observed.ai.concentrate ? ' / 集中' : ''}
        </p>
      )}
      {observed?.resistances && <ResistanceLine resistances={observed.resistances} />}
      {observed?.traits && observed.traits.length > 0 && (
        <p className="monster-line">
          <span className="label">特性</span>
          {observed.traits.join('、')}
        </p>
      )}
      <div className="monster-actions">
        {onBet && (
          <button type="button" className="dq-btn dq-btn-primary" onClick={onBet} disabled={betDisabled}>
            {betLabel}
          </button>
        )}
        {onDetails && (
          <button type="button" className="dq-btn dq-btn-small" onClick={onDetails}>
            Details
          </button>
        )}
      </div>
    </article>
  )
}

export function ResistanceLine({ resistances }: { resistances: Record<string, number> }) {
  const entries = Object.entries(resistances).filter(([, v]) => v > 0)
  return (
    <p className="monster-line">
      <span className="label">耐性</span>
      {entries.length === 0 ? 'なし' : entries.map(([k, v]) => `${k}${v}`).join(' ')}
    </p>
  )
}
