const DISCOVERY = 'https://raw.githubusercontent.com/T-Duva/once-11/master/server.json'
const FALLBACK = 'https://mlfzvw-ip-181-117-8-15.tunnelmole.net'

let cached: string | null = null

export function isNativeApp(): boolean {
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  return Boolean(w.Capacitor?.isNativePlatform?.())
}

function hereOrigin(): string {
  return `${location.protocol}//${location.host}`
}

function isBundledHost(): boolean {
  const h = location.hostname
  return (
    location.protocol === 'capacitor:' ||
    /^localhost$|^127\.0\.0\.1$/i.test(h) ||
    h.endsWith('.localhost')
  )
}

async function healthy(origin: string): Promise<boolean> {
  try {
    const r = await fetch(`${origin.replace(/\/$/, '')}/api/health?t=${Date.now()}`, { cache: 'no-store' })
    return r.ok
  } catch {
    return false
  }
}

export async function resolveServerOrigin(): Promise<string> {
  const here = hereOrigin()

  if (!isBundledHost() && (await healthy(here))) {
    setServerOrigin(here)
    return cached!
  }

  const saved = localStorage.getItem('once11.server')
  if (saved) {
    const url = saved.replace(/\/$/, '')
    if (await healthy(url)) {
      cached = url
      return url
    }
    localStorage.removeItem('once11.server')
  }

  if (cached && (await healthy(cached))) return cached

  try {
    const r = await fetch(`${DISCOVERY}?t=${Date.now()}`, { cache: 'no-store' })
    const j = (await r.json()) as { url?: string }
    if (j.url && (await healthy(j.url))) {
      setServerOrigin(j.url)
      return cached!
    }
  } catch {
    /* usar fallback */
  }

  if (await healthy(FALLBACK)) {
    setServerOrigin(FALLBACK)
    return cached!
  }

  cached = isBundledHost() ? FALLBACK : here
  return cached
}

export function setServerOrigin(url: string) {
  cached = url.replace(/\/$/, '')
  localStorage.setItem('once11.server', cached)
}
