/** 表示整形。数値の見せ方を画面ごとにぶれさせないため 1 か所にまとめる */

const nf = new Intl.NumberFormat('ja-JP')

export function formatGold(n: number): string {
  return `${nf.format(n)} G`
}

export function formatSignedGold(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${nf.format(Math.abs(n))}G`
}

/** オッズは表示オッズの整数対から作った倍率を想定（例: 2.8 → "× 2.8"） */
export function formatOdds(x: number): string {
  return `× ${x.toFixed(1)}`
}

export function formatPercent(x: number | null, digits = 1): string {
  return x === null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(digits)}%`
}

/** A, B, C, D。スロット番号より選手を指し示しやすいため */
export function slotLetter(slot: number): string {
  return String.fromCharCode(65 + slot)
}
