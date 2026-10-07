import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { API_URL, absoluteUrl, fetchMarkdown } from '../lib/api'

export const Route = createFileRoute('/r/$docId')({
  component: ResultPage,
})

function ResultPage() {
  const { docId } = Route.useParams()
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let cancelled = false
    setMarkdown(null)
    setError(null)
    fetchMarkdown(docId)
      .then((md) => {
        if (!cancelled) {
          setMarkdown(md)
          headingRef.current?.focus()
        }
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : 'Could not load the document.',
          )
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  async function copyMarkdown() {
    if (!markdown) return
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section aria-labelledby="result-heading" aria-busy={markdown === null && !error}>
      <h1
        id="result-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold focus:outline-none"
      >
        Conversion result
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Document <code>{docId}</code>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`${API_URL}/download/${docId}`}
          className="rounded border bg-white px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          Download .md
        </a>
        <a
          href={absoluteUrl(`/public/${docId}/doc.md`)}
          target="_blank"
          rel="noreferrer"
          className="rounded border bg-white px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          Open raw
        </a>
        <button
          type="button"
          onClick={copyMarkdown}
          disabled={!markdown}
          className="rounded border bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          Copy markdown
        </button>
      </div>
      <div aria-live="polite" className="mt-2 text-sm">
        {copied && <p>Copied to clipboard.</p>}
        {error && (
          <p role="alert" className="text-red-700">
            {error}{' '}
            <a href="/" className="underline">
              Convert another file
            </a>
          </p>
        )}
        {markdown === null && !error && <p>Loading markdown…</p>}
      </div>
      {markdown !== null && (
        <article className="prose mt-6 max-w-none rounded-lg border bg-white p-6 shadow-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
            urlTransform={(url) => absoluteUrl(url)}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      )}
    </section>
  )
}
