/**
 * エージェントと外部 API の実際のやり取り（リクエスト / レスポンス）を見せる折りたたみ表示。
 *
 * Jev は確率だけを返すモデルなので、「何を渡したら何が返ったか」を見られることが
 * 予測を理解する一番の手がかりになる。既定では閉じておき、テンポを損なわないようにする。
 */
import { useState } from 'react'
import type { AgentExchange } from '../../ai/BettingAgent'

function pretty(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // クリップボード API が使えない環境（非 HTTPS 等）では何もしない。本文は選択してコピーできる
    }
  }
  return (
    <button type="button" className="dq-btn dq-btn-small" onClick={copy}>
      {copied ? 'コピーしました' : 'コピー'}
    </button>
  )
}

export function ExchangeView({ exchange, title = 'Jev への実際のリクエスト / レスポンス' }: { exchange: AgentExchange; title?: string }) {
  const request = pretty(exchange.requestBody)
  const response = pretty(exchange.responseBody)
  const headers = Object.entries(exchange.requestHeaders)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  const status = exchange.status === null ? '応答なし' : `HTTP ${exchange.status}`
  const timing = [
    `試行 ${exchange.attempts} 回`,
    exchange.latencyMs !== null ? `往復 ${Math.round(exchange.latencyMs)}ms` : null,
    `合計 ${Math.round(exchange.elapsedMs)}ms`,
  ]
    .filter(Boolean)
    .join(' / ')

  return (
    <details className="exchange">
      <summary>
        {title} <span className="muted small">（{status} / {timing}）</span>
      </summary>
      <div className="exchange-body">
        <p className="small">
          <code>
            {exchange.method} {exchange.endpoint}
          </code>
        </p>
        <pre className="exchange-pre">{headers}</pre>
        <div className="exchange-head">
          <h4>リクエスト本文</h4>
          <CopyButton text={request} />
        </div>
        <pre className="exchange-pre">{request}</pre>
        <div className="exchange-head">
          <h4>レスポンス本文{exchange.attempts > 1 ? '（最後の試行）' : ''}</h4>
          <CopyButton text={response} />
        </div>
        <pre className="exchange-pre">{response}</pre>
        <p className="muted small">API キーは表示・保存していません（Authorization ヘッダは伏せ字）。</p>
      </div>
    </details>
  )
}
