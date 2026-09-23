import type { MatchObservation } from '../../ai/BettingAgent'
import type { Contestant } from '../../core/arena/types'
import { formatOdds, slotLetter } from '../logic/format'

type ObservedContestant = MatchObservation['contestants'][number]

/**
 * Details の中身。Classic モードでは公開情報（名前・オッズ）以外を出さない。
 * 実機の窓口で見えない情報を Classic で見せると、情報モードを分けた意味が無くなるため。
 */
export function ContestantDetails({
  contestant,
  odds,
  observed,
}: {
  contestant: Contestant
  odds: number
  observed: ObservedContestant | undefined
}) {
  return (
    <div className="details">
      <p>
        {slotLetter(contestant.slot)}. <strong>{contestant.name}</strong> {formatOdds(odds)}
      </p>
      <p className="muted">
        試合内部値: monsterId {contestant.monsterId} / baseOdds {contestant.baseOdds}
      </p>
      {!observed?.stats ? (
        <p className="muted">Classic モードでは能力値などは表示されません（Settings で Analyst に切り替え可能）。</p>
      ) : (
        <>
          <table className="dq-table">
            <tbody>
              <tr>
                <th>HP</th>
                <td>{observed.stats.maxHp}</td>
                <th>MP</th>
                <td>{observed.stats.mp}</td>
              </tr>
              <tr>
                <th>攻撃</th>
                <td>{observed.stats.attack}</td>
                <th>守備</th>
                <td>{observed.stats.defense}</td>
              </tr>
              <tr>
                <th>素早さ</th>
                <td>{observed.stats.agility}</td>
                <th />
                <td />
              </tr>
            </tbody>
          </table>
          {observed.actions && (
            <>
              <h3>行動（8 枠）</h3>
              <ol className="details-actions">
                {observed.actions.map((a, i) => (
                  <li key={i}>
                    {a.name}
                    {a.replacedByAttack && <span className="muted">（格闘場では通常攻撃に置換）</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
          {observed.ai && (
            <>
              <h3>AI</h3>
              <p>
                戦略: {observed.ai.strategy} / 選択判断: {observed.ai.selectionJudgment} / 複数回:{' '}
                {observed.ai.multiAction} / 集中攻撃: {observed.ai.concentrate ? 'あり' : 'なし'}
              </p>
            </>
          )}
          {observed.resistances && (
            <>
              <h3>耐性</h3>
              <p>
                {Object.entries(observed.resistances)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(' / ') || 'なし'}
              </p>
            </>
          )}
          {observed.traits && observed.traits.length > 0 && (
            <>
              <h3>特性</h3>
              <p>{observed.traits.join('、')}</p>
            </>
          )}
        </>
      )}
    </div>
  )
}
