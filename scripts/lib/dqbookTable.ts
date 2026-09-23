/**
 * dqbook の data/*.txt（`:` 区切り・1 行目ヘッダ）を読むための最小パーサ。
 *
 * 値の表記は列ごとに固定されている（固定桁 = 16 進、可変桁 = 10 進、0/1 = ブール）。
 * 表記が想定と違う値を黙って数値化すると、原典の改版や列ずれに気付けないため、
 * 変換関数はすべて書式を厳密に検査し、外れたら例外にする。
 */

export interface DqbookTable {
  file: string
  header: string[]
  rows: DqbookRow[]
}

export interface DqbookRow {
  /** データ行の 0 始まり添字（ヘッダを除く）。配列添字 = ROM 上の ID になる */
  index: number
  /** 1 始まりの物理行番号。エラーメッセージで原典の該当行を示すため */
  line: number
  /** ヘッダ名で列を引く。存在しない列名は列ずれの兆候なので例外にする */
  get(column: string): string
}

export function parseDqbookTable(file: string, text: string, expectedHeader: readonly string[]): DqbookTable {
  // 末尾改行や CRLF の差でデータ行数が変わらないようにする
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) throw new Error(`${file}: 空ファイル`)
  const header = lines[0].split(':')
  // ヘッダ全体を固定値と突き合わせるのは、原典側で列が増減した際に
  // 意味の違う列を別名で読んでしまう事故を防ぐため
  if (header.length !== expectedHeader.length || header.some((h, i) => h !== expectedHeader[i])) {
    throw new Error(
      `${file}: ヘッダが想定と一致しない\n  expected: ${expectedHeader.join(':')}\n  actual:   ${header.join(':')}`,
    )
  }
  const columnIndex = new Map(header.map((h, i) => [h, i]))
  const rows = lines.slice(1).map((raw, index): DqbookRow => {
    const line = index + 2
    const fields = raw.split(':')
    if (fields.length !== header.length) {
      throw new Error(`${file}:${line}: 列数 ${fields.length}（期待値 ${header.length}）`)
    }
    return {
      index,
      line,
      get(column) {
        const i = columnIndex.get(column)
        if (i === undefined) throw new Error(`${file}: 未知の列名 "${column}"`)
        return fields[i]
      },
    }
  })
  return { file, header, rows }
}

/** 原典で「値なし」を表す表記。名前列やアイテム列に現れる */
export const NA = 'n/a'

function where(table: DqbookTable, row: DqbookRow, column: string): string {
  return `${table.file}:${row.line} [${column}]`
}

/** 固定桁の 16 進（例: `0F`, `C28DA7`）。桁数も検査して 10 進列との取り違えを防ぐ */
export function readHex(table: DqbookTable, row: DqbookRow, column: string, width: number): number {
  const v = row.get(column)
  if (!new RegExp(`^[0-9A-F]{${width}}$`).test(v)) {
    throw new Error(`${where(table, row, column)}: ${width} 桁の 16 進を期待したが "${v}"`)
  }
  return parseInt(v, 16)
}

/** 固定桁の 16 進を文字列のまま検査して返す（処理アドレスなど、数値演算しない識別子用） */
export function readHexString(table: DqbookTable, row: DqbookRow, column: string, width: number): string {
  readHex(table, row, column, width)
  return row.get(column)
}

/** 可変桁の 10 進。先頭 0 付き（= 16 進表記の可能性）を拒否する */
export function readDec(table: DqbookTable, row: DqbookRow, column: string, max?: number): number {
  const v = row.get(column)
  if (!/^(0|[1-9][0-9]*)$/.test(v)) {
    throw new Error(`${where(table, row, column)}: 10 進整数を期待したが "${v}"`)
  }
  const n = Number(v)
  // ビットフィールド幅（解説 XML の桁マスク）を超える値は列ずれの兆候
  if (max !== undefined && n > max) {
    throw new Error(`${where(table, row, column)}: 値 ${n} がビット幅の上限 ${max} を超える`)
  }
  return n
}

/** 1 ビットのブール属性（`0` / `1`） */
export function readBool(table: DqbookTable, row: DqbookRow, column: string): boolean {
  const v = row.get(column)
  if (v !== '0' && v !== '1') {
    throw new Error(`${where(table, row, column)}: 0/1 を期待したが "${v}"`)
  }
  return v === '1'
}
