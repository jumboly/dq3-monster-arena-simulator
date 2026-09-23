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

/**
 * 8 枠の行動を同名でまとめ、選択確率を合算する（カード上で「何をどれくらい使うか」を一目で見せるため）。
 * 重みが無い（ローテーション戦略など）場合は枠数だけ数える。出現順は最初に現れた枠の順を保つ。
 */
export function aggregateActions(
  actions: Array<{ name: string; forbiddenInArena: boolean; weight?: number }>,
): Array<{ name: string; forbiddenInArena: boolean; weight: number | null; slots: number }> {
  const out: Array<{ name: string; forbiddenInArena: boolean; weight: number | null; slots: number }> = []
  for (const a of actions) {
    const hit = out.find((x) => x.name === a.name && x.forbiddenInArena === a.forbiddenInArena)
    if (hit) {
      hit.slots += 1
      hit.weight = hit.weight === null || a.weight === undefined ? null : hit.weight + a.weight
    } else {
      out.push({ name: a.name, forbiddenInArena: a.forbiddenInArena, weight: a.weight ?? null, slots: 1 })
    }
  }
  return out
}

/** A, B, C, D。スロット番号より選手を指し示しやすいため */
export function slotLetter(slot: number): string {
  return String.fromCharCode(65 + slot)
}
