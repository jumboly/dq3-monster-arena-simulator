/**
 * Jev 実 API プローブ（開発用）。`npx tsx scripts/probe-jev.ts`
 *
 * 目的: レスポンス形式・確率の性質・同名区別・Classic/Analyst 差・オッズへの追従・
 * エラー挙動・レイテンシを実測し、docs/research/jev-probe.md とプロンプト設計に反映する。
 *
 * キーの扱い: `.env` の VERCEL_AI_GATEWAY_API_KEY を自前で読む（dotenv を依存に足さないため）。
 * キーは fetch の Authorization ヘッダにだけ使い、標準出力・保存ファイルには一切出さない。
 * 保存するのはリクエスト本文（state/questions のみ）と応答本文だけ。
 *
 * 呼び出し回数: 再試行も 1 回と数え、合計 BUDGET 回で打ち切る（課金・レート制限を避けるため）。
 * 観測値（能力値・オッズ）は Battle Core 未接続のための概算の手組みで、実機データではない。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MatchObservation } from '../src/ai/BettingAgent'
import { JevBettingAgent } from '../src/ai/JevBettingAgent'
import type { BetStrategy } from '../src/ai/JevBettingAgent'
import { VercelGatewayClient } from '../src/ai/VercelGatewayClient'
import type { AttemptInfo, FetchLike } from '../src/ai/VercelGatewayClient'
import { isAiGatewayError, redactSecrets } from '../src/ai/errors'
import { PROMPTS } from '../src/ai/prompts'
import type { PromptSet } from '../src/ai/prompts'

/**
 * 1 回の実行での fetch 上限（再試行込み）。複数回に分けて実行するときは
 * `--budget=N` で残り回数を渡し、調査全体で 30 回を超えないようにする。
 */
const BUDGET = Number(/^--budget=(\d+)$/.exec(process.argv.find((a) => a.startsWith('--budget=')) ?? '')?.[1] ?? 30)
/** `--set=v2` で v2 プロンプト比較用の小さなケース集合だけを流す */
const SET = process.argv.find((a) => a.startsWith('--set='))?.slice('--set='.length) ?? 'base'
/** ケース間の間隔。混雑中に連投して 429 を誘発しないため */
const GAP_MS = 2000
const ROOT = new URL('..', import.meta.url).pathname

function readEnvKey(): string | null {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return null
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*VERCEL_AI_GATEWAY_API_KEY\s*=\s*(.*)\s*$/.exec(line)
    if (m) {
      const v = m[1].replace(/^['"]|['"]$/g, '').trim()
      return v || null
    }
  }
  return null
}

// ---- 手組みの観測（概算値） ----

type Stats = NonNullable<MatchObservation['contestants'][number]['stats']>
interface Mon {
  name: string
  stats: Stats
  actions: Array<{ name: string; replacedByAttack: boolean }>
  traits?: string[]
  resistances?: Record<string, number>
}

const MON: Record<string, Mon> = {
  slime: { name: 'スライム', stats: { maxHp: 7, mp: 0, attack: 9, defense: 4, agility: 3 }, actions: [{ name: 'こうげき', replacedByAttack: false }] },
  crow: { name: 'おおがらす', stats: { maxHp: 9, mp: 0, attack: 11, defense: 5, agility: 7 }, actions: [{ name: 'こうげき', replacedByAttack: false }] },
  rabbit: { name: 'いっかくうさぎ', stats: { maxHp: 12, mp: 0, attack: 13, defense: 7, agility: 8 }, actions: [{ name: 'こうげき', replacedByAttack: false }] },
  almiraj: {
    name: 'アルミラージ',
    stats: { maxHp: 20, mp: 10, attack: 17, defense: 12, agility: 18 },
    actions: [
      { name: 'こうげき', replacedByAttack: false },
      { name: 'ラリホー', replacedByAttack: false },
    ],
  },
  hagure: {
    name: 'はぐれメタル',
    stats: { maxHp: 6, mp: 20, attack: 55, defense: 255, agility: 150 },
    actions: [
      { name: 'こうげき', replacedByAttack: false },
      { name: 'ベギラマ', replacedByAttack: false },
      { name: 'にげる', replacedByAttack: true },
    ],
    traits: ['会心の一撃以外のダメージはほぼ 0〜1'],
    resistances: { メラ: 1, ギラ: 1, イオ: 1, ヒャド: 1, バギ: 1, デイン: 1, ラリホー: 1, マホトーン: 1 },
  },
  metal: {
    name: 'メタルスライム',
    stats: { maxHp: 4, mp: 10, attack: 10, defense: 255, agility: 150 },
    actions: [
      { name: 'こうげき', replacedByAttack: false },
      { name: 'メラ', replacedByAttack: false },
      { name: 'にげる', replacedByAttack: true },
    ],
    traits: ['会心の一撃以外のダメージはほぼ 0〜1'],
    resistances: { メラ: 1, ギラ: 1, イオ: 1, ヒャド: 1, バギ: 1, デイン: 1, ラリホー: 1, マホトーン: 1 },
  },
  druid: {
    name: 'ドルイド',
    stats: { maxHp: 55, mp: 40, attack: 60, defense: 50, agility: 45 },
    actions: [
      { name: 'こうげき', replacedByAttack: false },
      { name: 'ベギラマ', replacedByAttack: false },
      { name: 'マホトーン', replacedByAttack: false },
    ],
  },
}

function obs(mode: 'classic' | 'analyst', entries: Array<[keyof typeof MON, number]>): MatchObservation {
  return {
    informationMode: mode,
    heroLevel: 20,
    stake: 200,
    contestants: entries.map(([k, odds], i) => {
      const m = MON[k]
      const base = { id: `monster-${'abcde'[i]}`, name: m.name, odds }
      if (mode === 'classic') return base
      return {
        ...base,
        stats: m.stats,
        actions: m.actions,
        ai: { strategy: 'normal', selectionJudgment: 0, multiAction: 'single', concentrate: false },
        ...(m.traits ? { traits: m.traits } : {}),
        ...(m.resistances ? { resistances: m.resistances } : {}),
      }
    }),
  }
}

const M1: Array<[keyof typeof MON, number]> = [['slime', 5.2], ['crow', 3.1], ['rabbit', 1.8]]
const M1_SWAPPED: Array<[keyof typeof MON, number]> = [['slime', 1.8], ['crow', 3.1], ['rabbit', 5.2]]
const M2: Array<[keyof typeof MON, number]> = [['almiraj', 3.6], ['almiraj', 3.6], ['almiraj', 3.6], ['almiraj', 3.6]]
const M3: Array<[keyof typeof MON, number]> = [['hagure', 2.1], ['metal', 6.3], ['druid', 1.9]]
const M3_SWAPPED: Array<[keyof typeof MON, number]> = [['hagure', 6.3], ['metal', 2.1], ['druid', 1.9]]
const MIXED_DUP: Array<[keyof typeof MON, number]> = [['slime', 4.4], ['slime', 4.4], ['rabbit', 1.7]]

interface Case {
  name: string
  observation: MatchObservation
  strategy?: BetStrategy
  includeOdds?: boolean
  includeDraw?: boolean
  prompt?: PromptSet
}

const V1 = PROMPTS['jev-bet/v1']
const V2 = PROMPTS['jev-bet/v2']

// v2（同名の規則文の書き換え）の効果確認。v1 との差分が出るはずの同名ケースを中心にする
const V2_CASES: Case[] = [
  { name: 'v2-m2-almiraj4-classic', observation: obs('classic', M2), prompt: V2 },
  { name: 'v2-m2-almiraj4-analyst', observation: obs('analyst', M2), prompt: V2 },
  { name: 'v2-mixed-dup-slime2-classic', observation: obs('classic', MIXED_DUP), prompt: V2 },
  { name: 'v2-m1-slime-classic', observation: obs('classic', M1), prompt: V2 },
  { name: 'v2-m3-metal-analyst', observation: obs('analyst', M3), prompt: V2 },
]

const BASE_CASES: Case[] = [
  // 反復 2 回: 決定性と Classic/Analyst 差
  ...(['classic', 'analyst'] as const).flatMap((mode) =>
    [1, 2].flatMap((rep) => [
      { name: `m1-slime-${mode}-r${rep}`, observation: obs(mode, M1) },
      { name: `m2-almiraj4-${mode}-r${rep}`, observation: obs(mode, M2) },
      { name: `m3-metal-${mode}-r${rep}`, observation: obs(mode, M3) },
    ]),
  ),
  // オッズへの追従
  { name: 'm1-slime-classic-no-odds', observation: obs('classic', M1), includeOdds: false },
  { name: 'm1-slime-classic-swapped-odds', observation: obs('classic', M1_SWAPPED) },
  { name: 'm1-slime-analyst-swapped-odds', observation: obs('analyst', M1_SWAPPED) },
  { name: 'm3-metal-analyst-swapped-odds', observation: obs('analyst', M3_SWAPPED) },
  // 同名＋別名の混在
  { name: 'mixed-dup-slime2-classic', observation: obs('classic', MIXED_DUP) },
  // 引き分けを選択肢から外した場合
  { name: 'm1-slime-analyst-no-draw', observation: obs('analyst', M1), includeDraw: false },
].map((c) => ({ ...c, prompt: V1 }))

const CASES = SET === 'v2' ? V2_CASES : BASE_CASES

// ---- 実行 ----

interface Capture {
  requestBody: unknown
  status: number | null
  responseText: string | null
  retryAfter: string | null
}

async function main() {
  const key = readEnvKey()
  if (!key) {
    console.log('.env に VERCEL_AI_GATEWAY_API_KEY が無いためプローブをスキップします')
    return
  }
  const secrets = [key]
  const outDir = join(ROOT, 'probe-results', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(outDir, { recursive: true })

  let calls = 0
  let captures: Capture[] = []
  // 予算管理と生応答の取得のためだけに fetch を包む。ヘッダ（キー）は記録しない
  const countingFetch: FetchLike = async (url, init) => {
    if (calls >= BUDGET) throw new Error('probe budget exhausted')
    calls++
    const cap: Capture = { requestBody: JSON.parse(String(init.body)), status: null, responseText: null, retryAfter: null }
    captures.push(cap)
    const res = await fetch(url, init)
    cap.status = res.status
    cap.retryAfter = res.headers.get('retry-after')
    cap.responseText = redactSecrets(await res.clone().text(), secrets)
    return res
  }

  let attempts: AttemptInfo[] = []
  const client = new VercelGatewayClient({ fetch: countingFetch, maxAttempts: 3, onAttempt: (a) => attempts.push(a) })

  const summary: Array<Record<string, unknown>> = []
  const save = (name: string, data: unknown) => writeFileSync(join(outDir, `${name}.json`), JSON.stringify(data, null, 1))

  for (const c of CASES) {
    if (summary.length > 0) await new Promise((r) => setTimeout(r, GAP_MS))
    if (calls >= BUDGET - (SET === 'base' ? 2 : 0)) {
      console.log(`予算に達したため ${c.name} 以降を省略`)
      break
    }
    captures = []
    attempts = []
    const agent = new JevBettingAgent({
      getApiKey: () => key,
      client,
      strategy: c.strategy,
      includeOdds: c.includeOdds,
      includeDraw: c.includeDraw,
      prompt: c.prompt,
      // 生の Jev 分布を見たいので、プローブでは平均化・取り直しをしない
      symmetrizeIdentical: false,
      schemaRetries: 0,
    })
    let decision: unknown = null
    let error: string | null = null
    try {
      decision = await agent.decide(c.observation)
    } catch (e) {
      error = redactSecrets(isAiGatewayError(e) ? `${e.kind}: ${e.message}` : String(e), secrets)
    }
    const parsed = captures.map((cp) => {
      try {
        return { ...cp, response: cp.responseText ? JSON.parse(cp.responseText) : null, responseText: undefined }
      } catch {
        return cp
      }
    })
    save(c.name, { case: c.name, attempts, decision, error, exchanges: parsed })
    const d = decision as { bet?: string; probabilities?: Record<string, number>; meta?: Record<string, unknown> } | null
    const answer = (parsed.at(-1) as { response?: { answers?: { winner?: unknown } } } | undefined)?.response?.answers?.winner
    const line = {
      case: c.name,
      statuses: attempts.map((a) => a.status).join(','),
      latencyMs: attempts.map((a) => a.latencyMs).join(','),
      bet: d?.bet ?? null,
      raw: answer ?? null,
      sum: d?.meta?.probabilitySum,
      confidence: d?.meta?.confidence,
      error,
    }
    summary.push(line)
    console.log(JSON.stringify(line))
  }

  // エラー挙動: 無効キー（実キーは使わない）
  if (SET === 'base' && calls < BUDGET) {
    captures = []
    attempts = []
    const bad = new VercelGatewayClient({ fetch: countingFetch, maxAttempts: 1, onAttempt: (a) => attempts.push(a) })
    let error: string | null = null
    try {
      await bad.evaluate({ state: { x: 1 }, questions: { q: { type: 'boolean', instructions: 'x は 1 か' } } }, { apiKey: 'invalid-key-for-probe' })
    } catch (e) {
      error = isAiGatewayError(e) ? `${e.kind}: ${e.message}` : String(e)
    }
    save('error-invalid-key', { attempts, error, exchanges: captures })
    console.log(JSON.stringify({ case: 'error-invalid-key', error, status: captures[0]?.status }))
  }
  // エラー挙動: instructions 欠落（入力不正）
  if (SET === 'base' && calls < BUDGET) {
    captures = []
    attempts = []
    let error: string | null = null
    try {
      await client.evaluate(
        { state: { x: 1 }, questions: { q: { type: 'choice', criteria: { a: 'a', b: 'b' } } as never } },
        { apiKey: key },
      )
    } catch (e) {
      error = redactSecrets(isAiGatewayError(e) ? `${e.kind}: ${e.message}` : String(e), secrets)
    }
    save('error-missing-instructions', { attempts, error, exchanges: captures })
    console.log(JSON.stringify({ case: 'error-missing-instructions', error, status: captures[0]?.status }))
  }

  save('_summary', { calls, budget: BUDGET, summary })
  console.log(`total fetch calls: ${calls}/${BUDGET}  saved: ${outDir}`)
}

main().catch((e) => {
  // 想定外の例外でもキーを出さない
  console.error(redactSecrets(String(e), [readEnvKey() ?? '']))
  process.exit(1)
})
