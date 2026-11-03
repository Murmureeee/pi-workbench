import { useSyncExternalStore } from 'react'

let index = 0
let lastIndex = 0
function primaryView(search: string) {
  const query = new URLSearchParams(search)
  return !search || query.has('session') || query.has('samples')
}
let lastWorkbenchHref = primaryView(location.search) ? `/${location.search}` : '/'
let snapshot = {
  search: location.search,
  canGoBack: false,
  canGoForward: false,
  workbenchHref: lastWorkbenchHref,
}
const listeners = new Set<() => void>()

function publish() {
  if (primaryView(location.search)) {
    lastWorkbenchHref = `/${location.search}`
  }
  snapshot = {
    search: location.search,
    canGoBack: index > 0,
    canGoForward: index < lastIndex,
    workbenchHref: lastWorkbenchHref,
  }
  for (const listener of listeners) {
    listener()
  }
}
window.addEventListener('popstate', (event) => {
  const state: unknown = event.state
  index =
    state && typeof state === 'object' && 'piwView' in state && typeof state.piwView === 'number'
      ? state.piwView
      : 0
  publish()
})

/** Same-document navigation keeps draft, theme and mounted conversation context in memory.
 * Only this app's root-page views are eligible; downloads, pairing fragments, modified clicks
 * and external links retain their normal browser behavior. It never cancels daemon work.
 */
export function navigate(href: string): void {
  const url = new URL(href, location.href)
  if (url.origin !== location.origin || url.pathname !== '/' || url.hash) {
    return
  }
  if (url.search === location.search) {
    return
  }
  index += 1
  lastIndex = index
  history.pushState({ piwView: index }, '', url)
  publish()
}

export function handleAppNavigation(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  const anchor = event.target instanceof Element ? event.target.closest('a') : null
  if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) {
    return
  }
  const url = new URL(anchor.href)
  if (url.origin !== location.origin || url.pathname !== '/' || url.hash) {
    return
  }
  event.preventDefault()
  navigate(anchor.href)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useNavigation() {
  return useSyncExternalStore(subscribe, () => snapshot)
}
/** Returning from settings restores the viewed conversation; global New uses navigate('/'). */
export function workbenchHref() {
  return lastWorkbenchHref
}
