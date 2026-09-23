/**
 * UI が使う BettingAgent の唯一の生成箇所。
 *
 * UI は BettingAgent インターフェースしか知らないので、Jev 以外（他 LLM・統計ベースライン）へ
 * 替えるときもここだけを書き換えればよい。
 */
import type { BettingAgent } from '../ai/BettingAgent'
import { JevBettingAgent, type BetStrategy } from '../ai/JevBettingAgent'
import { hasApiKey, loadApiKey } from '../storage/apiKey'
import type { JevPolicy } from '../storage/session'
import { MockBettingAgent } from './agents/MockBettingAgent'

export interface AgentRequest {
  policy: JevPolicy
  /** キーがあってもモックを使う（API を消費せずに UI を試すため） */
  forceMock?: boolean
}

export interface AgentAvailability {
  kind: 'jev' | 'mock'
  label: string
  /** 利用者に見せる補足（なぜモックなのか等） */
  note: string
}

const STRATEGY: Record<JevPolicy, BetStrategy> = {
  'max-ev': 'expected_value',
  'max-win': 'max_probability',
}

const MOCK_LABEL = 'Mock Jev（オッズ逆数ベースライン）'

export function agentAvailability(req: Pick<AgentRequest, 'forceMock'> = {}): AgentAvailability {
  if (req.forceMock) {
    return { kind: 'mock', label: MOCK_LABEL, note: 'Settings でモックエージェントが選ばれています（API は呼びません）。' }
  }
  if (!hasApiKey()) {
    return {
      kind: 'mock',
      label: MOCK_LABEL,
      note: 'API キーが未設定のため、モックエージェントで動作しています（Settings でキーを保存すると Jev を使います）。',
    }
  }
  return { kind: 'jev', label: 'Jev (typesafe-ai/jev)', note: 'Vercel AI Gateway 経由で Jev を呼び出します。' }
}

export function createBettingAgent(req: AgentRequest): BettingAgent {
  if (agentAvailability(req).kind === 'mock') return new MockBettingAgent({ policy: req.policy })
  // キーは呼び出しのたびに読む。エージェントにキーを保持させず、Settings での変更も即反映するため
  return new JevBettingAgent({ getApiKey: () => loadApiKey(), strategy: STRATEGY[req.policy] })
}
