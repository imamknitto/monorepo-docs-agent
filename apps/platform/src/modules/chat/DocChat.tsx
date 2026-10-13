import { useMemo, useRef, useState } from 'react'
import {
  useChat,
  useSmoothStreamText,
  type EventTransport,
  type UIMessage,
} from '@anvia/react'
import {
  createHttpClientTransport,
  type ClientMetadata,
  type ClientStreamEvent,
  type ClientStreamRequest,
} from '@anvia/client'
import { ChatProvider, Composer, Message, Thread } from '@anvia/react-ui'
import '@anvia/react-ui/styles.css'
import { API_URL } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { fpHeader } from '../../lib/identity'
import { SendIcon } from '../../components/icons'
import { Spinner } from '../../components/ui/Spinner'
import { Alert } from '../../components/ui/Alert'
import {
  citationsSchema,
  clientEventToUIEvent,
  describeChatError,
  lastUserText,
  SUGGESTION_KEYS,
  type ChatClientData,
} from './protocol'
import { MessagePart, CopyMessage } from './message'
import { ScrollToBottom } from './ScrollToBottom'

/**
 * Headless chat bound to one backend session (remount per session via key).
 * Tool calls stream in as parts of the assistant message (via eventToUIEvent),
 * so they render inline and persist through history reloads.
 */
export function DocChat({
  docId,
  sessionId,
  initialHistory,
  indexing,
  gone,
}: {
  docId: string
  sessionId: string
  initialHistory: UIMessage[]
  indexing: boolean
  gone: boolean
}) {
  const [input, setInput] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const { t } = useI18n()

  // Partial tool-call input per part (tool input can arrive in deltas).
  const toolInputsRef = useRef(new Map<string, string>())

  const transport = useMemo<
    EventTransport<
      ClientStreamRequest,
      ClientStreamEvent<ClientMetadata, ChatClientData>
    >
  >(() => {
    const client = createHttpClientTransport<
      ClientStreamRequest,
      ChatClientData
    >({
      endpoint: `${API_URL}/v1/chat/${docId}/${sessionId}`,
      format: 'jsonl',
      headers: () => ({ 'content-type': 'application/json', ...fpHeader() }),
      body: ({ request }) => JSON.stringify(request),
      dataSchemas: { citations: citationsSchema },
    })
    // useChat speaks positional send() and maps each yielded event via
    // eventToUIEvent, so unwrap the stream envelopes here (no resume in use).
    return {
      async *send(request, options) {
        const frames = client.send({
          request,
          abortSignal: options?.signal,
          headers: options?.headers,
        })
        for await (const frame of frames) {
          if (frame.type === 'stream_event') yield frame.event
        }
      },
    }
  }, [docId, sessionId])

  const chat = useChat<
    ClientStreamRequest,
    ClientStreamEvent<ClientMetadata, ChatClientData>
  >({
    transport,
    initialMessages: initialHistory,
    createRequest: ({ uiMessages }): ClientStreamRequest => ({
      type: 'messages',
      messages: [{ role: 'user', content: lastUserText(uiMessages) }],
    }),
    eventToUIEvent: (event) =>
      clientEventToUIEvent(event, toolInputsRef.current),
    onEvent: (event) => {
      if (event.type === 'error') setStreamError(event.error.message)
    },
    onError: (err) => console.debug('[chat] transport error', err),
  })

  function beginTurn() {
    setStreamError(null)
  }

  // Animate the latest assistant answer while it streams: the model route
  // often delivers text in a single large delta, so reveal it gradually.
  // Only smooth when the assistant answer is the last message — between turns
  // (last message still the user's) the previous answer must not re-animate.
  const streaming = chat.status === 'streaming'
  const lastMessage = chat.messages.at(-1)
  const smoothTarget =
    streaming &&
    lastMessage?.role === 'assistant' &&
    lastMessage.parts.some((p) => p.type === 'text' && p.text)
      ? lastMessage
      : undefined
  const smoothFullText = smoothTarget
    ? smoothTarget.parts
        .flatMap((p) => (p.type === 'text' ? [p.text] : []))
        .join('\n')
    : ''
  const smooth = useSmoothStreamText(smoothFullText, {
    isStreaming: streaming,
    preset: 'balanced',
    // Single deltas can carry a whole answer — still animate them.
    largeAppendChars: 2_000,
  })
  const smoothedMessageId =
    smoothTarget && smooth.text !== smoothFullText
      ? smoothTarget.id
      : undefined

  const unavailable = indexing || gone

  return (
    <ChatProvider controller={chat}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Thread.Root className="relative flex min-h-0 flex-1 flex-col">
          <Thread.Viewport
            autoScroll
            className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
          >
            <Thread.Empty className="py-6 text-sm text-fg-soft">
              {gone ? (
                t('chat.goneEmpty')
              ) : indexing ? (
                t('chat.indexingEmpty')
              ) : (
                <div>
                  <p className="font-medium text-fg">{t('chat.emptyTitle')}</p>
                  <ul className="mt-3 space-y-1.5">
                    {SUGGESTION_KEYS.map((k) => (
                      <li key={k}>
                        <button
                          type="button"
                          onClick={() => {
                            beginTurn()
                            void chat.sendMessage(t(k))
                          }}
                          className="w-full rounded-md border border-line px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg"
                        >
                          {t(k)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Thread.Empty>
            <Thread.Messages className="space-y-4">
              {(message) => {
                const smoothing = message.id === smoothedMessageId
                const firstTextId = smoothing
                  ? message.parts.find((p) => p.type === 'text')?.id
                  : undefined
                return (
                  <Message.Root
                    className={`group text-sm ${
                      message.role === 'user'
                        ? 'ml-auto w-fit max-w-[92%] rounded-md border border-line bg-surface-2 px-3.5 py-2.5'
                        : 'border-l-2 border-accent pl-3.5'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="label">
                        {message.role === 'user'
                          ? t('chat.you')
                          : t('chat.assistant')}
                      </p>
                      {message.role !== 'user' && <CopyMessage />}
                    </div>
                    <Message.Content>
                      <Message.Parts>
                        {() => (
                          <MessagePart
                            role={message.role}
                            smoothedText={smoothing ? smooth.text : undefined}
                            firstTextId={firstTextId}
                          />
                        )}
                      </Message.Parts>
                    </Message.Content>
                  </Message.Root>
                )
              }}
            </Thread.Messages>
            <Thread.Loading
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 py-1 font-mono text-xs text-fg-soft"
            >
              <Spinner className="h-3.5 w-3.5" />
              {t('chat.generating')}
            </Thread.Loading>
            <Thread.Error>
              {(error) => (
                <Alert className="px-3 py-2 text-sm">
                  {describeChatError(error)}
                </Alert>
              )}
            </Thread.Error>
          </Thread.Viewport>
          <ScrollToBottom />
        </Thread.Root>

        {streamError && (
          <Alert className="shrink-0 px-3 py-2 text-sm">{streamError}</Alert>
        )}

        {unavailable ? (
          <p className="shrink-0 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-fg-soft">
            {gone ? t('chat.docGone') : t('chat.waitingIndex')}
          </p>
        ) : (
          <Composer.Root
            className="flex shrink-0 items-end gap-2"
            input={input}
            onInputChange={setInput}
            submitMessage={async ({ input: text, chat: controller, clear }) => {
              beginTurn()
              clear()
              await controller.sendMessage(text)
            }}
          >
            <Composer.TextareaInput
              minRows={2}
              maxRows={6}
              autoResize
              placeholder={t('chat.placeholder')}
              className="min-w-0 flex-1 resize-none rounded-md border border-line-strong bg-bg px-3 py-2 text-sm placeholder:text-fg-faint"
            />
            {chat.status === 'streaming' ? (
              <Composer.Stop className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2">
                {t('chat.stop')}
              </Composer.Stop>
            ) : (
              <Composer.Submit className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40">
                {t('chat.send')} <SendIcon />
              </Composer.Submit>
            )}
          </Composer.Root>
        )}
      </div>
    </ChatProvider>
  )
}
