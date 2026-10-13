import type { UIMessage } from '@anvia/react'
import { API_URL } from '../../lib/api'
import { fpHeader } from '../../lib/identity'
import { forgetSession } from './sessions'

export interface DocStatus {
  docId: string
  /** False when the document row is gone (deleted or auto-expired by sweep). */
  found: boolean
  indexed: boolean
  pages: number
  summary: string | null
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
