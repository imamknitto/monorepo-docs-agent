import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  ASYNC_THRESHOLD_BYTES,
  MAX_UPLOAD_BYTES,
  convertPdf,
  convertPdfAsync,
  deleteDocument,
  listDocuments,
  pollConvertJob,
  type ConvertResponse,
  type ConvertJobStatus,
  type DocSummary,
} from '../lib/api'
import { forgetAllDocSessions } from '../lib/chat'
import { localeTag, useI18n } from '../lib/i18n'
import { useConfirm } from '../components/ConfirmDialog'
import { UploadIcon } from '../components/icons'

export const Route = createFileRoute('/')({
  component: UploadPage,
})

function formatBytes(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(localeTag())
}

function UploadPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { t } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [scanImages, setScanImages] = useState(false)
  const [extractImages, setExtractImages] = useState(true)
  const [ocrImages, setOcrImages] = useState(false)
  const [ocrScope, setOcrScope] = useState<'all' | 'flowchart'>('all')
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function loadDocs() {
    setRefreshing(true)
    setDocsError(null)
    try {
      setDocs(await listDocuments())
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadDocs()
  }, [])

  function pick(f: File | undefined) {
    setError(null)
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setError(t('upload.errPdfOnly'))
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(t('upload.errTooBig', { name: f.name, size: formatBytes(f.size) }))
      return
    }
    setFile(f)
  }

  function describeJob(s: ConvertJobStatus): string {
    if (s.status === 'queued') return t('upload.asyncQueued')
    const done = s.progress?.pages_done ?? 0
    const total = s.progress?.pages_total
    return t('upload.asyncProcessing', {
      done,
      total: total ? `/${total}` : '',
    })
  }

  function finish(result: ConvertResponse) {
    try {
      sessionStorage.setItem(
        `halodocs:last:${result.doc_id}`,
        JSON.stringify(result),
      )
    } catch {
      /* storage full/blocked — result page still works via fetch */
    }
    void navigate({ to: '/r/$docId', params: { docId: result.doc_id } })
  }

  async function runAsync(f: File) {
    const job = await convertPdfAsync(f, scanImages, extractImages, ocrImages, ocrScope)
    const result = await pollConvertJob(job.job_id, {
      onUpdate: (s) => setProgress(describeJob(s)),
    })
    finish(result)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setProgress(null)
    if (!file) {
      setError(t('upload.errNoFile'))
      return
    }
    setPending(true)
    try {
      if (file.size > ASYNC_THRESHOLD_BYTES) {
        await runAsync(file)
        return
      }
      try {
        const result = await convertPdf(file, scanImages, extractImages, ocrImages, ocrScope)
        finish(result)
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        // Sync window exceeded (HTTP 504) — the file is too heavy for a
        // single request; retry it as a background job instead of failing.
        if (/timed out|convert_timeout|504/.test(msg)) {
          setProgress(t('upload.asyncFallback'))
          await runAsync(file)
          return
        }
        throw err
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('api.errConvertGeneric'))
    } finally {
      setPending(false)
      setProgress(null)
    }
  }

  async function onDelete(doc: DocSummary) {
    const label = doc.filename ?? doc.doc_id
    const ok = await confirm({
      title: t('library.deleteTitle'),
      detail: label,
      description: t('library.deleteDesc'),
    })
    if (!ok) return
    setDocsError(null)
    setDeletingId(doc.doc_id)
    try {
      await deleteDocument(doc.doc_id)
      forgetAllDocSessions(doc.doc_id)
      setDocs((prev) => (prev ? prev.filter((d) => d.doc_id !== doc.doc_id) : prev))
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
      <section aria-labelledby="upload-heading" className="lg:col-span-7">
        <p className="label">{t('upload.step')}</p>
        <h1
          id="upload-heading"
          className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.035em] sm:text-6xl"
        >
          {t('upload.titleA')}
          <br />
          <span className="text-fg-soft">{t('upload.titleB')}</span>
        </h1>
        <p className="mt-5 max-w-md text-fg-soft">
          {t('upload.subtitle')}
        </p>

        <form onSubmit={onSubmit} className="mt-10">
          <div
            role="button"
            tabIndex={0}
            aria-label={t('upload.dropAria')}
            onClick={() => document.getElementById('pdf-file')?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                document.getElementById('pdf-file')?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              pick(e.dataTransfer.files?.[0])
            }}
            className={`flex min-h-48 cursor-pointer flex-col items-start justify-between rounded-lg border border-dashed p-6 transition-colors ${
              dragging
                ? 'border-accent bg-accent/5'
                : file
                  ? 'border-line-strong bg-surface'
                  : 'border-line-strong hover:border-fg-soft hover:bg-surface'
            }`}
          >
            <UploadIcon
              className={`h-6 w-6 ${file ? 'text-accent-text' : 'text-fg-soft'}`}
            />
            {file ? (
              <span>
                <span className="block break-all text-lg font-medium">{file.name}</span>
                <span className="mt-1 block font-mono text-xs text-fg-soft">
                  {formatBytes(file.size)} &middot; {t('upload.fileReplace')}
                </span>
              </span>
            ) : (
              <span>
                <span className="block text-lg font-medium">
                  {t('upload.dropTitle')}{' '}
                  <span className="underline decoration-accent underline-offset-4">
                    {t('upload.browse')}
                  </span>
                </span>
                <span className="mt-1 block font-mono text-xs text-fg-soft">
                  {t('upload.dropHint')}
                </span>
              </span>
            )}
            <input
              id="pdf-file"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => pick(e.target.files?.[0] ?? undefined)}
            />
          </div>

          <div className="mt-4 divide-y divide-line rounded-lg border border-line">
            <label
              htmlFor="scan-images"
              className="flex cursor-pointer items-start gap-3 px-4 py-3"
            >
              <input
                id="scan-images"
                type="checkbox"
                checked={scanImages}
                onChange={(e) => setScanImages(e.target.checked)}
                className="mt-1 h-4 w-4 accent-accent"
              />
              <span className="text-sm">
                <span className="block font-medium">{t('options.scanTitle')}</span>
                <span className="block text-fg-soft">
                  {t('options.scanDesc')}
                </span>
                <span className="mt-1 block text-xs text-fg-soft">
                  {t('options.scanEffect')}
                </span>
              </span>
            </label>
            <label
              htmlFor="extract-images"
              className="flex cursor-pointer items-start gap-3 px-4 py-3"
            >
              <input
                id="extract-images"
                type="checkbox"
                checked={extractImages}
                onChange={(e) => {
                  setExtractImages(e.target.checked)
                  if (!e.target.checked) setOcrImages(false)
                }}
                className="mt-1 h-4 w-4 accent-accent"
              />
              <span className="text-sm">
                <span className="block font-medium">{t('options.imgTitle')}</span>
                <span className="block text-fg-soft">
                  {t('options.imgDesc')}
                </span>
                <span className="mt-1 block text-xs text-fg-soft">
                  {t('options.imgEffect')}
                </span>
              </span>
            </label>
            <label
              htmlFor="ocr-images"
              className="flex cursor-pointer items-start gap-3 px-4 py-3"
            >
              <input
                id="ocr-images"
                type="checkbox"
                checked={ocrImages}
                onChange={(e) => {
                  setOcrImages(e.target.checked)
                  if (e.target.checked) setExtractImages(true)
                }}
                className="mt-1 h-4 w-4 accent-accent"
              />
              <span className="text-sm">
                <span className="block font-medium">{t('options.ocrTitle')}</span>
                <span className="block text-fg-soft">
                  {t('options.ocrDesc')}
                </span>
                <span className="mt-1 block text-xs text-fg-soft">
                  {t('options.ocrEffect')}
                </span>
                {ocrImages && file && file.size > ASYNC_THRESHOLD_BYTES && (
                  <span className="mt-1 block text-xs text-warn">
                    {t('options.ocrHeavyWarn', { size: formatBytes(file.size) })}
                  </span>
                )}
                {ocrImages && (
                  <span className="mt-2 flex flex-wrap items-center gap-4" role="radiogroup" aria-label={t('options.scopeLabel')}>
                    {(['all', 'flowchart'] as const).map((s) => (
                      <label key={s} className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <input
                          type="radio"
                          name="ocr-scope"
                          value={s}
                          checked={ocrScope === s}
                          onChange={() => setOcrScope(s)}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                        {s === 'all' ? t('options.scopeAll') : t('options.scopeFlowchart')}
                      </label>
                    ))}
                  </span>
                )}
              </span>
            </label>
          </div>

          <div aria-live="polite" className="mt-4 min-h-6 text-sm">
            {error && (
              <p
                role="alert"
                className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger"
              >
                {error}
              </p>
            )}
            {pending && !error && (
              <p className="flex items-center gap-2 text-fg-soft">
                <span
                  aria-hidden
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent"
                />
                {progress ?? t('upload.pendingMsg')}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={pending || !file}
            aria-busy={pending}
            className="mt-2 w-full rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint"
          >
            {pending
              ? t('upload.submitBusy')
              : file
                ? t('upload.submitConvert')
                : t('upload.submitIdle')}
          </button>
        </form>
      </section>

      <section aria-labelledby="docs-heading" className="lg:col-span-5">
        <div className="flex items-end justify-between border-b border-line pb-3">
          <div>
            <p className="label">{t('library.step')}</p>
            <h2 id="docs-heading" className="mt-2 text-xl font-semibold tracking-tight">
              {t('library.title')}
              {docs && (
                <span className="ml-2 font-mono text-sm font-normal text-fg-soft">
                  {docs.length}
                </span>
              )}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void loadDocs()}
            disabled={refreshing}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-fg transition-colors hover:border-line-strong hover:bg-surface disabled:opacity-40"
          >
            {refreshing ? t('library.refreshing') : t('library.refresh')}
          </button>
        </div>
        <div aria-live="polite">
          {docs === null && !docsError && (
            <p className="py-8 text-sm text-fg-soft">{t('library.loading')}</p>
          )}
          {docsError && (
            <p
              role="alert"
              className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {docsError}
            </p>
          )}
          {docs !== null && docs.length === 0 && (
            <p className="py-8 text-sm text-fg-soft">
              {t('library.empty')}
            </p>
          )}
          {docs !== null && docs.length > 0 && (
            <ul className="divide-y divide-line">
              {docs.map((d) => (
                <li key={d.doc_id} className="group flex items-center">
                  <Link
                    to="/r/$docId"
                    params={{ docId: d.doc_id }}
                    className="min-w-0 flex-1 py-3.5 pr-4"
                  >
                    <span className="block truncate font-medium transition-colors group-hover:text-accent-text">
                      {d.filename ?? d.doc_id}
                    </span>
                    <span className="mt-1 block font-mono text-[11px] text-fg-soft">
                      {d.stats ? `${d.stats.pages} ${t('result.statPages').toLowerCase()} · ${d.stats.tables} ${t('result.statTables').toLowerCase()} · ` : ''}
                      {formatDate(d.created_at)}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void onDelete(d)}
                    disabled={deletingId === d.doc_id}
                    aria-label={`${t('common.delete')} ${d.filename ?? d.doc_id}`}
                    className="shrink-0 rounded-md px-2.5 py-1.5 text-sm text-fg-soft transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  >
                    {deletingId === d.doc_id ? t('library.deleting') : t('common.delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
