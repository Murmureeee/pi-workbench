import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { ChangeAvailabilityService } from '../dist/modules/changes/change-availability.service.js'
import { ChangeReviewService } from '../dist/modules/changes/change-review.service.js'
import { ChangeService } from '../dist/modules/changes/change.service.js'
import { setupChangeFixture } from './helpers/change-fixture.js'

function first<T>(items: T[]): T {
  const value = items[0]
  if (value === undefined) {
    throw new Error('Expected fixture file/version missing')
  }
  return value
}

test('cHANGE-07 different blocks retain immutable earlier Diff and dependency versions across sessions; newest rollback recomputes old availability', async () => {
  const f = await setupChangeFixture()
  try {
    const path = join(f.cwd, 'code.txt')
    writeFileSync(path, 'first=0\n\nsecond=0\n')
    const a = await f.collect(() => writeFileSync(path, 'first=1\n\nsecond=0\n'))
    const review = f.app.get(ChangeReviewService),
      list = await review.list(a.turnId),
      id = first(list.files).id,
      original = await review.diff(a.turnId, id)
    const b = await f.collect(() => writeFileSync(path, 'first=1\n\nsecond=1\n'))
    const service = f.app.get(ChangeAvailabilityService),
      current = await service.inspect(a.turnId)
    expect(current.files[0]).toMatchObject({
      state: 'changed',
      requiresExternalConfirmation: true,
      later: [{ sessionId: b.sessionId, turnId: b.turnId, relation: 'changed-path' }],
    })
    expect(first(first(current.files).versions).final).not.toBe(
      first(first(current.files).versions).current,
    )
    expect(await review.diff(a.turnId, id)).toEqual(original)
    expect(JSON.stringify(original)).toContain('first=1')
    expect((await f.rollback(b)).state).toBe('succeeded')
    expect(readFileSync(path, 'utf8')).toBe('first=1\n\nsecond=0\n')
    expect(first((await service.inspect(a.turnId)).files).state).toBe('matches-final')
    expect(first((await service.inspect(b.turnId)).files).state).toBe('at-baseline')
    expect(await review.diff(a.turnId, id)).toEqual(original)
    await f.restart()
    expect(first((await f.app.get(ChangeAvailabilityService).inspect(a.turnId)).files).state).toBe(
      'matches-final',
    )
    expect(await f.app.get(ChangeReviewService).diff(a.turnId, id)).toEqual(original)
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-07 physical alias shares dependencies; independent directories do not; busy ownership, external bytes and unavailable later versions remain explicit', async () => {
  const f = await setupChangeFixture()
  try {
    const path = join(f.cwd, 'a'),
      alias = join(f.root, 'alias'),
      other = join(f.root, 'other')
    writeFileSync(path, 'zero')
    const a = await f.collect(() => writeFileSync(path, 'one'))
    symlinkSync(f.cwd, alias, 'junction')
    const b = await f.collect(() => writeFileSync(path, 'two'), randomUUID(), alias)
    mkdirSync(other)
    writeFileSync(join(other, 'a'), 'one')
    await f.collect(() => writeFileSync(join(other, 'a'), 'other'), randomUUID(), other)
    const service = f.app.get(ChangeAvailabilityService)
    expect(first((await service.inspect(a.turnId)).files).later.map((r) => r.turnId)).toEqual([
      b.turnId,
    ])
    const busy = f.start()
    await f.ready(busy.sessionId)
    const observed = await service.inspect(a.turnId)
    expect(observed.owner).toEqual({ sessionId: busy.sessionId, turnId: busy.turnId })
    expect(first(observed.files).later.some((l) => l.relation === 'unavailable')).toBe(true)
    writeFileSync(path, 'unknown external')
    expect(first((await service.inspect(a.turnId)).files).state).toBe('changed')
    const original = f.app.get(ChangeService).snapshotFiles.bind(f.app.get(ChangeService))
    vi.spyOn(f.app.get(ChangeService), 'snapshotFiles').mockImplementation((turn, phase) =>
      turn === b.turnId ? Promise.reject(new Error('corrupt later object')) : original(turn, phase),
    )
    expect(
      first((await service.inspect(a.turnId)).files).later.find((l) => l.turnId === b.turnId)
        ?.relation,
    ).toBe('unavailable')
    unlinkSync(alias)
  } finally {
    await f.close()
  }
}, 60000)
