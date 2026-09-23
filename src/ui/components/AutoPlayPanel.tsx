import { useState } from 'react'
import { useArenaDeps, useArenaState, useAutoPlayState } from '../hooks/arenaContext'
import { AUTO_PLAY_CHOICES, type AutoPlayStopReason } from '../logic/autoPlay'
import { formatGold } from '../logic/format'
import { agentAvailability, createBettingAgent } from '../agentProvider'
import { ConfirmDialog } from './Modal'
import { Window } from './Window'

const STOP_MESSAGES: Record<AutoPlayStopReason, string> = {
  completed: '指定回数を終えました',
  aborted: '停止しました',
  'no-gold': '所持金が賭け金に足りなくなったため停止しました',
  failures: '連続して失敗したため自動停止しました',
}

export function AutoPlayPanel({ disabled }: { disabled?: boolean }) {
  const { game, autoPlay } = useArenaDeps()
  const { session, settings } = useArenaState()
  const ap = useAutoPlayState()
  const [count, setCount] = useState<number>(AUTO_PLAY_CHOICES[0])
  const [confirming, setConfirming] = useState(false)
  if (!session) return null

  const stake = game.stakeFor(session.heroLevel)
  // 所持金で打ち切られる回数の目安。全敗しても最低この回数は遊べる
  const affordable = Math.floor(session.gold / stake)
  const availability = agentAvailability({ forceMock: settings.useMockAgent })

  const start = () => {
    setConfirming(false)
    void autoPlay.start(createBettingAgent({ policy: settings.jevPolicy, forceMock: settings.useMockAgent }), count, settings.autoPlayFailureLimit)
  }

  const p = ap.progress
  return (
    <Window title="Auto Play" className="autoplay">
      {ap.running && p ? (
        <>
          <progress className="dq-progress" max={p.target} value={p.played} />
          <p>
            {p.played} / {p.target} 試合
            {p.failures > 0 && <span className="muted">（失敗 {p.failures} 回）</span>}
          </p>
          {p.waitingMs !== null && <p className="warn">再試行まで待機中（約 {Math.ceil(p.waitingMs / 1000)} 秒）: {p.lastError}</p>}
          <button type="button" className="dq-btn dq-btn-danger" onClick={() => autoPlay.stop()}>
            Stop
          </button>
        </>
      ) : ap.running ? (
        <>
          <p>開始しています…</p>
          <button type="button" className="dq-btn dq-btn-danger" onClick={() => autoPlay.stop()}>
            Stop
          </button>
        </>
      ) : (
        <>
          <div className="autoplay-row">
            <label>
              試行数{' '}
              <select className="dq-select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {AUTO_PLAY_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="dq-btn" onClick={() => setConfirming(true)} disabled={disabled || affordable === 0}>
              Auto Play 開始
            </button>
          </div>
          {ap.lastStop && (
            <p className={ap.lastStop.reason === 'failures' ? 'error' : 'muted'}>
              {STOP_MESSAGES[ap.lastStop.reason]}（{ap.lastStop.progress.played} / {ap.lastStop.progress.target} 試合）
              {ap.lastStop.progress.lastError && <> — 最後のエラー: {ap.lastStop.progress.lastError}</>}
            </p>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirming}
        title="Auto Play を開始しますか？"
        confirmLabel="開始"
        cancelLabel="やめる"
        onConfirm={start}
        onCancel={() => setConfirming(false)}
      >
        <ul className="plain">
          <li>
            エージェント: {availability.label}
            {availability.kind === 'mock' && <span className="muted">（{availability.note}）</span>}
          </li>
          <li>
            最大 {count} 試合 / API 呼び出しの目安: <strong>約 {count} 回</strong>（1 試合 1 回。失敗時の再試行で増えることがあります）
          </li>
          <li>
            賭け金 {formatGold(stake)} × 最大 {count} 試合。所持金が賭け金を下回ると停止します（全敗でも最低 {Math.min(count, affordable)} 試合）
          </li>
          <li>{settings.autoPlayFailureLimit} 回連続で失敗すると自動停止します。途中で Stop できます。</li>
        </ul>
      </ConfirmDialog>
    </Window>
  )
}
