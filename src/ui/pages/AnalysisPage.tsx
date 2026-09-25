import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchOffer } from '../../core/arena/types'
import { randomSeed } from '../../core/rng/RandomSource'
import { summarizeRow, type WinDistribution } from '../../core/stats/winDistribution'
import { Window } from '../components/Window'
import { useArenaDeps, useArenaState } from '../hooks/arenaContext'
import { DEFAULT_HERO_LEVEL, clampHeroLevel, currentOffer } from '../logic/arenaFlow'
import { analyze } from '../logic/analysisClient'
import { formatOdds, formatPercent, slotLetter } from '../logic/format'

const TRIAL_CHOICES = [100, 1000, 5000, 10000]

/**
 * 通常ゲームと分離した解析画面。所持金・履歴には一切影響しない。
 * 「賭け先によって勝者分布が変わるか」（Group 4 分岐の影響）を見るため、賭け先ごとに行を分ける。
 */
export function AnalysisPage() {
  const { game } = useArenaDeps()
  const { session } = useArenaState()
  const [source, setSource] = useState<'current' | 'card'>(session ? 'current' : 'card')
  const cards = useMemo(() => game.listCards(), [game])
  const [cardIndex, setCardIndex] = useState(0)
  const [heroLevel, setHeroLevel] = useState(session?.heroLevel ?? DEFAULT_HERO_LEVEL)
  const [offerSeed, setOfferSeed] = useState(() => randomSeed())
  const [trials, setTrials] = useState(1000)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ offer: MatchOffer; dist: WinDistribution; seed: number; aborted: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const offer = useMemo(() => {
    if (source === 'current' && session) return currentOffer(game, session)
    return game.createOfferForCard({ cardIndex, heroLevel: clampHeroLevel(heroLevel), round: 0, seed: offerSeed })
  }, [game, session, source, cardIndex, heroLevel, offerSeed])

  const run = async () => {
    const ac = new AbortController()
    abortRef.current = ac
    const seed = randomSeed()
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const { dist, aborted } = await analyze({
        game,
        offer,
        trialsPerBet: trials,
        seed,
        signal: ac.signal,
        onProgress: (done, total, d) => {
          setProgress({ done, total })
          // 途中経過も表で見せる（長い試行でも傾向が早く分かるように）。dist は破壊的更新なので浅くコピー
          setResult({ offer, dist: { slots: d.slots, rows: { ...d.rows } }, seed, aborted: false })
        },
      })
      setResult({ offer, dist, seed, aborted })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="page">
      <Window title="Analysis — Simulate">
        <p className="muted small">
          同じ試合を多数回シミュレートして P(勝者 = i | 試合, 賭け先 = j) を推定します。所持金・履歴には影響しません。
        </p>
        <div className="analysis-form">
          <label className="radio">
            <input type="radio" checked={source === 'current'} disabled={!session} onChange={() => setSource('current')} />
            現在の試合{session ? `（第 ${session.round} 試合）` : '（セッションなし）'}
          </label>
          <label className="radio">
            <input type="radio" checked={source === 'card'} onChange={() => setSource('card')} />
            カードを選ぶ
          </label>
          {source === 'card' && (
            <div className="autoplay-row">
              <select
                className="dq-select dq-select-wide"
                value={cardIndex}
                onChange={(e) => setCardIndex(Number(e.target.value))}
                aria-label="試合カード"
              >
                {cards.map((c) => (
                  <option key={c.index} value={c.index}>
                    試合 {c.index + 1}: {c.names.join(' / ')}
                  </option>
                ))}
              </select>
              <label>
                Lv{' '}
                <input
                  className="dq-input dq-input-short"
                  type="number"
                  min={1}
                  max={99}
                  value={heroLevel}
                  onChange={(e) => setHeroLevel(Number(e.target.value))}
                />
              </label>
              <button type="button" className="dq-btn dq-btn-small" onClick={() => setOfferSeed(randomSeed())}>
                オッズを引き直す
              </button>
            </div>
          )}
          <div className="analysis-offer">
            試合 {offer.cardIndex + 1}:{' '}
            {offer.contestants.map((c) => `${slotLetter(c.slot)}. ${c.name} ${formatOdds(game.oddsValue(offer, c.slot))}`).join(' / ')}
          </div>
          <div className="autoplay-row">
            <label>
              賭け先ごとの試行数{' '}
              <select className="dq-select" value={trials} onChange={(e) => setTrials(Number(e.target.value))} disabled={running}>
                {TRIAL_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    × {n}
                  </option>
                ))}
              </select>
            </label>
            {running ? (
              <button type="button" className="dq-btn dq-btn-danger" onClick={() => abortRef.current?.abort()}>
                中止
              </button>
            ) : (
              <button type="button" className="dq-btn dq-btn-primary" onClick={run}>
                Simulate × {trials}
              </button>
            )}
          </div>
          {progress && running && <progress className="dq-progress" max={progress.total} value={progress.done} />}
          {error && <p className="error">シミュレーションに失敗しました: {error}</p>}
        </div>
      </Window>

      {result && <DistributionTable {...result} running={running} />}
    </div>
  )
}

function DistributionTable({
  offer,
  dist,
  seed,
  aborted,
  running,
}: {
  offer: MatchOffer
  dist: WinDistribution
  seed: number
  aborted: boolean
  running: boolean
}) {
  const { game } = useArenaDeps()
  const rows = dist.slots.map((j) => summarizeRow(dist.rows[j], dist.slots))
  const bestEv = Math.max(...rows.map((r) => r.meanDelta))
  // 全行が同値（例: 全試合引き分け）のときは「最善の賭け先」が無いので強調しない
  const bestUnique = rows.filter((r) => r.meanDelta === bestEv).length === 1
  return (
    <Window title={`結果${running ? '（計算中）' : aborted ? '（中止・途中まで）' : ''}`}>
      <div className="table-scroll">
        <table className="dq-table analysis-table">
          <thead>
            <tr>
              <th>賭け先 j</th>
              <th>試行</th>
              {dist.slots.map((i) => (
                <th key={i}>
                  P({slotLetter(i)} 勝)
                </th>
              ))}
              <th>引分</th>
              <th title="10 ターン経過時に賭けた選手が倒れ、他が複数生存（終了タイプ 6）">勝者なし(はずれ)</th>
              <th>的中率</th>
              <th>平均T</th>
              <th>期待増減/試合</th>
              <th>回収率</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = offer.contestants.find((x) => x.slot === r.betSlot)
              return (
                <tr key={r.betSlot} className={bestUnique && r.meanDelta === bestEv && r.trials > 0 ? 'is-winner' : undefined}>
                  <th>
                    {slotLetter(r.betSlot)}. {c?.name} {formatOdds(game.oddsValue(offer, r.betSlot))}
                  </th>
                  <td>{r.trials}</td>
                  {dist.slots.map((i) => (
                    <td key={i} className={i === r.betSlot ? 'diag' : undefined}>
                      {formatPercent(r.winProb[i])}
                    </td>
                  ))}
                  <td>{formatPercent(r.drawProb)}</td>
                  <td>{formatPercent(r.noWinnerProb)}</td>
                  <td>
                    {formatPercent(r.hitProb)}
                    <span className="muted small"> ±{(r.hitStdError * 100 * 1.96).toFixed(1)}</span>
                  </td>
                  <td>{r.meanTurns.toFixed(1)}</td>
                  <td className={r.meanDelta >= 0 ? 'plus' : 'minus'}>{r.meanDelta.toFixed(1)} G</td>
                  <td>{formatPercent(r.returnRate)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        対角（太字）= 賭けた選手自身の勝率。± は 95% 信頼区間の半幅。battle seed 系列の元 {seed}。
      </p>
    </Window>
  )
}
