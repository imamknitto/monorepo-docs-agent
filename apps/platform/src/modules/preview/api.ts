import { API_URL } from '../../lib/api'
import { t } from '../../lib/i18n'

export async function fetchMarkdown(docId: string): Promise<string> {
  const res = await fetch(`${API_URL}/public/${docId}/doc.md`)
  if (!res.ok) {
    const dl = await fetch(`${API_URL}/v1/download/${docId}`)
    if (!dl.ok) throw new Error(t('api.errMarkdown'))
    return dl.text()
  }
  return res.text()
}
