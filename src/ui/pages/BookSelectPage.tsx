import { useState } from 'react'
import type { InformationMode } from '../../ai/BettingAgent'
import type { PlayerMode, Session } from '../../storage/session'
import { BookList } from '../components/BookList'
import { matchesPlayed } from '../logic/books'
import { ConfirmDialog, Modal } from '../components/Modal'
import { Window } from '../components/Window'
import { useArenaDeps, useArenaState, useAutoPlayState } from '../hooks/arenaContext'
import {
  DEFAULT_HERO_LEVEL,
  DEFAULT_INITIAL_GOLD,
  HERO_LEVEL_MAX,
  HERO_LEVEL_MIN,
  clampHeroLevel,
} from '../logic/arenaFlow'
import { describeError } from '../logic/autoPlay'
import { formatGold } from '../logic/format'

/** 目安とする localStorage の容量（文字数）。ブラウザにより異なるが概ね 5M 文字 */
const STORAGE_BUDGET = 5_000_000

/**
 * 冒険の書の選択画面（起動時のタイトル画面）。
 * コマンドを選んでから対象の冊を選ぶ、原作の「ぼうけんのしょ」画面と同じ順序にする。
 */
type Mode = 'select' | 'create' | 'copy' | 'delete' | 'rename'

const PROMPT: Record<Mode, string> = {
  select: 'ぼうけんのしょを えらんでください',
  create: 'あたらしい ぼうけんのしょ',
  copy: 'どの ぼうけんのしょを うつしますか？',
  delete: 'どの ぼうけんのしょを けしますか？',
  rename: 'どの ぼうけんのしょの なまえを かえますか？',
}

export function BookSelectPage({ onStarted }: { onStarted: () => void }) {
  const { store } = useArenaDeps()
  const { books, session } = useArenaState()
  const ap = useAutoPlayState()
  const [mode, setMode] = useState<Mode>('select')
  const [target, setTarget] = useState<Session | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => void) => {
    try {
      setError(null)
      fn()
    } catch (e) {
      setError(describeError(e))
    }
  }

  const pick = (b: Session) => {
    if (mode === 'select') {
      run(() => {
        store.switchBook(b.id)
        onStarted()
      })
    } else {
      setTarget(b)
    }
  }

  const reset = () => {
    setMode('select')
    setTarget(null)
  }

  // 冊が 1 冊も無ければ選ぶものが無いので、いきなり作成フォームを出す
  const showForm = mode === 'create' || books.length === 0
  const usage = books.length > 0 ? store.storageUsage() / STORAGE_BUDGET : 0

  return (
    <div className="page start-page">
      <Window title="モンスター格闘場へ ようこそ！">
        <p className="muted">
          SFC 版ドラゴンクエストIII のモンスター格闘場シミュレーター（非公式）。賭け金は主人公レベル × 10G です。
        </p>
      </Window>

      {ap.running && <p className="notice warn small">オートプレイ中は冒険の書を切り替え・うつす・けすことはできません。</p>}
      {error && <p className="notice error small">{error}</p>}

      {books.length > 0 && (
        <Window title={PROMPT[mode === 'create' ? 'select' : mode]} className="books">
          <BookList
            books={books}
            activeId={session?.id}
            highlightId={highlightId}
            onPick={pick}
            disabled={ap.running || mode === 'create'}
            autoFocus={mode !== 'create'}
          />
          <div className="dq-actions">
            {mode === 'select' || mode === 'create' ? (
              <>
                <button type="button" className="dq-btn dq-btn-primary" onClick={() => setMode('create')} disabled={ap.running}>
                  つくる
                </button>
                <button type="button" className="dq-btn" onClick={() => setMode('copy')} disabled={ap.running}>
                  うつす
                </button>
                <button type="button" className="dq-btn" onClick={() => setMode('delete')} disabled={ap.running}>
                  けす
                </button>
                <button type="button" className="dq-btn" onClick={() => setMode('rename')}>
                  なまえを かえる
                </button>
              </>
            ) : (
              <button type="button" className="dq-btn" onClick={reset}>
                やめる
              </button>
            )}
          </div>
          <p className="muted small book-usage" title="ブラウザの保存容量（概ね 5M 文字）に対する目安">
            きろくの ようりょう: 約 {Math.max(1, Math.round(usage * 100))}%
            {usage > 0.7 && <span className="warn">（残りわずか。使わない冒険の書を消すと空きます）</span>}
          </p>
        </Window>
      )}

      {showForm && (
        <NewBookForm
          disabled={ap.running}
          onCancel={books.length > 0 ? reset : undefined}
          onCreate={(p) =>
            run(() => {
              store.createBook(p)
              reset()
              onStarted()
            })
          }
        />
      )}

      <Modal open={mode === 'copy' && target !== null} title="うつしかた" onClose={reset}>
        {target && (
          <div className="dq-commands">
            <button
              type="button"
              className="dq-btn"
              autoFocus
              onClick={() =>
                run(() => {
                  setHighlightId(store.copyBook(target.id, 'as-is').id)
                  reset()
                })
              }
            >
              そのまま うつす
              <span className="muted small">いまの所持金・試合・履歴ごと複製する</span>
            </button>
            <button
              type="button"
              className="dq-btn"
              onClick={() =>
                run(() => {
                  setHighlightId(store.copyBook(target.id, 'restart').id)
                  reset()
                })
              }
            >
              同じ試合順で はじめから
              <span className="muted small">
                Lv.{target.heroLevel}・{formatGold(target.initialGold)}・同じ seed で第 1 試合から。Jev の設定だけ変えて比べるとき向け
              </span>
            </button>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={mode === 'delete' && target !== null}
        title="ほんとうに けしますか？"
        onConfirm={() =>
          run(() => {
            if (target) store.deleteBook(target.id)
            reset()
          })
        }
        onCancel={reset}
      >
        「{target?.name}」（{target ? matchesPlayed(target) : 0} 試合分）の履歴はこのブラウザから消え、元に戻せません。必要なら先に統計画面からエクスポートしてください。
      </ConfirmDialog>

      <Modal open={mode === 'rename' && target !== null} title="なまえを かえる" onClose={reset}>
        {target && (
          <RenameForm
            key={target.id}
            initial={target.name}
            onSubmit={(name) => {
              store.renameBook(target.id, name)
              reset()
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function RenameForm({ initial, onSubmit }: { initial: string; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial)
  return (
    <form
      className="start-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) onSubmit(name)
      }}
    >
      <label className="field">
        <span>なまえ</span>
        <input className="dq-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div className="dq-actions">
        <button type="submit" className="dq-btn dq-btn-primary" disabled={!name.trim()}>
          けってい
        </button>
      </div>
    </form>
  )
}

function NewBookForm({
  onCreate,
  onCancel,
  disabled,
}: {
  onCreate: (p: { name: string; heroLevel: number; initialGold: number; informationMode: InformationMode; playerMode: PlayerMode }) => void
  onCancel?: () => void
  disabled: boolean
}) {
  const [name, setName] = useState('')
  const [heroLevel, setHeroLevel] = useState(String(DEFAULT_HERO_LEVEL))
  const [initialGold, setInitialGold] = useState(String(DEFAULT_INITIAL_GOLD))
  const [informationMode, setInformationMode] = useState<InformationMode>('classic')
  const [playerMode, setPlayerMode] = useState<PlayerMode>('human')

  const lv = Number(heroLevel)
  const gold = Number(initialGold)
  const lvValid = Number.isInteger(lv) && lv >= HERO_LEVEL_MIN && lv <= HERO_LEVEL_MAX
  const goldValid = Number.isInteger(gold) && gold >= 0 && gold <= 9_999_999
  const valid = lvValid && goldValid

  return (
    <Window title="あたらしい ぼうけんのしょ">
      <form
        className="start-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onCreate({ name, heroLevel: clampHeroLevel(lv), initialGold: gold, informationMode, playerMode })
        }}
      >
        <label className="field">
          <span>なまえ</span>
          <input
            className="dq-input"
            value={name}
            maxLength={40}
            placeholder="空欄なら「冒険の書 N」"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
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
          <button type="submit" className="dq-btn dq-btn-primary" disabled={!valid || disabled}>
            はじめる
          </button>
          {onCancel && (
            <button type="button" className="dq-btn" onClick={onCancel}>
              やめる
            </button>
          )}
        </div>
      </form>
    </Window>
  )
}
