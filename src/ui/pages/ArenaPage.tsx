import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchOffer } from '../../core/arena/types'
import type { HistoryEntry, Prediction, Session } from '../../storage/session'
import { agentAvailability, createBettingAgent } from '../agentProvider'
import { AutoPlayPanel } from '../components/AutoPlayPanel'
import { BattleLogView } from '../components/BattleLogView'
import { ContestantDetails } from '../components/ContestantDetails'
import { Modal } from '../components/Modal'
import { MonsterCard } from '../components/MonsterCard'
import { ReplayView } from '../components/ReplayView'
import { PredictionLine, ResultSummary } from '../components/RoundViews'
import { ExchangeView } from '../components/ExchangeView'
import type { AgentExchange } from '../../ai/BettingAgent'
import { isAiGatewayError } from '../../ai/errors'
import { Window } from '../components/Window'
import { useArenaDeps, useArenaState, useAutoPlayState } from '../hooks/arenaContext'
import { canAfford, currentOffer, predictionBySlot, winnerSlotOf } from '../logic/arenaFlow'
import { isAbortError } from '../../ai/errors'
import { askAgent, describeError } from '../logic/autoPlay'
import { formatGold } from '../logic/format'

export function ArenaPage({ session, onNewSession }: { session: Session; onNewSession: () => void }) {
  const { history } = useArenaState()
  const ap = useAutoPlayState()
  const last = history[history.length - 1]
  const showingResult = session.phase === 'result' && last?.round === session.round

  return (
    <div className="page arena-page">
      {showingResult ? (
        <ResultPanel entry={last} autoRunning={ap.running} />
      ) : (
        // round ごとに作り直し、Jev の予測や詳細表示の状態を次の試合へ持ち越さない
        <MatchPanel key={`${session.id}-${session.round}`} session={session} onNewSession={onNewSession} locked={ap.running} />
      )}
      {session.playerMode === 'jev' && <AutoPlayPanel />}
    </div>
  )
}

type JevState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; slot: number; prediction: Prediction }
  | { status: 'error'; message: string; exchange?: AgentExchange }

function MatchPanel({ session, onNewSession, locked }: { session: Session; onNewSession: () => void; locked: boolean }) {
  const { game, store } = useArenaDeps()
  const { settings } = useArenaState()
  const offer: MatchOffer = useMemo(() => currentOffer(game, session), [game, session])
  const observation = useMemo(() => game.observe(offer, session.informationMode), [game, offer, session.informationMode])
  const [detailSlot, setDetailSlot] = useState<number | null>(null)
  const [jev, setJev] = useState<JevState>({ status: 'idle' })
  const [betError, setBetError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const affordable = canAfford(game, session)
  const isJev = session.playerMode === 'jev'
  const availability = agentAvailability({ forceMock: settings.useMockAgent })

  // 画面を離れたら応答待ちの API 呼び出しを捨てる（結果を別の試合に適用しないため）
  useEffect(() => () => abortRef.current?.abort(), [])

  const bet = (slot: number, prediction?: Prediction) => {
    try {
      store.bet(slot, prediction ? { prediction } : {})
    } catch (e) {
      setBetError(describeError(e))
    }
  }

  const ask = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setJev({ status: 'loading' })
    try {
      const agent = createBettingAgent({ policy: settings.jevPolicy, forceMock: settings.useMockAgent })
      const { slot, prediction } = await askAgent(game, agent, offer, session.informationMode, ac.signal)
      if (!ac.signal.aborted) setJev({ status: 'ready', slot, prediction })
    } catch (e) {
      if (isAbortError(e) || ac.signal.aborted) return
      // 失敗時も最後に返ってきた本文を見せる（混雑の 503 などを利用者が自分で確かめられるように）
      setJev({ status: 'error', message: describeError(e), exchange: isAiGatewayError(e) ? e.exchange : undefined })
    }
  }

  const probs = jev.status === 'ready' ? predictionBySlot({ offer, prediction: jev.prediction }) : null
  const detailContestant = offer.contestants.find((c) => c.slot === detailSlot)

  return (
    <>
      <Window title={`第 ${session.round} 試合`} className="match">
        {!affordable && (
          <div className="notice error">
            <p>
              所持金が足りません（賭け金 {formatGold(offer.stake)} / 所持金 {formatGold(session.gold)}）。
            </p>
            <button type="button" className="dq-btn" onClick={onNewSession}>
              新しいセッションを始める
            </button>
          </div>
        )}
        {betError && <p className="error">{betError}</p>}
        <div className={`cards cards-${offer.contestants.length}`}>
          {offer.contestants.map((c, k) => (
            <MonsterCard
              key={c.slot}
              contestant={c}
              odds={game.oddsValue(offer, c.slot)}
              observed={observation.contestants[k]}
              onBet={isJev ? undefined : () => bet(c.slot)}
              betDisabled={!affordable || locked}
              onDetails={() => setDetailSlot(c.slot)}
              marks={
                probs
                  ? { probability: probs[c.slot], jevPick: jev.status === 'ready' && jev.slot === c.slot }
                  : undefined
              }
            />
          ))}
        </div>
        {!isJev && affordable && <p className="muted small center">賭け金 {formatGold(offer.stake)}（主人公レベル × 10G）。BET で即試合開始。</p>}
      </Window>

      {isJev && (
        <Window title="Jev" className="jev">
          {availability.kind === 'mock' && <p className="muted small">{availability.note}</p>}
          {jev.status === 'idle' && (
            <button type="button" className="dq-btn dq-btn-primary" onClick={ask} disabled={!affordable || locked}>
              Ask Jev
            </button>
          )}
          {jev.status === 'loading' && (
            <div className="dq-actions">
              <span className="blink">Jev が 考えている…</span>
              <button
                type="button"
                className="dq-btn dq-btn-small"
                onClick={() => {
                  abortRef.current?.abort()
                  setJev({ status: 'idle' })
                }}
              >
                中断
              </button>
            </div>
          )}
          {jev.status === 'error' && (
            <div className="notice error">
              <p>Jev の予測に失敗しました: {jev.message}</p>
              {jev.exchange && <ExchangeView exchange={jev.exchange} />}
              <button type="button" className="dq-btn" onClick={ask}>
                再試行
              </button>
            </div>
          )}
          {jev.status === 'ready' && (
            <>
              <PredictionLine offer={offer} prediction={jev.prediction} />
              <div className="dq-actions">
                <button
                  type="button"
                  className="dq-btn dq-btn-primary"
                  onClick={() => bet(jev.slot, jev.prediction)}
                  disabled={!affordable || locked}
                  autoFocus
                >
                  Fight
                </button>
                <button type="button" className="dq-btn dq-btn-small" onClick={ask} disabled={locked}>
                  もう一度聞く
                </button>
              </div>
            </>
          )}
        </Window>
      )}

      <Modal open={detailContestant !== undefined} title="Details" onClose={() => setDetailSlot(null)}>
        {detailContestant && (
          <ContestantDetails
            contestant={detailContestant}
            odds={game.oddsValue(offer, detailContestant.slot)}
            observed={observation.contestants[offer.contestants.indexOf(detailContestant)]}
          />
        )}
      </Modal>
    </>
  )
}

function ResultPanel({ entry, autoRunning }: { entry: HistoryEntry; autoRunning: boolean }) {
  const { game, store } = useArenaDeps()
  const [view, setView] = useState<'none' | 'log' | 'replay'>('none')
  const w = winnerSlotOf(entry)
  const probs = predictionBySlot(entry)
  // 直近の試合は必ずログを保持している（刈り込みは古い試合のみ）
  const log = entry.battle?.log ?? []

  return (
    <>
      <Window title={`第 ${entry.round} 試合 — 結果`} className="result">
        <ResultSummary entry={entry} />
        <div className={`cards cards-${entry.offer.contestants.length} cards-compact`}>
          {entry.offer.contestants.map((c) => (
            <MonsterCard
              key={c.slot}
              contestant={c}
              odds={game.oddsValue(entry.offer, c.slot)}
              marks={{ bet: c.slot === entry.betSlot, winner: c.slot === w, ...(probs ? { probability: probs[c.slot] } : {}) }}
            />
          ))}
        </div>
        {entry.prediction && <PredictionLine offer={entry.offer} prediction={entry.prediction} />}
        <div className="dq-actions">
          <button type="button" className="dq-btn" onClick={() => setView('log')} disabled={log.length === 0}>
            View Battle Log
          </button>
          <button type="button" className="dq-btn" onClick={() => setView('replay')} disabled={log.length === 0}>
            Replay Battle
          </button>
          <button
            type="button"
            className="dq-btn dq-btn-primary"
            onClick={() => store.next()}
            disabled={autoRunning}
            // テンポ優先: 結果が出たら Enter 一発で次の試合へ進めるようにする
            autoFocus
          >
            Next Match
          </button>
        </div>
      </Window>
      <Modal open={view === 'log'} title="Battle Log" onClose={() => setView('none')} wide>
        <BattleLogView log={log} />
      </Modal>
      <Modal open={view === 'replay'} title="Replay" onClose={() => setView('none')} wide>
        <ReplayView log={log} />
      </Modal>
    </>
  )
}
