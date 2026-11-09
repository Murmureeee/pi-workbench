import type { Locator, Page } from '@playwright/test'

import { expect } from '@playwright/test'

/** Follow the same disclosure a user opens; never alter preferences or bypass visibility. */
export async function openConfiguration(scope: Page | Locator) {
  const trigger = scope.getByRole('button', { name: '会话配置', exact: true })
  await expect(trigger).toBeVisible()
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click()
  }
}

/** Environment details are presentation only; opening never admits or cancels work. */
export async function openEnvironment(scope: Page | Locator) {
  const trigger = scope.getByRole('button', { name: '环境与权限', exact: true })
  await expect(trigger).toBeVisible()
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click()
  }
}

/** Secondary destinations remain reachable from one explicit sidebar disclosure. */
export async function openMore(scope: Page | Locator) {
  const trigger = scope.getByRole('button', { name: '更多入口', exact: true })
  await expect(trigger).toBeVisible()
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click()
  }
}

/** File versions are opened on demand; avoid closing an already expanded history. */
export async function openVersions(scope: Page | Locator) {
  const trigger = scope.getByRole('button', { name: '查看轮次文件版本', exact: true })
  await expect(trigger).toBeVisible()
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click()
  }
}
