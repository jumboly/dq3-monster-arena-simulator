/**
 * 乱数源の抽象。
 *
 * Battle Core は乱数の出どころを知らない。初期実装は「分布が等価な」擬似乱数
 * （SeededRandom）だが、後から SFC 実機の乱数生成器（SfcDq3Rng）へ差し替えられる
 * ように、コアはこのインターフェースだけに依存する。
 */
export interface RandomSource {
  /** 0 以上 maxExclusive 未満の整数を一様に返す。maxExclusive は 1 以上。 */
  nextInt(maxExclusive: number): number
}

/** 0..maxInclusive の閉区間。ROM 資料は randint(0, n) 表記が多いので読み替えを 1 か所に集める。 */
export function randInclusive(rng: RandomSource, min: number, max: number): number {
  return min + rng.nextInt(max - min + 1)
}

/**
 * シード固定の擬似乱数（mulberry32）。
 *
 * SFC 実機の乱数列とは一致しない（Approximation）。目的はゴールデンテストと
 * ログ再現性のための決定性であって、実機の乱数列の再現ではない。
 */
export class SeededRandom implements RandomSource {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** 現在の内部状態。Internal ログに残し、同じ地点から再生できるようにするため。 */
  get snapshot(): number {
    return this.state
  }

  private nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError(`nextInt: maxExclusive must be a positive integer, got ${maxExclusive}`)
    }
    // 剰余の偏りを避けるため棄却法を使う（2^32 が maxExclusive で割り切れない場合の補正）
    const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive
    let x = this.nextUint32()
    while (x >= limit) x = this.nextUint32()
    return x % maxExclusive
  }
}

/** UI 等でシードを新規に作るとき用。暗号用途ではない。 */
export function randomSeed(): number {
  return (Math.random() * 0x1_0000_0000) >>> 0
}
