import type { FileReadInput } from '@pi-workbench/shared'

import { createContext, useContext } from 'react'
export type OpenFile = (source: FileReadInput['source'], line?: number) => void
export const ReaderContext = createContext<OpenFile | null>(null)
export const useFileReader = () => useContext(ReaderContext)
