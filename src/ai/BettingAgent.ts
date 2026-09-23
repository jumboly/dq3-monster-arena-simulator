/**
 * 賭け判断エージェントの契約。
 *
 * Battle Core とは MatchObservation / BetDecision だけで接続する。これにより
 * Jev 以外（他の LLM、ローカルモデル、独自 API、統計ベースライン）へ差し替えられる。
 * MatchObservation は「賭ける前に人間に見せてよい情報」だけから作り、RNG シード・
 * 実際の初期 HP・あやしいかげの正体などの Hidden Runtime State は入れない。
 */

export type InformationMode = 'classic' | 'analyst'

export interface ObservedAction {
  name: string
  /**
   * 格闘場使用許可が 0 の行動か。ROM はこの行動を「通常攻撃に置き換える」のではなく
   * 除外して再抽選し、全行動が除外されたときだけ通常攻撃にする（battle-spec §4.3）。
   */
  forbiddenInArena: boolean
  /** コマンド決定戦略による選択確率（分母 256 を正規化した値）。ローテーション戦略では省略 */
  weight?: number
}

export interface MatchObservation {
  informationMode: InformationMode
  heroLevel: number
  stake: number
  contestants: Array<{
    id: string
    name: string
    /** 表示オッズ（例: 2.8） */
    odds: number
    stats?: {
      maxHp: number
      mp: number
      attack: number
      defense: number
      agility: number
    }
    actions?: ObservedAction[]
    ai?: {
      strategy: string
      selectionJudgment: number
      /** 選択判断の表示名（単純 / 標準 / 賢い） */
      selectionJudgmentLabel?: string
      multiAction: string
      concentrate: boolean
    }
    traits?: string[]
    resistances?: Record<string, number>
  }>
}

/**
 * エージェントと外部 API の実際のやり取り（表示・学習用）。
 *
 * 「Jev に何を送り、何が返ったか」を利用者が確かめられるようにするため、エージェント共通の
 * 形で持つ。API キーは含めない（ヘッダは伏せ字、本文にはもともとキーが入らない）。
 */
export interface AgentExchange {
  endpoint: string
  method: string
  /** 送ったヘッダ（Authorization は伏せ字） */
  requestHeaders: Record<string, string>
  /** 送った本文（JSON） */
  requestBody: unknown
  /** 最後の試行の HTTP ステータス。通信自体が失敗したら null */
  status: number | null
  /** 最後の試行で受け取った本文（JSON として読めなければ文字列） */
  responseBody: unknown
  attempts: number
  /** 成功した試行の往復時間 */
  latencyMs: number | null
  /** 再試行の待ちを含む全体の所要時間 */
  elapsedMs: number
}

export interface BetDecision {
  /** contestants[].id のいずれか */
  bet: string
  /** 各 id の勝率予測。合計はおおむね 1（引き分けを含めない） */
  probabilities: Record<string, number>
  reason: string
  /** 実装固有のメタ情報（モデル名・試行回数・所要時間など） */
  meta?: Record<string, string | number>
  /** 外部 API との実際のやり取り（API を使わないエージェントでは省略） */
  exchange?: AgentExchange
}

export interface BettingAgent {
  readonly id: string
  readonly label: string
  decide(observation: MatchObservation, signal?: AbortSignal): Promise<BetDecision>
}
