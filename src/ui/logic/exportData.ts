/**
 * エクスポート用データの組み立て。
 *
 * API キーを絶対に含めないため、ストレージ全体をダンプするのではなく
 * 出力するフィールドを明示的に列挙する（許可リスト方式）。
 * 新しい保存項目が増えても、ここに書き足さない限り出力されない。
 */
import type { HistoryEntry, Session, Settings } from '../../storage/session'

export const EXPORT_FORMAT = 'dq3-arena-export'
/**
 * 3: 引き分けの払い戻し設定（settings.drawPolicy）を廃止。廃止前に遊んだ試合の履歴には当時の drawPolicy が残る。
 * 2: 冒険の書（複数冊）対応。1 は単一の session / history だった
 */
export const EXPORT_VERSION = 3

export interface ExportBook {
  session: Session
  history: HistoryEntry[]
}

export interface ExportPayload {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: string
  settings: Settings
  books: ExportBook[]
}

export function buildExport(p: { books: ExportBook[]; settings: Settings; now?: Date }): ExportPayload {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (p.now ?? new Date()).toISOString(),
    settings: {
      jevPolicy: p.settings.jevPolicy,
      autoPlayFailureLimit: p.settings.autoPlayFailureLimit,
      useMockAgent: p.settings.useMockAgent,
    },
    books: p.books.map((b) => ({ session: b.session, history: b.history })),
  }
}
