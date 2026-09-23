import { useMemo, useState } from 'react'
import type { HistoryEntry } from '../../storage/session'
import { BattleLogView } from '../components/BattleLogView'
import { Modal } from '../components/Modal'
import { ReplayView } from '../components/ReplayView'
import { MatchTable, PredictionLine, ResultSummary } from '../components/RoundViews'
import { Window } from '../components/Window'
import { useArenaDeps, useArenaState } from '../hooks/arenaContext'
import { battleFor, resultLabel } from '../logic/arenaFlow'
import { formatOdds, formatSignedGold } from '../logic/format'

/** 1 ページの表示件数。Auto Play 1000 回分を一度に描画すると重いので区切る */
const PAGE_SIZE = 50

export function HistoryPage() {
  const { history } = useArenaState()
  const [selected, setSelected] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const reversed = useMemo(() => [...history].reverse(), [history])
  const pages = Math.max(1, Math.ceil(reversed.length / PAGE_SIZE))
  const shown = reversed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const entry = history.find((h) => h.round === selected)

  return (
    <div className="page">
      <Window title={`History（${history.length} 試合）`}>
        {history.length === 0 ? (
          <p className="muted">まだ試合がありません。</p>
        ) : (
          <>
            <ul className="history-list">
              {shown.map((h) => {
                const label = resultLabel(h)
                const bet = h.offer.contestants.find((c) => c.slot === h.betSlot)
                const odds = bet ? bet.odds.integer + bet.odds.tenths / 10 : 0
                return (
                  <li key={h.round}>
                    <button type="button" className="history-row" onClick={() => setSelected(h.round)}>
                      <span className="history-round">#{h.round}</span>
                      <span className={`history-label result-${label.toLowerCase()}`}>{label}</span>
                      <span className="history-name">{bet?.name}</span>
                      <span className="history-odds">{formatOdds(odds).replace(' ', '')}</span>
                      <span className={`history-delta ${h.delta >= 0 ? 'plus' : 'minus'}`}>{formatSignedGold(h.delta)}</span>
                      {h.prediction && <span className="tag" title={h.prediction.agentLabel}>{h.auto ? 'Auto' : 'Jev'}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
            {pages > 1 && (
              <div className="dq-actions">
                <button type="button" className="dq-btn dq-btn-small" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  ◀ 新しい
                </button>
                <span>
                  {page + 1} / {pages}
                </span>
                <button type="button" className="dq-btn dq-btn-small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  古い ▶
                </button>
              </div>
            )}
          </>
        )}
      </Window>
      <Modal open={entry !== undefined} title={entry ? `#${entry.round} の詳細` : ''} onClose={() => setSelected(null)} wide>
        {entry && <HistoryDetail key={entry.round} entry={entry} />}
      </Modal>
    </div>
  )
}

function HistoryDetail({ entry }: { entry: HistoryEntry }) {
  const { game } = useArenaDeps()
  const [view, setView] = useState<'log' | 'replay'>('log')
  // 刈り込み済みの古い試合は seed から再生成する。失敗（エンジン側の例外）も画面を落とさず表示する
  const regen = useMemo(() => {
    try {
      return { ok: true as const, ...battleFor(game, entry) }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  }, [game, entry])

  return (
    <div className="history-detail">
      <h3>Match</h3>
      <MatchTable entry={entry} />
      <h3>Bet / Result</h3>
      <ResultSummary entry={entry} />
      {entry.prediction && (
        <>
          <h3>Prediction</h3>
          <PredictionLine offer={entry.offer} prediction={entry.prediction} />
        </>
      )}
      <h3>Battle Log</h3>
      {!regen.ok ? (
        <p className="error">ログを再生成できませんでした: {regen.message}</p>
      ) : (
        <>
          {regen.regenerated && (
            <p className="warn small">
              容量節約のためログは保存されておらず、battleSeed から再生成しました。戦闘エンジンが更新されていると当時と異なる場合があります
              {regen.result.won !== entry.won && '（実際に不一致を検出しました）'}。
            </p>
          )}
          <div className="dq-tabs">
            <button type="button" className={`dq-tab${view === 'log' ? ' is-active' : ''}`} onClick={() => setView('log')}>
              ログ
            </button>
            <button type="button" className={`dq-tab${view === 'replay' ? ' is-active' : ''}`} onClick={() => setView('replay')}>
              Replay
            </button>
          </div>
          {view === 'log' ? <BattleLogView log={regen.result.battle.log} /> : <ReplayView log={regen.result.battle.log} />}
        </>
      )}
      <p className="muted small">
        cardIndex {entry.offer.cardIndex} / battleSeed {entry.battleSeed} / {new Date(entry.playedAt).toLocaleString('ja-JP')}
      </p>
    </div>
  )
}
