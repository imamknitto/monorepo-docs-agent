export const API_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:8000'

export const AGENT_URL =
  import.meta.env.VITE_AGENT_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:8001'

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

export interface ImageMeta {
  page: number
  kind: string
  filename: string
  url: string
  width: number
  height: number
  size_bytes: number
}

export interface ConvertResponse {
  doc_id: string
  markdown: string
  markdown_url: string
  stats: {
    pages: number
    scanned_pages: number
    tables: number
    images_kept: number
    images_skipped: number
  }
  images: ImageMeta[]
  warnings: string[]
  expires_at: string | null
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`
}

export async function convertPdf(
  file: File,
  scanImages: boolean,
  signal?: AbortSignal,
): Promise<ConvertResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('scan_images', String(scanImages))
  const res = await fetch(`${API_URL}/convert`, {
    method: 'POST',
    body: form,
    signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      detail || `Conversion failed (HTTP ${res.status})`,
    )
  }
  return (await res.json()) as ConvertResponse
}

export async function fetchMarkdown(docId: string): Promise<string> {
  const res = await fetch(`${API_URL}/public/${docId}/doc.md`)
  if (!res.ok) {
    const dl = await fetch(`${API_URL}/download/${docId}`)
    if (!dl.ok) throw new Error('Markdown not found or expired.')
    return dl.text()
  }
  return res.text()
}
