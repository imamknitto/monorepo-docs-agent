import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  createFetchTransport,
  EventStreamHttpError,
  useChat,
  type UIStreamEvent,
  type UIMessage,
} from '@anvia/react'
import {
  ChatProvider,
  Composer,
  Message,
  Thread,
  useMessage,
  useMessagePart,
  useThread,
} from '@anvia/react-ui'
import '@anvia/react-ui/styles.css'
import {
  deleteSession,
  fetchHistory,
  fetchStatus,
  listSessions,
  newSessionId,
  rememberSession,
  type DocStatus,
} from '../lib/chat'
import { fpHeader, getOrCreateFpId, resetFpId } from '../lib/identity'
import { API_URL } from '../lib/api'
import { t, useI18n } from '../lib/i18n'
import { useConfirm } from './ConfirmDialog'
import { ArrowLeftIcon, CheckIcon, CopyIcon, SendIcon, WrenchIcon } from './icons'

/** Wire protocol of our backend (POST /v1/chat/:docId/:sessionId → NDJSON). */
type ChatWireRequest = { question: string }
export interface WireToolCall {
  callId: string
  name: string
  state: 'running' | 'done' | 'error'
  input?: string
  output?: string
}
type ChatWireEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'citations'; citations: unknown[] }
  | { type: 'tool'; tool: WireToolCall }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

const SUGGESTION_KEYS = ['chat.sug1', 'chat.sug2', 'chat.sug3'] as const

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'user') continue
    const text = m.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

function describeChatError(error: unknown): string {
  if (error instanceof EventStreamHttpError) {
    try {
      const body = JSON.parse(error.body) as { detail?: unknown }
      if (typeof body.detail === 'string' && body.detail) return body.detail
    } catch {
      /* fall through to generic message */
    }
    return t('chat.errChatHttp', { status: error.response.status })
  }
  return error instanceof Error ? error.message : t('chat.errChat')
}

const alertClass =
  'rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger'

const ghostButton =
  'rounded-md border border-line px-3 py-2 text-sm font-medium transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-40'

function jsonText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** One tool call, rendered inline inside its assistant message. */
function ToolCall() {
  const { part } = useMessagePart()
  const { t } = useI18n()
  if (part.type !== 'tool') return null
  const running = part.state === 'input-streaming' || part.state === 'input-available'
  const failed = part.state === 'error'
  const hasDetail = part.input !== undefined || part.output !== undefined || part.error !== undefined

  return (
    <details className="my-1.5 overflow-hidden rounded-md border border-line bg-bg text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 font-mono text-[11px] text-fg-soft">
        <WrenchIcon className={`shrink-0 ${failed ? 'text-danger' : 'text-accent-text'}`} />
        <span className="truncate font-medium text-fg">{part.toolName}</span>
        {running ? (
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-accent"
            />
            {t('chat.running')}
          </span>
        ) : (
          <span className={`shrink-0 ${failed ? 'text-danger' : ''}`}>
            {failed ? t('chat.toolError') : t('chat.done')}
          </span>
        )}
      </summary>
      {hasDetail && (
        <div className="space-y-2 border-t border-line px-2.5 py-2">
          {part.input !== undefined && (
            <div>
              <p className="label mb-1">{t('chat.input')}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                {jsonText(part.input)}
              </pre>
            </div>
          )}
          {part.output !== undefined && (
            <div>
              <p className="label mb-1">{t('chat.output')}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                {jsonText(part.output)}
              </pre>
            </div>
          )}
          {part.error !== undefined && (
            <p role="alert" className="text-danger">
              {part.error.message}
            </p>
          )}
        </div>
      )}
    </details>
  )
}

/** Renders the current message part (text, reasoning or tool call). */
function MessagePart({ role }: { role: UIMessage['role'] }) {
  const { part } = useMessagePart()
  const { t } = useI18n()

  if (part.type === 'text') {
    return role === 'user' ? (
      <span className="whitespace-pre-wrap">
        <Message.Text />
      </span>
    ) : (
      <div className="chat-md">
        <Message.Markdown />
      </div>
    )
  }

  if (part.type === 'reasoning') {
    return (
      <details className="my-2 rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg-soft">
        <summary className="cursor-pointer select-none font-medium text-fg">{t('chat.thinking')}</summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-sans">{part.text}</pre>
      </details>
    )
  }

  if (part.type === 'tool') return <ToolCall />

  return null
}

function CopyMessage() {
  const { message } = useMessage()
  const [copied, setCopied] = useState(false)
  const { t } = useI18n()
  async function copy() {
    const text = message.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? t('chat.copied') : t('chat.copyAnswer')}
      title={copied ? t('chat.copied') : t('chat.copyAnswer')}
      className="text-fg-faint opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

function ScrollToBottom() {
  const { atBottom, scrollToBottom } = useThread()
  const { t } = useI18n()
  if (atBottom) return null
  return (
    <button
      type="button"
      onClick={() => scrollToBottom('smooth')}
      aria-label={t('chat.scrollLatest')}
      className="absolute bottom-2 right-3 flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-surface text-fg-soft shadow-sm transition-colors hover:text-fg"
    >
      <ArrowLeftIcon className="-rotate-90" />
    </button>
  )
}

function SessionSelect({
  sessions,
  active,
  onChange,
  onNew,
  onDelete,
  disabled,
}: {
  sessions: string[]
  active: string
  onChange: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const activeIdx = sessions.indexOf(active)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open ])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled ])

  function choose(id: string) {
    onChange(id)
    setOpen(false)
    btnRef.current?.focus()
  }

  function moveFocus(dir: 1 | -1) {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    if (!items || items.length === 0) return
    const cur = Array.from(items).indexOf(document.activeElement as HTMLButtonElement)
    const next = (cur + dir + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div ref={rootRef} className="relative min-w-0 flex-1">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (!open) {
                setOpen(true)
                window.setTimeout(() => moveFocus(1), 0)
              } else {
                moveFocus(e.key === 'ArrowDown' ? 1 : -1)
              }
            }
          }}
          disabled={disabled || sessions.length === 0}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('chat.sessionLabel')}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-bg px-3 py-2 text-sm disabled:opacity-50"
        >
          <span className="truncate">
            {activeIdx >= 0 ? t('chat.sessionName', { n: sessions.length - activeIdx }) : '—'}
          </span>
          <span aria-hidden className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
            ▾
          </span>
        </button>
        {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('chat.sessionLabel')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                moveFocus(1)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                moveFocus(-1)
              }
            }}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-line-strong bg-surface py-1 shadow-lg"
          >
            {sessions.map((s, i) => (
              <button
                key={s}
                type="button"
                role="menuitemradio"
                aria-checked={s === active}
                onClick={() => choose(s)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 ${
                  s === active ? 'text-fg' : 'text-fg-soft'
                }`}
              >
                <span className="truncate">{t('chat.sessionName', { n: sessions.length - i })}</span>
                {s === active && <CheckIcon />}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={onNew} disabled={disabled} className={ghostButton}>
        {t('chat.new')}
      </button>
      <button
        type="button"
        onClick={() => onDelete(active)}
        disabled={disabled}
        className={`${ghostButton} text-danger hover:border-danger/50 hover:bg-danger/10`}
      >
        {t('chat.delete')}
      </button>
    </div>
  )
}

/**
 * Headless chat bound to one backend session (remount per session via key).
 * Tool calls stream in as parts of the assistant message (via eventToUIEvent),
 * so they render inline and persist through history reloads.
 */
function DocChat({
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

  // Streaming assistant message id + text-part sequence for the current turn.
  const messageIdRef = useRef('')
  const textSeqRef = useRef(0)

  const transport = useMemo(
    () =>
      createFetchTransport<ChatWireRequest, ChatWireEvent>({
        endpoint: `${API_URL}/v1/chat/${docId}/${sessionId}`,
        format: 'jsonl',
        headers: () => ({ 'content-type': 'application/json', ...fpHeader() }),
        body: (req) => JSON.stringify(req),
      }),
    [docId, sessionId],
  )

  const chat = useChat<ChatWireRequest, ChatWireEvent>({
    transport,
    initialMessages: initialHistory,
    createRequest: ({ uiMessages }) => ({ question: lastUserText(uiMessages) }),
    eventToUIEvent: (event): UIStreamEvent | undefined => {
      if (event.type === 'text_delta') {
        return {
          type: 'text_delta',
          messageId: messageIdRef.current,
          partId: `${messageIdRef.current}_text_${textSeqRef.current}`,
          delta: event.delta,
        }
      }
      if (event.type === 'tool') {
        // Any text after a tool call starts a new part so ordering stays correct.
        textSeqRef.current += 1
        const t = event.tool
        return {
          type: 'tool_update',
          messageId: messageIdRef.current,
          partId: `tool_${t.callId}`,
          part: {
            id: `tool_${t.callId}`,
            type: 'tool',
            toolName: t.name,
            toolCallId: t.callId,
            callId: t.callId,
            state:
              t.state === 'done'
                ? 'output-available'
                : t.state === 'error'
                  ? 'error'
                  : 'input-available',
            ...(t.input !== undefined ? { input: t.input } : {}),
            ...(t.output !== undefined ? { output: t.output } : {}),
          },
        }
      }
      return undefined
    },
    onEvent: (event) => {
      if (event.type === 'error') setStreamError(event.message)
    },
    onError: (err) => console.debug('[chat] transport error', err),
  })

  function beginTurn() {
    messageIdRef.current = `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    textSeqRef.current = 0
    setStreamError(null)
  }

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
              {(message) => (
                <Message.Root
                  className={`group text-sm ${
                    message.role === 'user'
                      ? 'ml-auto w-fit max-w-[92%] rounded-md border border-line bg-surface-2 px-3.5 py-2.5'
                      : 'border-l-2 border-accent pl-3.5'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="label">{message.role === 'user' ? t('chat.you') : t('chat.assistant')}</p>
                    {message.role !== 'user' && <CopyMessage />}
                  </div>
                  <Message.Content>
                    <Message.Parts>{() => <MessagePart role={message.role} />}</Message.Parts>
                  </Message.Content>
                </Message.Root>
              )}
            </Thread.Messages>
            <Thread.Loading
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 py-1 font-mono text-xs text-fg-soft"
            >
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent"
              />
              {t('chat.generating')}
            </Thread.Loading>
            <Thread.Error>
              {(error) => (
                <p role="alert" className={alertClass}>
                  {describeChatError(error)}
                </p>
              )}
            </Thread.Error>
          </Thread.Viewport>
          <ScrollToBottom />
        </Thread.Root>

        {streamError && (
          <p role="alert" className={`shrink-0 ${alertClass}`}>
            {streamError}
          </p>
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

export function ChatPanel({ docId, className = '' }: { docId: string; className?: string }) {
  const [status, setStatus] = useState<DocStatus | null>(null)
  const [sessions, setSessions] = useState<string[]>([])
  const [active, setActive] = useState<string>('')
  const [history, setHistory] = useState<UIMessage[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [polls, setPolls] = useState(0)
  const [debug, setDebug] = useState<unknown>(null)
  const [debugLoading, setDebugLoading] = useState(false)
  const confirm = useConfirm()
  const { t } = useI18n()

  async function checkDebug() {
    setDebugLoading(true)
    try {
      const res = await fetch(`${API_URL}/v1/debug/${docId}`)
      const body = (await res.json().catch(() => null)) as unknown
      setDebug(body)
      console.debug('[chat] index debug', body)
    } catch (err) {
      setDebug({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      setDebugLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setStatus(null)
    setError(null)
    const known = listSessions(docId)
    const initial = known[0] ?? newSessionId(docId)
    rememberSession(docId, initial)
    setSessions([initial, ...known.filter((s) => s !== initial)])
    setActive(initial)

    async function poll() {
      try {
        const s = await fetchStatus(docId)
        if (cancelled) return
        setStatus(s)
        setPolls((p) => p + 1)
        console.debug('[chat] index status', s)
        if (s.found && !s.indexed) window.setTimeout(poll, 3000)
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : t('chat.errStatus')
          console.debug('[chat] index status failed', msg)
          setError(msg)
        }
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [docId])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setHistory([])
    setHistoryReady(false)
    setError(null)
    fetchHistory(docId, active)
      .then((msgs) => {
        if (cancelled) return
        setHistory(msgs)
        setHistoryReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('chat.errHistory'))
        setHistoryReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [docId, active])

  function onNew() {
    const id = newSessionId(docId)
    rememberSession(docId, id)
    setSessions((prev) => [id, ...prev])
    setActive(id)
  }

  async function onDelete(id: string) {
    if (!id) return
    const ok = await confirm({
      title: t('chat.deleteChatTitle'),
      description: t('chat.deleteChatDesc'),
    })
    if (!ok) return
    void deleteSession(docId, id).catch(() => {
      /* best-effort */
    })
    const remaining = sessions.filter((s) => s !== id)
    const next = remaining[0] ?? newSessionId(docId)
    rememberSession(docId, next)
    setSessions([next, ...remaining.filter((s) => s !== next)])
    setActive(next)
  }

  async function onResetIdentity() {
    const ok = await confirm({
      title: t('chat.resetTitle'),
      description: t('chat.resetDesc'),
      confirmLabel: t('chat.resetConfirm'),
    })
    if (!ok) return
    resetFpId()
    window.location.reload()
  }

  const gone = status !== null && !status.found
  const indexing = status !== null && status.found && !status.indexed

  return (
    <section
      aria-labelledby="chat-heading"
      className={`flex flex-col overflow-hidden rounded-lg border border-line bg-surface ${className}`}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h2 id="chat-heading" className="text-base font-semibold tracking-tight">
          {t('chat.title')}
        </h2>
        <p className="flex items-center gap-2 font-mono text-xs text-fg-soft">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              status === null
                ? 'bg-fg-faint'
                : gone
                  ? 'bg-danger'
                  : indexing
                    ? 'animate-pulse bg-warn'
                    : 'bg-accent-text'
            }`}
          />
          {status === null
            ? t('chat.checking')
            : gone
              ? t('chat.expired')
              : indexing
                ? t('chat.indexing')
                : t('chat.indexed', { pages: status.pages })}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
        <SessionSelect
          sessions={sessions}
          active={active}
          onChange={setActive}
          onNew={onNew}
          onDelete={(id) => void onDelete(id)}
          disabled={indexing || gone}
        />

        {indexing && (
          <details className="shrink-0 rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg-soft">
            <summary className="cursor-pointer font-medium text-fg">
              {t('chat.debugTitle', { polls })}
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                Status: {status ? JSON.stringify(status) : 'checking…'} · docId:{' '}
                <span className="font-mono">{docId}</span>
              </p>
              <p>
                {t('chat.debugHelp')}
              </p>
              <button
                type="button"
                onClick={() => void checkDebug()}
                disabled={debugLoading}
                className="rounded-sm border border-line px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-40"
              >
                {debugLoading ? t('chat.debugChecking') : t('chat.debugCheck')}
              </button>
              {debug !== null && (
                <pre className="max-h-64 overflow-auto rounded-sm bg-code p-2 font-mono text-[0.7rem] leading-relaxed text-fg">
                  {JSON.stringify(debug, null, 2)}
                </pre>
              )}
            </div>
          </details>
        )}

        {gone && (
          <p
            role="alert"
            className="shrink-0 border-l-2 border-warn bg-warn/10 px-3 py-2 text-sm"
          >
            {t('chat.goneNote')}{' '}
            <Link to="/" className="underline underline-offset-2">
              {t('common.convertAnother')}
            </Link>
          </p>
        )}

        {error && (
          <p role="alert" className={`shrink-0 ${alertClass}`}>
            {error}
          </p>
        )}

        {active && historyReady ? (
          <DocChat
            key={active}
            docId={docId}
            sessionId={active}
            initialHistory={history}
            indexing={indexing}
            gone={gone}
          />
        ) : (
          <p className="flex-1 py-6 text-center text-sm text-fg-soft">{t('chat.loadingHistory')}</p>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line pt-3 text-xs text-fg-soft">
          <span className="truncate font-mono">fp:{getOrCreateFpId().slice(0, 10)}…</span>
          <button
            type="button"
            onClick={() => void onResetIdentity()}
            className="underline underline-offset-2 hover:text-fg"
          >
            {t('chat.resetIdentity')}
          </button>
        </div>
      </div>
    </section>
  )
}
