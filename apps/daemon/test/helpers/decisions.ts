import type { createApp } from '../../dist/bootstrap/app.js'

import { EventService } from '../../dist/modules/events/event.service.js'
import { ApprovalService } from '../../dist/modules/security/approval.service.js'

/** Explicit synthetic human refusal for older deny-only fixtures. Uses the same immutable
 * live service command; cannot grant permission and is not registered in product code. */
export function denyFixtureApprovals(app: Awaited<ReturnType<typeof createApp>>): () => void {
  const approvals = app.get(ApprovalService)
  return app.get(EventService).onChange(() => {
    for (const p of approvals.list()) {
      approvals.decide(
        p.id,
        {
          sessionId: p.sessionId,
          epoch: p.epoch,
          turnId: p.turnId,
          digest: p.risk.digest,
          policyVersion: p.risk.policyVersion,
          action: 'deny',
          reason: 'Test fixture explicit refusal',
          acceptIrreversible: false,
        },
        'test-fixture',
      )
    }
  })
}
