import type { ComponentProps } from 'react'
import type { Components, ExtraProps } from 'react-markdown'

import { createContext, useContext, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { fileLink } from '@pi-workbench/shared'
import { Button } from '@pi-workbench/ui/components/button'

import { useFileReader } from '../files/file-reader-context.js'
import { closedFence, messageUrl } from './content-policy.js'
import { HighlightedCode } from './highlighted-code.js'

const plugins = [remarkGfm]
const SourceContext = createContext({ text: '', streaming: false })
const components: Components = {
  a: LocalOrWebLink,
  img: ({ alt }) => <span className="phase-note">[图片未自动加载{alt ? `：${alt}` : ''}]</span>,
  // A named scroll region is keyboard focusable so wide tables remain readable.
  table: ({ children }) => (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard access to wide table scroll
    <section className="message-table" tabIndex={0} aria-label="消息表格">
      <table>{children}</table>
    </section>
  ),
  pre: Code,
}
function LocalOrWebLink({ children, href }: ComponentProps<'a'>) {
  const open = useFileReader(),
    local = href ? fileLink(href) : null
  return local && open ? (
    <Button
      variant="link"
      className="h-auto p-0 whitespace-normal"
      onClick={() => open({ path: local.path }, local.line)}
    >
      {children}
    </Button>
  ) : href && messageUrl(href) ? (
    <a
      href={messageUrl(href)}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
    >
      {children}
    </a>
  ) : (
    <span>{children}</span>
  )
}
function Code({ node, children }: ComponentProps<'pre'> & ExtraProps) {
  const { text, streaming } = useContext(SourceContext)
  const code = node?.children[0]
  if (code?.type !== 'element' || code.tagName !== 'code') {
    return <pre>{children}</pre>
  }
  const source = code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
  const classes = code.properties.className
  const language = Array.isArray(classes)
    ? (classes.find((c) => c.startsWith('language-')) ?? '').slice(9)
    : ''
  const raw = text.slice(node?.position?.start.offset ?? 0, node?.position?.end.offset ?? 0)
  return (
    <HighlightedCode text={source} language={language} enabled={!streaming && closedFence(raw)} />
  )
}

/** CommonMark/GFM produces React nodes only: no raw HTML plugin, embedded SVG, images,
 * execution widgets or privileged/local navigation. Unknown diagrams remain code text. */
export default function MarkdownBody({ text, streaming }: { text: string; streaming: boolean }) {
  const reader = useFileReader()
  const value = useMemo(() => ({ text, streaming }), [text, streaming])
  return (
    <SourceContext value={value}>
      <div className="message-markdown">
        <Markdown
          remarkPlugins={plugins}
          urlTransform={(destination, key) =>
            reader && key === 'href' && fileLink(destination)
              ? destination
              : messageUrl(destination, key)
          }
          components={components}
        >
          {text}
        </Markdown>
      </div>
    </SourceContext>
  )
}
