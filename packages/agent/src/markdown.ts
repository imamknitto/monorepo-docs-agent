import type { Citation, RetrievedPage } from './types.js'

const PAGE_HEADING_RE = /^## Page (\d+)\s*$/m

/** Drop the converter's trailing `---` page separator from a chunk. */
function stripSeparator(text: string): string {
  return text.replace(/\s*---\s*$/,'').trim()
}

/**
 * Split converter markdown into pages. The Python service emits
 * `## Page N` headings separated by `---`; be lenient because older
 * artifacts may only have one of the two markers.
 */
export function splitMarkdownPages(markdown: string): RetrievedPage[] {
  const normalized = markdown.replace(/\r\n/g, '\n')
  if (PAGE_HEADING_RE.test(normalized)) {
    const parts = normalized.split(/^## Page (\d+)\s*$/m)
    // split with capture group: [before, n1, body1, n2, body2, ...]
    const pages: RetrievedPage[] = []
    for (let i = 1; i < parts.length; i += 2) {
      const pageNumber = Number(parts[i])
      const body = stripSeparator(parts[i + 1] ?? '')
      const content = `## Page ${parts[i]}${body ? `\n${body}` : ''}`.trim()
      if (content) pages.push({ pageNumber, content })
    }
    if (pages.length > 0) return pages
  }
  const chunks = normalized
    .split(/^\s*---\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
  if (chunks.length > 1) {
    return chunks.map((content, i) => ({ pageNumber: i + 1, content }))
  }
  const trimmed = normalized.trim()
  return trimmed ? [{ pageNumber: 1, content: trimmed }] : []
}

/** Rewrite converter-relative /public URLs to absolute gateway URLs. */
export function absolutizePublicUrls(markdown: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return markdown.replace(
    /(\]\()(\/public\/[^)\s]+)(\))/g,
    (_m, open: string, path: string, close: string) => `${open}${base}${path}${close}`,
  )
}

export function excerptOf(content: string, maxLen = 280): string {
  const oneLine = content
    .replace(/^## Page \d+\s*/m, '')
    .replace(/!\[.*?\]\(.*?\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine
}

export function toCitations(pages: RetrievedPage[]): Citation[] {
  return pages.map((p) => ({ page: p.pageNumber, excerpt: excerptOf(p.content) }))
}

const STOP = new Set(
  'dan yang di itu untuk dari pada dengan adalah sebagai dalam untuk ini itu atau juga akan dapat tidak ada oleh karena pada ke sebuah sebagai hal'.split(
    ' ',
  ),
)

export function keywordsOf(question: string, max = 8): string[] {
  return (
    question
      .toLowerCase()
      .replace(/[^a-z0-9\u00c0-\u024f\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .slice(0, max)
  )
}

/** Deterministic keyword retrieval fallback (used when Qdrant is absent). */
export function retrieveKeyword(
  pages: RetrievedPage[],
  question: string,
  topK = 4,
): RetrievedPage[] {
  const keys = keywordsOf(question)
  if (keys.length === 0) return pages.slice(0, topK)
  const scored = pages.map((p) => {
    const hay = p.content.toLowerCase()
    let score = 0
    for (const k of keys) if (hay.includes(k)) score += 1
    return { p, score }
  })
  scored.sort((a, b) => b.score - a.score || a.p.pageNumber - b.p.pageNumber)
  const hit = scored.filter((s) => s.score > 0).map((s) => s.p)
  return (hit.length > 0 ? hit : pages).slice(0, topK)
}

export function buildAnswerPrompt(question: string, pages: RetrievedPage[]): string {
  const context = pages
    .map((p) => `<page number="${p.pageNumber}">\n${p.content}\n</page>`)
    .join('\n\n')
  return [
    'Jawab pertanyaan hanya berdasarkan konteks dokumen di bawah.',
    'Sertakan nomor halaman yang mendukung jawaban bila relevan.',
    'Bahasa jawaban mengikuti bahasa pertanyaan (default Bahasa Indonesia).',
    '',
    `<question>${question}</question>`,
    '',
    '<context>',
    context,
    '</context>',
  ].join('\n')
}

export const DOC_INSTRUCTIONS =
  'You are a document QA assistant. Answer only from the provided <context> pages. ' +
  'If the answer is not in the context, say so explicitly instead of inventing facts.'
