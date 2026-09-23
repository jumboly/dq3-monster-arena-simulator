import { useState } from 'react'
import { useArenaDeps, useArenaState, useAutoPlayState } from './ui/hooks/arenaContext'
import { ARENA_GAME_IS_MOCK } from './ui/arenaGameProvider'
import { formatGold } from './ui/logic/format'
import { AnalysisPage } from './ui/pages/AnalysisPage'
import { ArenaPage } from './ui/pages/ArenaPage'
import { HistoryPage } from './ui/pages/HistoryPage'
import { SettingsPage } from './ui/pages/SettingsPage'
import { StartPage } from './ui/pages/StartPage'
import { StatsPage } from './ui/pages/StatsPage'

type Tab = 'arena' | 'history' | 'stats' | 'analysis' | 'settings'

const TABS: Array<{ id: Tab; label: string; sub: string }> = [
  { id: 'arena', label: '格闘場', sub: 'Arena' },
  { id: 'history', label: '履歴', sub: 'History' },
  { id: 'stats', label: '統計', sub: 'Stats' },
  { id: 'analysis', label: '解析', sub: 'Analysis' },
  { id: 'settings', label: '設定', sub: 'Settings' },
]

export default function App() {
  const { game } = useArenaDeps()
  const { session, storageWarning } = useArenaState()
  const ap = useAutoPlayState()
  const { store } = useArenaDeps()
  const [tab, setTab] = useState<Tab>('arena')
  // 起動時は必ず Start 画面を出し、既存セッションは「続きから」で明示的に再開させる
  const [started, setStarted] = useState(false)

  const showStart = tab === 'arena' && (!session || !started)
  const needsSession = (tab === 'history' || tab === 'stats') && !session

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          モンスター格闘場 <span className="muted small">DQ3 Monster Arena Simulator</span>
        </h1>
        {session && (
          <p className="status-line" aria-live="polite">
            <span>Lv.{session.heroLevel}</span>
            <span>Gold {formatGold(session.gold)}</span>
            <span>Stake {formatGold(game.stakeFor(session.heroLevel))}</span>
            <span>Round {session.round}</span>
            <span className="muted">
              {session.informationMode === 'analyst' ? 'Analyst' : 'Classic'} / {session.playerMode === 'jev' ? 'Jev' : 'Human'}
            </span>
            {ap.running && ap.progress && (
              <span className="tag">
                Auto {ap.progress.played}/{ap.progress.target}
              </span>
            )}
          </p>
        )}
        <nav className="app-tabs" aria-label="画面">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`dq-tab${tab === t.id ? ' is-active' : ''}`}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="tab-sub">{t.sub}</span>
            </button>
          ))}
        </nav>
      </header>

      {ARENA_GAME_IS_MOCK && (
        <p className="notice warn small">
          開発用モック: 戦闘・マッチメイク・オッズは仮実装（ダミー）です。実機の再現ではありません。
        </p>
      )}
      {storageWarning && (
        <div className="notice error small">
          {storageWarning}{' '}
          <button type="button" className="dq-btn dq-btn-small" onClick={() => store.dismissWarning()}>
            閉じる
          </button>
        </div>
      )}

      <main className="app-main">
        {showStart ? (
          <StartPage onStarted={() => setStarted(true)} />
        ) : needsSession ? (
          <p className="muted center">セッションがありません。格闘場タブから始めてください。</p>
        ) : tab === 'arena' && session ? (
          <ArenaPage session={session} onNewSession={() => setStarted(false)} />
        ) : tab === 'history' ? (
          <HistoryPage />
        ) : tab === 'stats' ? (
          <StatsPage />
        ) : tab === 'analysis' ? (
          <AnalysisPage />
        ) : (
          <SettingsPage
            onSessionCleared={() => {
              setStarted(false)
              setTab('arena')
            }}
          />
        )}
      </main>

      <footer className="app-footer muted small">
        非公式のファン製シミュレーターです。株式会社スクウェア・エニックスとは関係ありません。
      </footer>
    </div>
  )
}
