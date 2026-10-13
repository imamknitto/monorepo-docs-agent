import { Hono } from 'hono'
import { z } from 'zod'
import {
  customAgentEventsToClientStream,
  parseClientStreamRequest,
  type AgentClientStreamContext,
  type ClientMetadata,
} from '@anvia/client'
import type { AgentStreamEvent } from '@anvia/core'
import { createClientStreamResponse } from '@anvia/server'
import {
  IndexingError,
  NotConfiguredError,
  toCitations,
} from '@halodocs/agent'
import { DOC_ID_RE, USER_ID_RE, parseSessionId } from '../../config.js'
import { getDocStatus } from '../documents/store.js'
import {
  clearHistory,
  lastUserText,
  loadUiHistory,
  prepareAnswer,
  retrievePages,
  streamAnswer,
  toClientError,
} from './service.js'

const chatRoutes = new Hono()

function readUserId(c: {
  req: { header: (k: string) => string | undefined }
}): string | null {
  const raw = c.req.header('x-user-id')?.trim()
  if (!raw || !USER_ID_RE.test(raw)) return null
  return raw
}

/** Wire shape of one source citation (plain type so it stays JSON-assignable). */
type ChatCitation = { page: number; excerpt: string }

/** Custom channel event: retrieved sources, sent ahead of the agent run. */
type ChatChannelEvent = { type: 'citations'; citations: ChatCitation[] }

/** Client-visible data channels of this route (one per custom event). */
type ChatClientData = {
  citations: ChatCitation[]
}

const citationsSchema = z.array(z.object({ page: z.number(), excerpt: z.string() }))

/** Project one channel event into the client protocol (unknown events are dropped). */
function mapChatChannelEvent(
  event: ChatChannelEvent,
  context: AgentClientStreamContext,
) {
  if (event.type !== 'citations') return undefined
  return {
    runId: context.runId,
    type: 'data' as const,
    name: 'citations' as const,
    data: event.citations,
  }
}

/** Lazily retrieved citations followed by the live agent run. */
async function* chatChannel(
  docId: string,
  sessionId: string,
  userId: string,
  question: string,
  summary: string | null,
): AsyncGenerator<AgentStreamEvent<unknown, unknown> | ChatChannelEvent> {
  const { pages, prompt, agent } = await prepareAnswer(docId, question, summary)
  yield { type: 'citations', citations: toCitations(pages) }
  yield* agent.stream({ prompt, session: { sessionId, userId, metadata: { docId } } })
}

chatRoutes.get('/chat/:docId/:sessionId', async (c) => {
  const docId = c.req.param('docId')
  const sessionId = c.req.param('sessionId')
  const userId = readUserId(c)
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  const sess = parseSessionId(docId, sessionId)
  if (!sess.ok) return c.json({ detail: sess.detail }, 400)
  if (!userId) return c.json({ detail: 'Missing or invalid x-user-id header.' }, 400)
  try {
    const messages = await loadUiHistory(sessionId, userId)
    return c.json({ sessionId, messages })
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return c.json({ detail: err.message }, 503)
    }
    throw err
  }
})

chatRoutes.delete('/chat/:docId/:sessionId', async (c) => {
  const docId = c.req.param('docId')
  const sessionId = c.req.param('sessionId')
  const userId = readUserId(c)
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  const sess = parseSessionId(docId, sessionId)
  if (!sess.ok) return c.json({ detail: sess.detail }, 400)
  if (!userId) return c.json({ detail: 'Missing or invalid x-user-id header.' }, 400)
  try {
    await clearHistory(sessionId, userId)
    return c.json({ sessionId, cleared: true })
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return c.json({ detail: err.message }, 503)
    }
    throw err
  }
})

chatRoutes.post('/chat/:docId/:sessionId', async (c) => {
  const docId = c.req.param('docId')
  const sessionId = c.req.param('sessionId')
  const userId = readUserId(c)
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  const sess = parseSessionId(docId, sessionId)
  if (!sess.ok) return c.json({ detail: sess.detail }, 400)
  if (!userId) return c.json({ detail: 'Missing or invalid x-user-id header.' }, 400)

  let question: string
  try {
    const parsed = parseClientStreamRequest(await c.req.json().catch(() => null))
    if (parsed.type !== 'messages') {
      return c.json({ detail: 'Only message streams are supported.' }, 400)
    }
    question = lastUserText(parsed.messages)
  } catch {
    return c.json({ detail: 'Invalid stream request.' }, 422)
  }
  if (!question) return c.json({ detail: 'Field "question" is required.' }, 422)
  if (question.length > 2000) {
    return c.json({ detail: 'Field "question" exceeds 2000 characters.' }, 422)
  }

  const status = await getDocStatus(docId)
  if (!status.found || !status.isProcessed) {
    return c.json({ detail: 'Document is still indexing, try again shortly.' }, 503)
  }

  return createClientStreamResponse<ClientMetadata, ChatClientData>({
    events: customAgentEventsToClientStream<ChatChannelEvent, ClientMetadata, ChatClientData>({
      events: chatChannel(docId, sessionId, userId, question, status.summary),
      mapCustomEvent: mapChatChannelEvent,
      mapError: (error) => {
        console.error(
          `[chat:answer] doc=${docId} session=${sessionId} stream error`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        )
        return toClientError(error)
      },
    }),
    format: 'jsonl',
    headers: { 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
    dataSchemas: { citations: citationsSchema },
  })
})

chatRoutes.post('/ask', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    docId?: unknown
    question?: unknown
    sessionId?: unknown
  } | null
  const docId = typeof body?.docId === 'string' ? body.docId : ''
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  const sessionId =
    typeof body?.sessionId === 'string' && body.sessionId
      ? body.sessionId
      : `doc:${docId}:s:${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
  const userId = readUserId(c)
  if (!DOC_ID_RE.test(docId) || !question) {
    return c.json({ detail: 'Fields "docId" and "question" are required.' }, 422)
  }
  if (question.length > 2000) {
    return c.json({ detail: 'Field "question" exceeds 2000 characters.' }, 422)
  }
  if (!userId) return c.json({ detail: 'Missing or invalid x-user-id header.' }, 400)

  const status = await getDocStatus(docId)
  if (!status.found || !status.isProcessed) {
    return c.json({ detail: 'Document is still indexing, try again shortly.' }, 503)
  }

  try {
    const gen = streamAnswer(docId, sessionId, userId, question, status.summary)
    let answer = ''
    let citations = toCitations(await retrievePages(docId, question))
    for await (const event of gen) {
      if (event.type === 'text_delta') answer += event.delta
      else if (event.type === 'citations') citations = event.citations
      else if (event.type === 'error') return c.json({ detail: event.message }, 502)
    }
    return c.json({ answer, citations, sessionId })
  } catch (err) {
    if (err instanceof NotConfiguredError) return c.json({ detail: err.message }, 503)
    if (err instanceof IndexingError) return c.json({ detail: err.message }, 503)
    return c.json({ detail: err instanceof Error ? err.message : 'ask failed' }, 502)
  }
})

export { chatRoutes }