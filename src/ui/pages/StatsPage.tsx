import { useMemo } from 'react'
import {
  brierScore,
  calibrationBins,
  computeSessionStats,
  meanSelfExpectedReturn,
  topPickAccuracy,
} from '../../core/stats/sessionStats'
import { Window } from '../components/Window'
import { useArenaState } from '../hooks/arenaContext'
import { toStatRecord } from '../logic/arenaFlow'
import { buildExport } from '../logic/exportData'
import { formatGold, formatPercent, formatSignedGold } from '../logic/format'

export function StatsPage() {
  const { session, history, settings } = useArenaState()
  const records = useMemo(() => history.map(toStatRecord), [history])
  const predicted = useMemo(() => records.filter((r) => r.probabilities), [records])

  if (!session) return <p className="muted">セッションがありません。</p>
  const s = computeSessionStats(records, session.initialGold, session.gold)
  const brier = brierScore(predicted)
  const top = topPickAccuracy(predicted)
  const selfEv = meanSelfExpectedReturn(predicted)
  const bins = calibrationBins(predicted).filter((b) => b.count > 0)

  const exportJson = () => {
    const payload = buildExport({ session, history, settings })
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dq3-arena-${session.id}.json`
    a.click()
    // クリック直後に revoke すると一部ブラウザでダウンロードが始まらないため少し遅らせる
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="page">
      <Window title="Statistics">
        <dl className="stats-grid">
          <dt>Matches</dt>
          <dd>{s.matches}</dd>
          <dt>Wins</dt>
          <dd>
            {s.wins}
            <span className="muted small">（負 {s.losses} / 分 {s.draws}）</span>
          </dd>
          <dt>Win Rate</dt>
          <dd>{formatPercent(s.winRate)}</dd>
          <dt>Initial Gold</dt>
          <dd>{formatGold(s.initialGold)}</dd>
          <dt>Current Gold</dt>
          <dd>{formatGold(s.currentGold)}</dd>
          <dt>Profit</dt>
          <dd className={s.profit >= 0 ? 'plus' : 'minus'}>{formatSignedGold(s.profit)}</dd>
          <dt>Total Staked</dt>
          <dd>{formatGold(s.totalStaked)}</dd>
          <dt>ROI</dt>
          <dd title="Profit ÷ 賭け金総額">{formatPercent(s.roi)}</dd>
        </dl>
      </Window>

      <Window title="AI 予測の評価">
        {predicted.length === 0 ? (
          <p className="muted">予測付きの試合がありません（Jev モードで遊ぶと記録されます）。</p>
        ) : (
          <>
            <dl className="stats-grid">
              <dt>予測付き試合</dt>
              <dd>{predicted.length}</dd>
              <dt>Brier Score</dt>
              <dd title="0 が最良。一様予測（例: 3 体なら 0.667）より小さいかが目安">
                {brier.score === null ? '—' : brier.score.toFixed(4)}
              </dd>
              <dt>本命的中率</dt>
              <dd title="予測確率が最大の選手が勝った割合">{formatPercent(top.rate)}</dd>
              <dt>自己期待倍率</dt>
              <dd title="エージェント自身の予測で見た、賭けた選手の 勝率×倍率 の平均。1 未満なら自分でも損と見ている">
                {selfEv === null ? '—' : selfEv.toFixed(3)}
              </dd>
            </dl>
            <h3>Calibration</h3>
            <table className="dq-table">
              <thead>
                <tr>
                  <th>予測区間</th>
                  <th>件数</th>
                  <th>平均予測</th>
                  <th>実際の勝率</th>
                </tr>
              </thead>
              <tbody>
                {bins.map((b) => (
                  <tr key={b.lower}>
                    <td>
                      {Math.round(b.lower * 100)}–{Math.round(b.upper * 100)}%
                    </td>
                    <td>{b.count}</td>
                    <td>{formatPercent(b.meanPredicted)}</td>
                    <td>{formatPercent(b.observedRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">EV regret（真の勝率との比較）は Monte Carlo 結果の保存と合わせて今後追加予定。</p>
          </>
        )}
      </Window>

      <Window title="Export">
        <p className="muted small">設定・セッション・履歴を JSON で保存します。API キーは含まれません。</p>
        <button type="button" className="dq-btn" onClick={exportJson}>
          JSON をダウンロード
        </button>
      </Window>
    </div>
  )
}
