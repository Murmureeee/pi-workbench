import type { ThemedToken } from 'shiki'

import { useEffect, useState } from 'react'

import { Button } from '@pi-workbench/ui/components/button'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@pi-workbench/ui/components/code-block'

const languages = {
  javascript: 'javascript',
  js: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  json: 'json',
  bash: 'bash',
  sh: 'bash',
  python: 'python',
  py: 'python',
  css: 'css',
  html: 'html',
  sql: 'sql',
  markdown: 'markdown',
  md: 'markdown',
} as const

/** Highlighting imports only for a bounded, complete, supported code block. Source is
 * always visible; promise identity prevents an old tokenization replacing new text.
 * Tokens render as React text spans, never HTML from the renderer or the model. */
export function HighlightedCode({
  text,
  language,
  enabled,
}: {
  text: string
  language: string
  enabled: boolean
}) {
  const [result, setResult] = useState<{
    text: string
    language: string
    tokens: { id: number; parts: { id: number; token: ThemedToken }[] }[]
  } | null>(null)
  const [failed, setFailed] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const selected = Object.entries(languages).find(([alias]) => alias === language)?.[1]
  const supported = enabled && Boolean(selected) && text.length <= 12000
  useEffect(() => {
    let current = true
    setFailed(false)
    if (supported && selected) {
      void import('shiki/bundle/web')
        .then(async (shiki) => {
          const highlighted = await shiki.codeToTokens(text, {
            lang: selected,
            themes: { light: 'github-light', dark: 'github-dark' },
          })
          if (current) {
            setResult({
              text,
              language,
              tokens: highlighted.tokens.map((line, id) => ({
                id,
                parts: line.map((token, partId) => ({ id: partId, token })),
              })),
            })
          }
          return undefined
        })
        .catch(() => {
          if (current) {
            setFailed(true)
          }
        })
    }
    return () => {
      current = false
    }
  }, [text, language, supported, selected])
  const tokens =
    supported && result?.text === text && result.language === language ? result.tokens : null
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>
          {language || '纯文本'}
          {!tokens ? ' · 纯文本' : ''}
          {failed ? ' · 高亮暂不可用' : ''}
        </CodeBlockTitle>
        <CodeBlockActions>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(
                () => setCopyStatus('代码已复制'),
                () => setCopyStatus('复制失败，请重试或选择代码复制'),
              )
            }}
          >
            复制代码
          </Button>
        </CodeBlockActions>
      </CodeBlockHeader>
      {copyStatus ? (
        <output className="px-3 text-xs" aria-live="polite">
          {copyStatus}
        </output>
      ) : null}
      <CodeBlockContent
        aria-label={`代码：${language || '纯文本'}`}
        data-highlighted={Boolean(tokens)}
      >
        {tokens
          ? tokens.map((line) => (
              <span className="highlight-line" key={line.id}>
                {line.parts.map(({ id, token }) => (
                  <span key={id} style={token.htmlStyle}>
                    {token.content}
                  </span>
                ))}
                {line.id < tokens.length - 1 ? '\n' : ''}
              </span>
            ))
          : text}
      </CodeBlockContent>
    </CodeBlock>
  )
}
