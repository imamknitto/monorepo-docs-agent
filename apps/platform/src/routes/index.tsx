import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { MAX_UPLOAD_BYTES, convertPdf } from '../lib/api'

export const Route = createFileRoute('/')({
  component: UploadPage,
})

function UploadPage() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [scanImages, setScanImages] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!file) {
      setError('Choose a PDF file first.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported in v1.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('File exceeds the 30 MB limit.')
      return
    }
    setPending(true)
    try {
      const result = await convertPdf(file, scanImages)
      void navigate({
        to: '/r/$docId',
        params: { docId: result.doc_id },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-labelledby="upload-heading">
      <h1 id="upload-heading" className="text-2xl font-bold">
        Convert a PDF to Markdown
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        Upload a PDF (max 30 MB). Tables and images are extracted when
        possible.
      </p>
      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-4 rounded-lg border bg-white p-6 shadow-sm"
      >
        <div>
          <label htmlFor="pdf-file" className="block font-medium">
            PDF file
          </label>
          <input
            id="pdf-file"
            type="file"
            accept="application/pdf,.pdf"
            aria-describedby="pdf-hint"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full text-sm focus-visible:outline-2 focus-visible:outline-blue-600"
          />
          <p id="pdf-hint" className="mt-1 text-sm text-zinc-500">
            PDF only, up to 30 MB.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="scan-images"
            type="checkbox"
            checked={scanImages}
            onChange={(e) => setScanImages(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="scan-images" className="text-sm">
            OCR scanned pages (slower, needs internet once for model
            download)
          </label>
        </div>
        <div aria-live="polite">
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {pending && <p className="text-sm">Converting…</p>}
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {pending ? 'Converting…' : 'Convert'}
        </button>
      </form>
    </section>
  )
}
