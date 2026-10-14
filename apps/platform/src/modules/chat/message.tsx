import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Message, useMessage, useMessagePart } from '@anvia/react-ui'
import type { UIMessage } from '@anvia/react'
import { useI18n } from '../../lib/i18n'
import { CheckIcon, CopyIcon, WrenchIcon } from '../../components/icons'
import { chatMarkdownComponents } from './markdown'
import { jsonText } from './protocol'

/** One tool call, rendered inline inside its assistant message. */
function ToolCall() {
  const { part } = useMessagePart()
  const { t } = useI18n()
  if (part.type !== 'tool') return null
  const running =
    part.state === 'input-streaming' || part.state === 'input-available'
  const failed = part.state === 'error'
  const hasDetail =
    part.input !== undefined ||
    part.output !== undefined ||
    part.error !== undefined

  return (
    <details className="my-1.5 overflow-hidden rounded-md border border-line bg-bg text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 font-mono text-[11px] text-fg-soft">
        <WrenchIcon
          className={`shrink-0 ${failed ? 'text-danger' : 'text-accent-text'}`}
        />
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
export function MessagePart({
  role,
  smoothedText,
  firstTextId,
}: {
  role: UIMessage['role']
  /** Joined animated text for the streaming message (only at its first text part). */
  smoothedText?: string
  firstTextId?: string
}) {
  const { part } = useMessagePart()
  const { t } = useI18n()

  if (part.type === 'text') {
    if (smoothedText !== undefined) {
      if (part.id !== firstTextId) return null
      return (
        <div className="chat-md">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={chatMarkdownComponents}
          >
            {smoothedText}
          </ReactMarkdown>
        </div>
      )
    }
    return role === 'user' ? (
      <span className="whitespace-pre-wrap">
        <Message.Text />
      </span>
    ) : (
      <div className="chat-md">
        <Message.Markdown
          remarkPlugins={[remarkGfm]}
          components={chatMarkdownComponents}
        />
      </div>
    )
  }

  if (part.type === 'reasoning') {
    return (
      <details className="my-2 rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg-soft">
        <summary className="cursor-pointer select-none font-medium text-fg">
          {t('chat.thinking')}
        </summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-sans">
          {part.text}
        </pre>
      </details>
    )
  }

  if (part.type === 'tool') return <ToolCall />

  return null
}

export function CopyMessage() {
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
