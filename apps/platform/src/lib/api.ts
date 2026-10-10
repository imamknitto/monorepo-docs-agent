import { t } from './i18n'

export const API_URL =
  import.meta.env?.VITE_API_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:8377'

export const AGENT_URL =
  import.meta.env?.VITE_AGENT_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:8001'

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

/** Files above this go straight to background conversion (POST /convert/jobs). */
export const ASYNC_THRESHOLD_BYTES = 8 * 1024 * 1024

export interface ImageMeta {
  page: number
  kind: string
  filename: string
  url: string
  width: number
  height: number
  size_bytes: number
  ocr_text?: string | null
  flowchart_mermaid?: string | null
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

export type OcrScope = 'all' | 'flowchart'

function convertForm(
  file: File,
  scanImages: boolean,
  extractImages = true,
  ocrImages = false,
  ocrScope: OcrScope = 'all',
): FormData {
  const form = new FormData()
  form.append('file', file)
  form.append('scan_images', String(scanImages))
  form.append('extract_images', String(extractImages))
  form.append('ocr_images', String(ocrImages))
  form.append('ocr_scope', ocrScope)
  return form
}

function errDetail(text: string, fallback: string): string {
  try {
    const body = JSON.parse(text) as { detail?: string }
    if (typeof body.detail === 'string' && body.detail) return body.detail
  } catch {
    /* not JSON — use raw text */
  }
  return text || fallback
}

export async function convertPdf(
  file: File,
  scanImages: boolean,
  extractImages = true,
  ocrImages = false,
  ocrScope: OcrScope = 'all',
  signal?: AbortSignal,
): Promise<ConvertResponse> {
  const res = await fetch(`${API_URL}/convert`, {
    method: 'POST',
    body: convertForm(file, scanImages, extractImages, ocrImages, ocrScope),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      errDetail(text, t('api.errConvert', { status: res.status })),
    )
  }
  return (await res.json()) as ConvertResponse
}

export interface ConvertJobAccepted {
  job_id: string
  doc_id: string
  status: string
}

export interface ConvertJobStatus {
  job_id: string
  doc_id: string
  filename?: string | null
  status: 'queued' | 'processing' | 'done' | 'error'
  progress?: { pages_done: number; pages_total: number | null } | null
  result?: ConvertResponse | null
  error?: string | null
}

export async function convertPdfAsync(
  file: File,
  scanImages: boolean,
  extractImages = true,
  ocrImages = false,
  ocrScope: OcrScope = 'all',
  signal?: AbortSignal,
): Promise<ConvertJobAccepted> {
  const res = await fetch(`${API_URL}/convert/jobs`, {
    method: 'POST',
    body: convertForm(file, scanImages, extractImages, ocrImages, ocrScope),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      errDetail(text, t('api.errConvert', { status: res.status })),
    )
  }
  return (await res.json()) as ConvertJobAccepted
}

export async function getConvertJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<ConvertJobStatus> {
  const res = await fetch(`${API_URL}/v1/convert/jobs/${jobId}`, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      errDetail(text, t('api.errConvert', { status: res.status })),
    )
  }
  return (await res.json()) as ConvertJobStatus
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll until done/error. Resolves with the ConvertResponse on success. */
export async function pollConvertJob(
  jobId: string,
  opts?: {
    signal?: AbortSignal
    intervalMs?: number
    timeoutMs?: number
    onUpdate?: (s: ConvertJobStatus) => void
  },
): Promise<ConvertResponse> {
  const intervalMs = opts?.intervalMs ?? 2500
  const timeoutMs = opts?.timeoutMs ?? 30 * 60 * 1000
  const started = Date.now()
  for (;;) {
    if (opts?.signal?.aborted) throw new Error(t('api.errConvertGeneric'))
    const st = await getConvertJob(jobId, opts?.signal)
    opts?.onUpdate?.(st)
    if (st.status === 'done') {
      if (!st.result) throw new Error(t('api.errConvertGeneric'))
      return st.result
    }
    if (st.status === 'error') {
      throw new Error(st.error || t('api.errConvertGeneric'))
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(t('api.errConvertTimeout'))
    }
    await sleep(intervalMs)
  }
}

export interface DocSummary {
  doc_id: string
  markdown_url: string
  filename?: string
  created_at?: string
  expires_at?: string
  stats?: {
    pages: number
    scanned_pages: number
    tables: number
    images_kept: number
    images_skipped: number
  }
  warnings?: string[]
}

export async function listDocuments(): Promise<DocSummary[]> {
  const res = await fetch(`${API_URL}/documents`)
  if (!res.ok) throw new Error(t('api.errDocs', { status: res.status }))
  const body = (await res.json()) as { documents: DocSummary[] }
  return body.documents ?? []
}

export async function deleteDocument(docId: string): Promise<void> {
  const res = await fetch(`${API_URL}/documents/${docId}`, { method: 'DELETE' })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(detail || t('api.errDeleteDoc', { status: res.status }))
  }
}

export async function fetchMarkdown(docId: string): Promise<string> {
  const res = await fetch(`${API_URL}/public/${docId}/doc.md`)
  if (!res.ok) {
    const dl = await fetch(`${API_URL}/download/${docId}`)
    if (!dl.ok) throw new Error(t('api.errMarkdown'))
    return dl.text()
  }
  return res.text()
}
