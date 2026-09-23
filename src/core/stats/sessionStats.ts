/**
 * セッション統計（純関数）。
 *
 * React や localStorage に依存させず、履歴の最小限の形（StatRecord）だけを受け取る。
 * UI の HistoryEntry だけでなく、Monte Carlo やヘッドレスの AI 評価スクリプトからも
 * 同じ関数で集計できるようにするため。
 */

export interface StatRecord {
  won: boolean
  /** 引き分け（終了タイプ 7）。won=false と区別して集計するため。勝者なしのはずれ（6）は含めない */
  draw: boolean
  stake: number
  delta: number
  betSlot: number
  /** 実際の勝者スロット（引き分けなら null） */
  winnerSlot: number | null
  /** 出場スロット一覧（予測確率の添字を揃えるため） */
  slots: number[]
  /** 表示オッズ（倍率）。スロット → 倍率。EV 系指標の計算用 */
  odds?: Record<number, number>
  /** エージェントの予測勝率。スロット → 確率。人間の賭けには無い */
  probabilities?: Record<number, number>
}

export interface SessionStats {
  matches: number
  wins: number
  losses: number
  draws: number
  /** wins / matches。試合 0 なら null（0% と「未計測」を区別するため） */
  winRate: number | null
  initialGold: number
  currentGold: number
  profit: number
  totalStaked: number
  /** profit / totalStaked。投下資金あたりの収益率 */
  roi: number | null
}

export function computeSessionStats(records: StatRecord[], initialGold: number, currentGold: number): SessionStats {
  let wins = 0
  let draws = 0
  let totalStaked = 0
  for (const r of records) {
    if (r.won) wins += 1
    else if (r.draw) draws += 1
    totalStaked += r.stake
  }
  const matches = records.length
  const profit = currentGold - initialGold
  return {
    matches,
    wins,
    losses: matches - wins - draws,
    draws,
    winRate: matches > 0 ? wins / matches : null,
    initialGold,
    currentGold,
    profit,
    totalStaked,
    roi: totalStaked > 0 ? profit / totalStaked : null,
  }
}

// --- 予測評価（AI 用） ------------------------------------------------------
// 後から EV regret などを足すときも、StatRecord を受け取る純関数として並べる。

/** 予測を正規化する。エージェントは「おおむね 1」しか保証しないため */
export function normalizedProbabilities(r: StatRecord): Record<number, number> | null {
  if (!r.probabilities) return null
  let sum = 0
  for (const s of r.slots) sum += Math.max(0, r.probabilities[s] ?? 0)
  if (sum <= 0) return null
  const out: Record<number, number> = {}
  for (const s of r.slots) out[s] = Math.max(0, r.probabilities[s] ?? 0) / sum
  return out
}

/**
 * 多クラス Brier Score（1 試合あたり Σ_i (p_i - o_i)^2 の平均）。0 が最良、最大 2。
 * 引き分け・勝者なし（10 ターン経過のはずれ）はどの選手も勝っていないので o_i がすべて 0 として数える
 * （エージェントの確率は引き分けを含めない契約なので、引き分けは必ず減点になる）。
 */
export function brierScore(records: StatRecord[]): { score: number | null; count: number } {
  let total = 0
  let count = 0
  for (const r of records) {
    const p = normalizedProbabilities(r)
    if (!p) continue
    let s = 0
    for (const slot of r.slots) {
      const o = r.winnerSlot === slot ? 1 : 0
      s += (p[slot] - o) ** 2
    }
    total += s
    count += 1
  }
  return { score: count > 0 ? total / count : null, count }
}

export interface CalibrationBin {
  /** 区間 [lower, upper) */
  lower: number
  upper: number
  count: number
  meanPredicted: number | null
  observedRate: number | null
}

/**
 * キャリブレーション（予測確率を区間に分け、実際の勝率と比べる）。
 * 各試合の各選手を 1 サンプルとして扱う（one-vs-rest）。
 */
export function calibrationBins(records: StatRecord[], binCount = 10): CalibrationBin[] {
  const sums = Array.from({ length: binCount }, () => ({ n: 0, p: 0, hit: 0 }))
  for (const r of records) {
    const p = normalizedProbabilities(r)
    if (!p) continue
    for (const slot of r.slots) {
      // p=1.0 を最後の区間に入れるため min を取る
      const b = Math.min(binCount - 1, Math.floor(p[slot] * binCount))
      sums[b].n += 1
      sums[b].p += p[slot]
      if (r.winnerSlot === slot) sums[b].hit += 1
    }
  }
  return sums.map((s, i) => ({
    lower: i / binCount,
    upper: (i + 1) / binCount,
    count: s.n,
    meanPredicted: s.n > 0 ? s.p / s.n : null,
    observedRate: s.n > 0 ? s.hit / s.n : null,
  }))
}

/** 予測で最も確率が高かった選手が実際に勝った割合 */
export function topPickAccuracy(records: StatRecord[]): { rate: number | null; count: number } {
  let hit = 0
  let count = 0
  for (const r of records) {
    const p = normalizedProbabilities(r)
    if (!p) continue
    let best = r.slots[0]
    for (const s of r.slots) if (p[s] > p[best]) best = s
    if (r.winnerSlot === best) hit += 1
    count += 1
  }
  return { rate: count > 0 ? hit / count : null, count }
}

/**
 * エージェント自身の予測で見た「賭けた選手の期待倍率 p×odds」の平均。
 * 1 を下回るならエージェント自身が損と見込んだ賭けをしていることになる（方針の一貫性チェック）。
 * 真の確率が分かる Monte Carlo 結果と組み合わせた EV regret は後で追加する。
 */
export function meanSelfExpectedReturn(records: StatRecord[]): number | null {
  let total = 0
  let count = 0
  for (const r of records) {
    const p = normalizedProbabilities(r)
    const o = r.odds?.[r.betSlot]
    if (!p || o === undefined) continue
    total += p[r.betSlot] * o
    count += 1
  }
  return count > 0 ? total / count : null
}
