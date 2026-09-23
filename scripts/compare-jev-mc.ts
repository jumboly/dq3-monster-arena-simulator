/**
 * Jev の予測確率と、シミュレーター自身の Monte Carlo 勝率を同じ試合で並べる（開発・調査用）。
 *
 * なぜ: Jev の確率が較正されているか（Issue #24）を判断するには、同じ観測を与えたときの
 * 予測と、エンジンが出す P(Winner=i | Match, Bet=j) を比べる必要がある。
 * キーは .env の VERCEL_AI_GATEWAY_API_KEY から読み、画面・ファイルには出力しない。
 *
 *   npx tsx scripts/compare-jev-mc.ts [cardNo ...]      （試合番号は 1 始まり）
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JevBettingAgent } from '../src/ai/JevBettingAgent'
import { createDQ3ArenaGame } from '../src/core/arena/DQ3ArenaGame'
import { DQ3BattleEngine } from '../src/core/battle/DQ3BattleEngine'
import { SeededRandom } from '../src/core/rng/RandomSource'

const ROOT = new URL('..', import.meta.url).pathname
const RUNS = 500
/** 混雑時に連投して 429 を誘発しないための間隔 */
const GAP_MS = 2000

function readEnvKey(): string | null {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return null
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*VERCEL_AI_GATEWAY_API_KEY\s*=\s*(.*)\s*$/.exec(line)
    if (m) return m[1].replace(/^['"]|['"]$/g, '').trim() || null
  }
  return null
}

const key = readEnvKey()
if (!key) {
  console.error('.env に VERCEL_AI_GATEWAY_API_KEY がないため終了します')
  process.exit(1)
}

const engine = new DQ3BattleEngine()
const game = createDQ3ArenaGame({ engine })
const cards = process.argv.slice(2).map(Number).filter((n) => n >= 1 && n <= 37)
const agent = new JevBettingAgent({ getApiKey: () => key, strategy: 'max_probability' })
const pct = (x: number) => `${(x * 100).toFixed(0)}%`.padStart(4)

for (const cardNo of cards.length ? cards : [1, 20, 29]) {
  const offer = game.createOfferForCard({ cardIndex: cardNo - 1, heroLevel: 30, round: 1, seed: cardNo })
  const n = offer.contestants.length
  // Monte Carlo は「その選手に賭けたとき」の勝率（Group 4 の影響を含む）
  const mc = offer.contestants.map((c) => {
    let wins = 0
    for (let i = 0; i < RUNS; i++) {
      const r = engine.runArena({ monsterIds: offer.contestants.map((x) => x.monsterId), heroLevel: 30, betSlot: c.slot }, new SeededRandom(i * 9973 + c.slot))
      if (r.outcome.kind === 'winner' && r.outcome.slot === c.slot) wins++
    }
    return wins / RUNS
  })
  console.log(`\n試合 ${cardNo}`)
  for (const mode of ['classic', 'analyst'] as const) {
    const obs = game.observe(offer, mode)
    try {
      const d = await agent.decide(obs)
      console.log(`  ${mode.padEnd(8)} Jev: ${obs.contestants.map((c) => `${c.name} ${pct(d.probabilities[c.id] ?? 0)}`).join(' / ')}  (引き分け ${pct(Number(d.meta?.drawProbability ?? 0))})`)
    } catch (e) {
      console.log(`  ${mode.padEnd(8)} Jev: 失敗 ${(e as Error).message}`)
    }
    await new Promise((r) => setTimeout(r, GAP_MS))
  }
  console.log(`  ${'MC'.padEnd(8)}     ${offer.contestants.map((c, k) => `${c.name} ${pct(mc[k])}`).join(' / ')}`)
  console.log(`  ${'odds'.padEnd(8)}     ${offer.contestants.map((c) => `${c.name} ×${game.oddsValue(offer, c.slot)}`).join(' / ')}${n ? '' : ''}`)
}
