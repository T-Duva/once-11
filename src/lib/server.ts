const DISCOVERY = 'https://raw.githubusercontent.com/T-Duva/once-11/master/server.json'
const FALLBACK = 'https://mlfzvw-ip-181-117-8-15.tunnelmole.net'

let cached: string | null = null

export function isNativeApp(): boolean {
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  return Boolean(w.Capacitor?.isNativePlatform?.())
}

export async function resolveServerOrigin(): Promise<string> {
  if (!isNativeApp()) {
    return `${location.protocol}//${location.host}`
  }
  const saved = localStorage.getItem('once11.server')
  if (saved) {
    cached = saved.replace(/\/$/, '')
    return cached
  }
  if (cached) return cached
  try {
    const r = await fetch(`${DISCOVERY}?t=${Date.now()}`, { cache: 'no-store' })
    const j = (await r.json()) as { url?: string }
    if (j.url) {
      cached = j.url.replace(/\/$/, '')
      return cached
    }
  } catch {
    /* usar fallback */
  }
  cached = FALLBACK
  return cached
}

export function setServerOrigin(url: string) {
  cached = url.replace(/\/$/, '')
  localStorage.setItem('once11.server', cached)
}
