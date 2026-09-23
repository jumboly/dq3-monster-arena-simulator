/**
 * ROM の乱数呼び出し口と 1 対 1 に対応する名前付きプリミティブ（battle-spec §9, 提案 P-06）。
 *
 * なぜ RandomSource を直接使わないか:
 * 将来 SFC 実機の乱数生成器（SfcDq3Rng, U-16）へ差し替えたとき、「どの呼び出し口を何回・どの順で
 * 引いたか」まで一致させる必要がある。Battle Core がこのクラス経由でしか乱数を引かなければ、
 * 差し替えはこのファイル（または RandomSource 実装）だけで済み、消費順の検証もトレースで行える。
 *
 * 現状はどのプリミティブも RandomSource.nextInt への写像で、分布だけが等価（Approximation, U-16）。
 */
import type { RandomSource } from './RandomSource'

/** トレース 1 件。Internal ログと消費順テストに使う */
export interface RomRandomCall {
  /** 呼び出し口名（rand00FF 等） */
  fn: RomRandomFn
  /** 引数（rand0toA の A、randRangeXA の "X,A"、pickRandomBit のマスクなど） */
  arg?: string
  /** 戻り値（pickRandomBit でビットが無いときは -1） */
  value: number
}

export type RomRandomFn =
  | 'rand00FF'
  | 'rand0toA'
  | 'rand00FF_b'
  | 'rand63to99'
  | 'rand5Ato83'
  | 'pickRandomBit'
  | 'randRangeXA'

export class RomRandom {
  private readonly src: RandomSource
  /** 呼び出し履歴。drainTrace() で取り出すまで溜める */
  private trace: RomRandomCall[] = []
  /** 通算消費回数（決定性の検証用） */
  private calls = 0

  constructor(src: RandomSource) {
    this.src = src
  }

  get callCount(): number {
    return this.calls
  }

  /** 溜まった呼び出し履歴を取り出して空にする（1 イベント分の乱数を Internal ログへ添えるため） */
  drainTrace(): RomRandomCall[] {
    const t = this.trace
    this.trace = []
    return t
  }

  private record(fn: RomRandomFn, value: number, arg?: string): number {
    this.calls += 1
    this.trace.push(arg === undefined ? { fn, value } : { fn, arg, value })
    return value
  }

  /** $0012D1 乱数 $00-$FF。マヌーサ(&1)、モンスター打撃の 0/1、メガンテ(LSR) で使う（battle-spec §9） */
  rand00FF(): number {
    return this.record('rand00FF', this.src.nextInt(256))
  }

  /**
   * $00133E 乱数 0..A（閉区間, Likely）。A は ROM 上 1 バイト。
   * ルーレット・回避・痛恨(A=7)・あやしいかげ等（battle-spec §9）。
   * A が 1 バイトを超える呼び出しは ROM に無い想定だが、暫定式（U-09 など）で超えうるため
   * 例外にはせずそのまま閉区間として扱う。
   */
  rand0toA(a: number): number {
    if (!Number.isInteger(a) || a < 0) throw new RangeError(`rand0toA: A must be >= 0, got ${a}`)
    return this.record('rand0toA', this.src.nextInt(a + 1), String(a))
  }

  /** $001457 乱数 $00-$FF（$0012D1 と別ルーチン。差は不明: U-16）。ターン中の素早さ専用（§3.2） */
  rand00FF_b(): number {
    return this.record('rand00FF_b', this.src.nextInt(256))
  }

  /** $001472 乱数 $63-$99（99..153）。モンスター打撃の倍率（§7.1） */
  rand63to99(): number {
    return this.record('rand63to99', 0x63 + this.src.nextInt(0x99 - 0x63 + 1))
  }

  /** $0014A3 乱数 $5A-$83（90..131）。会心・痛恨の倍率（§6.6） */
  rand5Ato83(): number {
    return this.record('rand5Ato83', 0x5a + this.src.nextInt(0x83 - 0x5a + 1))
  }

  /**
   * $001407 立っているビットから 1 つを選び、その位置を返す（c=on）。無ければ null（c=off）。
   * 一様性は Likely（U-16）。ビットが無いときに乱数を消費するかは不明のため、消費しない側を採る。
   * mask は 24 体分（bit i = 戦闘員インデックス i）。
   */
  pickRandomBit(mask: number): number | null {
    const bits: number[] = []
    for (let i = 0; i < 24; i++) if (mask & (1 << i)) bits.push(i)
    if (bits.length === 0) return null
    const k = this.src.nextInt(bits.length)
    return this.record('pickRandomBit', bits[k], '0x' + mask.toString(16).padStart(6, '0'))
  }

  /** $C90B75 乱数 X..A（閉区間）。呪文・息・回復の基本値（§7.3） */
  randRangeXA(x: number, a: number): number {
    if (a < x) throw new RangeError(`randRangeXA: A(${a}) < X(${x})`)
    return this.record('randRangeXA', x + this.src.nextInt(a - x + 1), `${x},${a}`)
  }
}

/** Internal ログ用に 1 行へ整形する */
export function formatRomTrace(calls: RomRandomCall[]): string {
  return calls.map((c) => (c.arg === undefined ? `${c.fn}=${c.value}` : `${c.fn}(${c.arg})=${c.value}`)).join(' ')
}
