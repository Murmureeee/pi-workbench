import { createContext } from 'react'

export type PrepareMessageQuote = () => ((text: string) => string | null) | null
export const MessageQuoteContext = createContext<PrepareMessageQuote | null>(null)
