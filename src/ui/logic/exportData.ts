/**
 * エクスポート用データの組み立て。
 *
 * API キーを絶対に含めないため、ストレージ全体をダンプするのではなく
 * 出力するフィールドを明示的に列挙する（許可リスト方式）。
 * 新しい保存項目が増えても、ここに書き足さない限り出力されない。
 */
import type { HistoryEntry, Session, Settings } from '../../storage/session'

export const EXPORT_FORMAT = 'dq3-arena-export'
export const EXPORT_VERSION = 1

export interface ExportPayload {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: string
  settings: Settings
  session: Session | null
  history: HistoryEntry[]
}

export function buildExport(p: {
  session: Session | null
  history: HistoryEntry[]
  settings: Settings
  now?: Date
}): ExportPayload {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (p.now ?? new Date()).toISOString(),
    settings: {
      jevPolicy: p.settings.jevPolicy,
      autoPlayFailureLimit: p.settings.autoPlayFailureLimit,
      useMockAgent: p.settings.useMockAgent,
      drawPolicy: p.settings.drawPolicy,
    },
    session: p.session,
    history: p.history,
  }
}
