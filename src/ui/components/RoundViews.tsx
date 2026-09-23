/**
 * 1 試合分（Match / Bet / Result / Prediction）の表示部品。
 * Arena の結果画面と History の詳細で同じ見た目にするため共通化している。
 */
import type { MatchOffer } from '../../core/arena/types'
import type { HistoryEntry, Prediction } from '../../storage/session'
import { predictionBySlot, resultLabel, winnerName, winnerSlotOf } from '../logic/arenaFlow'
import { formatGold, formatOdds, formatPercent, formatSignedGold, slotLetter } from '../logic/format'

function oddsOf(offer: MatchOffer, slot: number): number {
  const c = offer.contestants.find((x) => x.slot === slot)
  return c ? c.odds.integer + c.odds.tenths / 10 : 0
}

export function ResultSummary({ entry }: { entry: HistoryEntry }) {
  const label = resultLabel(entry)
  const bet = entry.offer.contestants.find((c) => c.slot === entry.betSlot)
  const winner = winnerName(entry)
  return (
    <div className="result-summary">
      <p className={`result-label result-${label.toLowerCase()}`}>{label}</p>
      <p>
        賭けた選手: {slotLetter(entry.betSlot)}. {bet?.name} {formatOdds(oddsOf(entry.offer, entry.betSlot))}（{formatGold(entry.offer.stake)}）
      </p>
      <p>
        勝者:{' '}
        {winner
          ? `${slotLetter(winnerSlotOf(entry)!)}. ${winner}`
          : noWinnerText(entry.summary.outcome)}
        <span className="muted"> / {entry.summary.turns} ターン</span>
      </p>
      <p className={`result-delta ${entry.delta >= 0 ? 'plus' : 'minus'}`}>{formatSignedGold(entry.delta)}</p>
      <p className="result-gold">
        Gold {formatGold(entry.goldBefore)} → {formatGold(entry.goldAfter)}
      </p>
    </div>
  )
}

export function MatchTable({ entry }: { entry: HistoryEntry }) {
  const w = winnerSlotOf(entry)
  const probs = predictionBySlot(entry)
  return (
    <table className="dq-table">
      <thead>
        <tr>
          <th />
          <th>選手</th>
          <th>オッズ</th>
          {probs && <th>予測</th>}
          <th />
        </tr>
      </thead>
      <tbody>
        {entry.offer.contestants.map((c) => (
          <tr key={c.slot} className={c.slot === w ? 'is-winner' : undefined}>
            <td>{slotLetter(c.slot)}</td>
            <td>{c.name}</td>
            <td>{formatOdds(oddsOf(entry.offer, c.slot))}</td>
            {probs && <td>{formatPercent(probs[c.slot] ?? null, 0)}</td>}
            <td>
              {c.slot === entry.betSlot && <span className="tag">BET</span>}
              {c.slot === w && <span className="tag tag-win">勝者</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** `A 21% / B 61% ← BET / C 18%` 形式の予測表示 */
export function PredictionLine({ offer, prediction }: { offer: MatchOffer; prediction: Prediction }) {
  const probs = predictionBySlot({ offer, prediction })!
  const ids = prediction.observationIds ?? offer.contestants.map((c) => String(c.slot))
  const betK = ids.indexOf(prediction.decision.bet)
  return (
    <div className="prediction">
      <p className="prediction-line">
        <span className="label">{prediction.agentLabel}</span>{' '}
        {offer.contestants.map((c, k) => (
          <span key={c.slot} className={k === betK ? 'prediction-pick' : undefined}>
            {slotLetter(c.slot)} {c.name} {formatPercent(probs[c.slot], 0)}
            {k === betK && ' ← BET'}
            {k < offer.contestants.length - 1 && ' / '}
          </span>
        ))}
      </p>
      <p className="prediction-reason">Reason: {prediction.decision.reason}</p>
      {prediction.decision.meta && (
        <p className="muted small">
          {Object.entries(prediction.decision.meta)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' / ')}
        </p>
      )}
    </div>
  )
}

/**
 * 単独勝者がいない結末の説明。10 ターン経過時に賭けた選手が倒れていて他が 2 体以上残ると、
 * 引き分けではなくハズレ（終了タイプ 6）になるので、引き分けと区別して表示する。
 */
function noWinnerText(o: HistoryEntry['summary']['outcome']): string {
  if (o.kind === 'no-winner') return 'なし（10 ターン経過・賭けた選手は倒れたため はずれ）'
  if (o.kind === 'draw') return o.reason === 'turn-limit' ? 'なし（10 ターン経過で引き分け）' : 'なし（全員倒れて引き分け）'
  return 'なし'
}
