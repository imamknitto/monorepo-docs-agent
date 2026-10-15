import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useI18n } from '../../lib/i18n'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { createWorkspace, listWorkspaces, type Workspace } from './api'
import { listDocuments, type DocSummary } from '../library/api'

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export function DashboardPage() {
  const { t } = useI18n()
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    setError(null)
    try {
      const [ws, ds] = await Promise.all([listWorkspaces(), listDocuments()])
      setWorkspaces(ws)
      setDocs(ds)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'))
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    setCreating(true)
    try {
      const ws = await createWorkspace(name.trim())
      setName('')
      setWorkspaces((prev) => (prev ? [ws, ...prev] : [ws]))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="label">{t('dashboard.step')}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {t('dashboard.title')}
        </h1>
        <p className="mt-2 max-w-lg text-sm text-fg-soft">
          {t('dashboard.subtitle')}
        </p>
      </header>

      {error && <Alert className="px-3 py-2 text-sm">{error}</Alert>}

      <form
        onSubmit={onCreate}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="label">{t('dashboard.newWorkspace')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('dashboard.namePlaceholder')}
            maxLength={120}
            className="rounded-md border border-line-strong bg-bg px-3 py-2 text-sm"
          />
        </label>
        <Button
          type="submit"
          variant="accent"
          disabled={creating || !name.trim()}
        >
          {creating ? t('dashboard.creating') : t('dashboard.create')}
        </Button>
      </form>

      <section aria-labelledby="ws-list-heading">
        <h2 id="ws-list-heading" className="sr-only">
          {t('dashboard.title')}
        </h2>
        {workspaces === null ? (
          <p className="flex items-center gap-2 py-8 text-sm text-fg-soft">
            <Spinner className="h-4 w-4" /> {t('ws.loading')}
          </p>
        ) : workspaces.length === 0 ? (
          <p className="py-8 text-sm text-fg-soft">{t('dashboard.empty')}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link
                  to="/w/$workspaceId"
                  params={{ workspaceId: w.id }}
                  className="block rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  <span className="block truncate text-base font-semibold">
                    {w.name}
                  </span>
                  <span className="mt-1 block font-mono text-xs text-fg-soft">
                    {t('dashboard.docCount', { n: w.documentCount ?? 0 })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <h2
          id="recent-heading"
          className="border-b border-line pb-2 text-lg font-semibold tracking-tight"
        >
          {t('dashboard.recent')}
        </h2>
        {docs === null ? null : docs.length === 0 ? (
          <p className="py-6 text-sm text-fg-soft">{t('dashboard.noDocs')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {docs.slice(0, 10).map((d) => (
              <li key={d.doc_id}>
                <Link
                  to="/w/$workspaceId/d/$docId"
                  params={{ workspaceId: d.workspace_id ?? '', docId: d.doc_id }}
                  className="flex items-center justify-between gap-3 py-3 text-sm transition-colors hover:text-accent-text"
                >
                  <span className="min-w-0 truncate font-medium">
                    {d.filename ?? d.doc_id}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-fg-soft">
                    {formatDate(d.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
