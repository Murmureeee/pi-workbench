/** Remove the pairing fragment before requests/rendering; retain it only in memory until
 * explicit submission. It must never become a query, referrer or browser storage entry.
 */
export function readPairingFragment(): string {
  const fragment = new URLSearchParams(location.hash.slice(1)),
    code = fragment.get('pair') ?? ''
  if (fragment.has('pair')) {
    history.replaceState(null, '', location.pathname + location.search)
  }
  return code
}
