export interface RequestReservation {
  requestId: string
  purpose: string
  outputLimit: number
  status: 'reserved' | 'succeeded' | 'failed' | 'aborted'
  reservedAt: string
}
interface MilestoneBudget {
  id: string
  requests: RequestReservation[]
  scopeAuthorization?: string
}
export interface BudgetFile {
  limits: {
    maxNewProviderRequestsPerMilestone: number
    maxOutputTokensPerRequest: number
    automaticRetry: boolean
  }
  milestones: MilestoneBudget[]
  [key: string]: unknown
}
