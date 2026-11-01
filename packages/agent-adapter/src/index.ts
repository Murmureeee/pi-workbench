export { fixtureFor } from './fake-kernel.js'
export { finishRequest, reserveRequest } from './validation-budget.js'
export { SessionKernel } from './kernel.js'
export type { KernelSnapshot } from './kernel.js'
export {
  previewText,
  readNativeHistory,
  readNativeMessage,
  readNativeRange,
} from './native-history.js'
export type { NativeDiagnostic, NativeHistory, NativeRecord } from './native-history.js'
