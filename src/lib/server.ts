const DISCOVERY_URLS = [
  'https://raw.githubusercontent.com/T-Duva/once-11/master/server.json',
  'https://cdn.jsdelivr.net/gh/T-Duva/once-11@master/server.json',
  'https://raw.githubusercontent.com/T-Duva/once-11/main/server.json',
]
const FALLBACKS = [
  'https://c0yvzv-ip-181-117-8-15.tunnelmole.net',
  'http://192.168.1.27:8787',
]

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
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), 3500)
  try {
    const r = await fetch(`${origin.replace(/\/$/, '')}/api/health?t=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    })
    return r.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(t)
  }
}

async function readDiscovery(): Promise<string | null> {
  for (const url of DISCOVERY_URLS) {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), 4000)
    try {
      const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal })
      if (!r.ok) continue
      const j = (await r.json()) as { url?: string }
      if (j.url) return j.url.replace(/\/$/, '')
    } catch {
      /* siguiente */
    } finally {
      window.clearTimeout(t)
    }
  }
  return null
}

export async function resolveServerOrigin(): Promise<string> {
  const here = hereOrigin()
  const tried = new Set<string>()

  const tryOne = async (origin: string | null | undefined) => {
    if (!origin) return null
    const url = origin.replace(/\/$/, '')
    if (tried.has(url)) return null
    tried.add(url)
    if (await healthy(url)) {
      setServerOrigin(url)
      return url
    }
    return null
  }

  if (!isBundledHost()) {
    const ok = await tryOne(here)
    if (ok) return ok
  }

  const saved = localStorage.getItem('once11.server')
  const fromSaved = await tryOne(saved)
  if (fromSaved) return fromSaved
  if (saved) localStorage.removeItem('once11.server')

  const fromMem = await tryOne(cached)
  if (fromMem) return fromMem

  const discovered = await readDiscovery()
  const fromDisc = await tryOne(discovered)
  if (fromDisc) return fromDisc

  for (const fb of FALLBACKS) {
    const ok = await tryOne(fb)
    if (ok) return ok
  }

  cached = isBundledHost() ? FALLBACKS[0] : here
  return cached
}

export function setServerOrigin(url: string) {
  cached = url.replace(/\/$/, '')
  localStorage.setItem('once11.server', cached)
}
