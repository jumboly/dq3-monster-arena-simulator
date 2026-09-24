import { useState, type ReactNode } from 'react'
import { clearApiKey, hasApiKey, saveApiKey } from '../../storage/apiKey'
import type { JevPolicy } from '../../storage/session'
import { Window } from '../components/Window'
import { useArenaDeps, useArenaState } from '../hooks/arenaContext'

export function SettingsPage() {
  const { store } = useArenaDeps()
  const { session, settings } = useArenaState()

  return (
    <div className="page">
      <ApiKeySection />

      <Window title="Jev の賭け方針">
        <fieldset className="field">
          <PolicyRadio value="max-ev" current={settings.jevPolicy} onChange={(p) => store.updateSettings({ jevPolicy: p })}>
            期待値最大 <span className="muted small">勝率 × オッズが最大の選手（長期の所持金を増やす狙い）</span>
          </PolicyRadio>
          <PolicyRadio value="max-win" current={settings.jevPolicy} onChange={(p) => store.updateSettings({ jevPolicy: p })}>
            勝率最大 <span className="muted small">最も勝ちそうな選手（的中率・予測精度を見たいとき）</span>
          </PolicyRadio>
        </fieldset>
        <label className="field">
          <span>Auto Play の連続失敗で停止する回数</span>
          <input
            className="dq-input dq-input-short"
            type="number"
            min={1}
            max={10}
            value={settings.autoPlayFailureLimit}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value))
              if (n >= 1 && n <= 10) store.updateSettings({ autoPlayFailureLimit: n })
            }}
          />
        </label>
        <label className="radio">
          <input
            type="checkbox"
            checked={settings.useMockAgent}
            onChange={(e) => store.updateSettings({ useMockAgent: e.target.checked })}
          />
          API キーがあってもモックエージェントを使う <span className="muted small">（API を消費せずに画面を試す）</span>
        </label>
      </Window>

      <Window title="引き分け時の払い戻し">
        <p className="muted small">
          引き分け（終了タイプ 7）で賭け金が返るかは実機の扱いが未解明です（U-20）。次の試合から反映されます。
        </p>
        <fieldset className="field">
          <label className="radio">
            <input
              type="radio"
              checked={settings.drawPolicy === 'refund'}
              onChange={() => store.updateSettings({ drawPolicy: 'refund' })}
            />
            返金 <span className="muted small">賭け金が戻る（既定）</span>
          </label>
          <label className="radio">
            <input
              type="radio"
              checked={settings.drawPolicy === 'forfeit'}
              onChange={() => store.updateSettings({ drawPolicy: 'forfeit' })}
            />
            没収 <span className="muted small">賭け金は戻らない</span>
          </label>
        </fieldset>
      </Window>

      {session && (
        <Window title={`いまの冒険の書（${session.name}）`}>
          <fieldset className="field">
            <legend>Information Mode</legend>
            <label className="radio">
              <input
                type="radio"
                checked={session.informationMode === 'classic'}
                onChange={() => store.updateSession({ informationMode: 'classic' })}
              />
              Classic
            </label>
            <label className="radio">
              <input
                type="radio"
                checked={session.informationMode === 'analyst'}
                onChange={() => store.updateSession({ informationMode: 'analyst' })}
              />
              Analyst
            </label>
          </fieldset>
          <fieldset className="field">
            <legend>Player Mode</legend>
            <label className="radio">
              <input type="radio" checked={session.playerMode === 'human'} onChange={() => store.updateSession({ playerMode: 'human' })} />
              Human
            </label>
            <label className="radio">
              <input type="radio" checked={session.playerMode === 'jev'} onChange={() => store.updateSession({ playerMode: 'jev' })} />
              Jev
            </label>
          </fieldset>
          <p className="muted small">冒険の書の なまえ変更・うつす・けすは、格闘場タブの冒険の書の画面で行います。</p>
        </Window>
      )}

    </div>
  )
}

function PolicyRadio({
  value,
  current,
  onChange,
  children,
}: {
  value: JevPolicy
  current: JevPolicy
  onChange: (p: JevPolicy) => void
  children: ReactNode
}) {
  return (
    <label className="radio">
      <input type="radio" checked={current === value} onChange={() => onChange(value)} />
      {children}
    </label>
  )
}

/**
 * API キー入力。保存済みのキーは画面に一切戻さない（伏せ字の固定文字列だけ表示）。
 * 入力欄に値を戻すと、画面共有や肩越しで漏れる・DOM から読めてしまうため。
 */
function ApiKeySection() {
  const [saved, setSaved] = useState(() => hasApiKey())
  const [input, setInput] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  return (
    <Window title="Vercel AI Gateway API Key">
      <form
        className="apikey-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!input.trim()) return
          const ok = saveApiKey(input)
          setInput('')
          setSaved(hasApiKey())
          setMessage(ok ? { kind: 'ok', text: '保存しました。' } : { kind: 'error', text: 'このブラウザでは保存できませんでした。' })
        }}
      >
        <input
          className="dq-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={saved ? '••••••••（保存済み。上書きする場合のみ入力）' : 'API キーを入力'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Vercel AI Gateway API Key"
        />
        <div className="dq-actions">
          <button type="submit" className="dq-btn dq-btn-primary" disabled={!input.trim()}>
            Save
          </button>
          <button
            type="button"
            className="dq-btn"
            disabled={!saved}
            onClick={() => {
              const ok = clearApiKey()
              setSaved(hasApiKey())
              setMessage(ok ? { kind: 'ok', text: '削除しました。' } : { kind: 'error', text: '削除できませんでした。' })
            }}
          >
            Clear
          </button>
          <span className="muted small">状態: {saved ? '保存済み ••••••••' : '未設定'}</span>
        </div>
      </form>
      {message && <p className={message.kind === 'ok' ? 'muted' : 'error'}>{message.text}</p>}
      <ul className="notice warn small">
        <li>このツールはキーをブラウザの localStorage にのみ保存します。本サイトは静的配信でサーバー処理を持たず、キーは Jev 呼び出し時に Vercel AI Gateway へ直接送られるだけです。</li>
        <li>公開 PC・共用 PC では使わないでください。</li>
        <li>利用上限（予算）を設定した専用キーの使用を推奨します。</li>
        <li>履歴のエクスポートにキーは含まれません。</li>
      </ul>
    </Window>
  )
}
