// Return-destination guard for sign-in flows: only same-origin relative paths are
// honored; anything else (absolute URLs to other hosts, protocol-relative `//x`,
// backslash tricks) falls back to the home page. An absolute URL on our own
// origin (what an email template's RedirectTo carries) is reduced to its path.
export function safeNext(raw: string | null | undefined, origin?: string): string {
  if (!raw) return '/'
  let path = raw
  if (origin && /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      if (u.origin !== origin) return '/'
      path = `${u.pathname}${u.search}${u.hash}`
    } catch {
      return '/'
    }
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/'
  return path
}
