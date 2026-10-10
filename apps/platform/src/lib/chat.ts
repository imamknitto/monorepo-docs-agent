import type { UIMessage } from '@anvia/react'
import { API_URL } from './api'
import { fpHeader, getOrCreateFpId } from './identity'

export interface Citation {
  page: number
  excerpt: string
}

export type ChatEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

export interface DocStatus {
  docId: string
  /** False when the document row is gone (deleted or auto-expired by sweep). */
  found: boolean
  indexed: boolean
  pages: number
  summary: string | null
}

/** sessionId is canonical: doc:<docId>:s:<rand> (validated server-side). */
export function newSessionId(docId: string): string {
  const rand = getOrCreateFpId().slice(0, 8) + Math.random().toString(36).slice(2, 18)
  return `doc:${docId}:s:${rand.replace(/[^A-Za-z0-9_-]/g, '')}`
}

function sessionsKey(docId: string): string {
  return `docs-agent:sessions:${getOrCreateFpId()}:${docId}`
}

export function listSessions(docId: string): string[] {
  try {
    const raw = localStorage.getItem(sessionsKey(docId))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export function rememberSession(docId: string, sessionId: string): void {
  const next = [sessionId, ...listSessions(docId).filter((s) => s !== sessionId)].slice(0, 20)
  try {
    localStorage.setItem(sessionsKey(docId), JSON.stringify(next))
  } catch {
    /* storage blocked */
  }
}

export function forgetSession(docId: string, sessionId: string): void {
  try {
    localStorage.setItem(
      sessionsKey(docId),
      JSON.stringify(listSessions(docId).filter((s) => s !== sessionId)),
    )
  } catch {
    /* storage blocked */
  }
}

/** Drop the whole session list of one document (e.g. after the document is deleted). */
export function forgetAllDocSessions(docId: string): void {
  try {
    localStorage.removeItem(sessionsKey(docId))
  } catch {
    /* storage blocked */
  }
}

export async function fetchStatus(docId: string): Promise<DocStatus> {
  const res = await fetch(`${API_URL}/v1/status/${docId}`)
  if (!res.ok) throw new Error(`Could not load status (HTTP ${res.status}).`)
  return (await res.json()) as DocStatus
}

export async function fetchHistory(docId: string, sessionId: string): Promise<UIMessage[]> {
  const res = await fetch(`${API_URL}/v1/chat/${docId}/${sessionId}`, {
    headers: fpHeader(),
  })
  if (res.status === 503) return []
  if (!res.ok) throw new Error(`Could not load history (HTTP ${res.status}).`)
  const body = (await res.json()) as { messages?: UIMessage[] }
  return body.messages ?? []
}

export async function deleteSession(docId: string, sessionId: string): Promise<void> {
  await fetch(`${API_URL}/v1/chat/${docId}/${sessionId}`, {
    method: 'DELETE',
    headers: fpHeader(),
  })
  forgetSession(docId, sessionId)
}

export async function* streamChat(
  docId: string,
  sessionId: string,
  question: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${API_URL}/v1/chat/${docId}/${sessionId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...fpHeader() },
    body: JSON.stringify({ question }),
    signal,
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(detail || `Chat failed (HTTP ${res.status}).`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        yield JSON.parse(trimmed) as ChatEvent
      } catch {
        /* ignore malformed line */
      }
    }
  }
  const tail = buffer.trim()
  if (tail) {
    try {
      yield JSON.parse(tail) as ChatEvent
    } catch {
      /* ignore */
    }
  }
}
