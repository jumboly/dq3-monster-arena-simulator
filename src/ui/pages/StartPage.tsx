import { useState } from 'react'
import type { InformationMode } from '../../ai/BettingAgent'
import type { PlayerMode } from '../../storage/session'
import { ConfirmDialog } from '../components/Modal'
import { Window } from '../components/Window'
import { useArenaDeps, useArenaState } from '../hooks/arenaContext'
import {
  DEFAULT_HERO_LEVEL,
  DEFAULT_INITIAL_GOLD,
  HERO_LEVEL_MAX,
  HERO_LEVEL_MIN,
  clampHeroLevel,
} from '../logic/arenaFlow'
import { formatGold } from '../logic/format'

export function StartPage({ onStarted }: { onStarted: () => void }) {
  const { store } = useArenaDeps()
  const { session, history } = useArenaState()
  const [heroLevel, setHeroLevel] = useState(String(DEFAULT_HERO_LEVEL))
  const [initialGold, setInitialGold] = useState(String(DEFAULT_INITIAL_GOLD))
  const [informationMode, setInformationMode] = useState<InformationMode>('classic')
  const [playerMode, setPlayerMode] = useState<PlayerMode>('human')
  const [confirming, setConfirming] = useState(false)

  const lv = Number(heroLevel)
  const gold = Number(initialGold)
  const lvValid = Number.isInteger(lv) && lv >= HERO_LEVEL_MIN && lv <= HERO_LEVEL_MAX
  const goldValid = Number.isInteger(gold) && gold >= 0 && gold <= 9_999_999
  const valid = lvValid && goldValid

  const start = () => {
    store.startSession({ heroLevel: clampHeroLevel(lv), initialGold: gold, informationMode, playerMode })
    setConfirming(false)
    onStarted()
  }

  return (
    <div className="page start-page">
      <Window title="モンスター格闘場へ ようこそ！">
        <p className="muted">
          SFC 版ドラゴンクエストIII のモンスター格闘場シミュレーター（非公式）。賭け金は主人公レベル × 10G です。
        </p>
      </Window>

      {session && (
        <Window title="続きから">
          <p>
            Lv.{session.heroLevel} / {formatGold(session.gold)} / Round {session.round}（{history.length} 試合済み）
          </p>
          <div className="dq-actions">
            <button type="button" className="dq-btn dq-btn-primary" onClick={onStarted} autoFocus>
              続きから
            </button>
          </div>
        </Window>
      )}

      <Window title={session ? '新しく始める' : 'はじめから'}>
        <form
          className="start-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            if (session) setConfirming(true)
            else start()
          }}
        >
          <label className="field">
            <span>Hero Level（{HERO_LEVEL_MIN}〜{HERO_LEVEL_MAX}）</span>
            <input
              className="dq-input"
              type="number"
              inputMode="numeric"
              min={HERO_LEVEL_MIN}
              max={HERO_LEVEL_MAX}
              value={heroLevel}
              onChange={(e) => setHeroLevel(e.target.value)}
              aria-invalid={!lvValid}
            />
            <span className="muted small">賭け金 {lvValid ? formatGold(lv * 10) : '—'}</span>
          </label>
          <label className="field">
            <span>Initial Gold</span>
            <input
              className="dq-input"
              type="number"
              inputMode="numeric"
              min={0}
              step={100}
              value={initialGold}
              onChange={(e) => setInitialGold(e.target.value)}
              aria-invalid={!goldValid}
            />
          </label>
          <fieldset className="field">
            <legend>Information Mode</legend>
            <label className="radio">
              <input type="radio" checked={informationMode === 'classic'} onChange={() => setInformationMode('classic')} />
              Classic <span className="muted small">名前とオッズだけ（実機の窓口と同じ）</span>
            </label>
            <label className="radio">
              <input type="radio" checked={informationMode === 'analyst'} onChange={() => setInformationMode('analyst')} />
              Analyst <span className="muted small">能力値・行動・AI・耐性も表示</span>
            </label>
          </fieldset>
          <fieldset className="field">
            <legend>Player Mode</legend>
            <label className="radio">
              <input type="radio" checked={playerMode === 'human'} onChange={() => setPlayerMode('human')} />
              Human <span className="muted small">自分で賭ける</span>
            </label>
            <label className="radio">
              <input type="radio" checked={playerMode === 'jev'} onChange={() => setPlayerMode('jev')} />
              Jev <span className="muted small">AI に予測させて賭ける・自動プレイ</span>
            </label>
          </fieldset>
          <div className="dq-actions">
            <button type="submit" className="dq-btn dq-btn-primary" disabled={!valid}>
              開始
            </button>
          </div>
        </form>
      </Window>

      <ConfirmDialog
        open={confirming}
        title="新しいセッション"
        confirmLabel="消して始める"
        cancelLabel="やめる"
        onConfirm={start}
        onCancel={() => setConfirming(false)}
      >
        現在のセッション（{history.length} 試合分の履歴）は消去されます。必要なら先に Stats 画面からエクスポートしてください。
      </ConfirmDialog>
    </div>
  )
}
