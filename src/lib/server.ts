import { Capacitor } from '@capacitor/core'

const DISCOVERY_URLS = [
  'https://api.github.com/repos/T-Duva/once-11/contents/server.json?ref=master',
  'https://cdn.jsdelivr.net/gh/T-Duva/once-11@master/server.json',
  'https://raw.githubusercontent.com/T-Duva/once-11/master/server.json',
  'https://raw.githubusercontent.com/T-Duva/once-11/main/server.json',
]
const FALLBACKS = [
  'https://mysql-detect-bars-karma.trycloudflare.com',
  'http://192.168.1.27:8787',
]

let cached: string | null = null

export function isNativeApp(): boolean {
  if (Capacitor.isNativePlatform()) return true
  try {
    if (sessionStorage.getItem('once11.fromApp') === '1') return true
  } catch {
    /* modo privado */
  }
  return new URLSearchParams(location.search).has('fromApp')
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

/** localtunnel muestra cartel HTML al WebView; este header lo salta. */
function apiHeaders(extra?: HeadersInit): HeadersInit {
  return {
    'bypass-tunnel-reminder': '1',
    Accept: 'application/json',
    ...(extra || {}),
  }
}

async function healthy(origin: string): Promise<boolean> {
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), 3500)
  try {
    const r = await fetch(`${origin.replace(/\/$/, '')}/api/health?t=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: apiHeaders(),
    })
    if (!r.ok) return false
    const ct = (r.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('text/html')) return false
    // Rechazar túnel/servidor de otra app (REPOSICIÓN, Reportador, etc.).
    try {
      const j = (await r.json()) as { app?: string; appId?: string }
      if (j.app && j.app !== 'once11') return false
      if (j.appId && j.appId !== 'com.once11.app') return false
    } catch {
      return false
    }
    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(t)
  }
}

async function readDiscovery(): Promise<string | null> {
  const urls = DISCOVERY_URLS.map((u) => `${u}${u.includes('?') ? '&' : '?'}t=${Date.now()}`)
  const hits = await Promise.all(
    urls.map(async (url) => {
      const ctrl = new AbortController()
      const t = window.setTimeout(() => ctrl.abort(), 5000)
      try {
        const r = await fetch(url, {
          cache: 'no-store',
          signal: ctrl.signal,
          headers: {
            Accept: 'application/vnd.github.raw+json, application/json',
            'bypass-tunnel-reminder': '1',
          },
        })
        if (!r.ok) return null
        const text = await r.text()
        let j: { url?: string; content?: string; encoding?: string }
        try {
          j = JSON.parse(text) as { url?: string; content?: string; encoding?: string }
        } catch {
          return null
        }
        if (j.url) return j.url.replace(/\/$/, '')
        // GitHub Contents API (base64) — evita el CDN pegado de raw.githubusercontent
        if (j.content && j.encoding === 'base64') {
          try {
            const decoded = JSON.parse(atob(j.content.replace(/\n/g, ''))) as { url?: string }
            return decoded.url ? decoded.url.replace(/\/$/, '') : null
          } catch {
            return null
          }
        }
        return null
      } catch {
        return null
      } finally {
        window.clearTimeout(t)
      }
    }),
  )
  return hits.find(Boolean) ?? null
}

async function tryHealthyOrigin(
  origin: string | null | undefined,
  tried: Set<string>,
): Promise<string | null> {
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

export async function resolveServerOrigin(): Promise<string> {
  const here = hereOrigin()
  const tried = new Set<string>()

  const tryOne = (origin: string | null | undefined) => tryHealthyOrigin(origin, tried)

  if (!isBundledHost()) {
    const ok = await tryOne(here)
    if (ok) return ok
  } else {
    // APK: la URL del tunel cambia; GitHub primero, no confiar en cache vieja.
    const discovered = await readDiscovery()
    const fromDisc = await tryOne(discovered)
    if (fromDisc) return fromDisc
    for (const fb of FALLBACKS) {
      const ok = await tryOne(fb)
      if (ok) return ok
    }
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

  cached = here
  return cached
}

/** Para compartir enlace APK: solo URL comprobada con /api/health. */
export async function resolveHealthyOrigin(): Promise<string> {
  cached = null
  try {
    localStorage.removeItem('once11.server')
  } catch {
    /* modo privado */
  }

  const tried = new Set<string>()
  const discovered = await readDiscovery()
  const fromDisc = await tryHealthyOrigin(discovered, tried)
  if (fromDisc) return fromDisc
  for (const fb of FALLBACKS) {
    const ok = await tryHealthyOrigin(fb, tried)
    if (ok) return ok
  }
  throw new Error('Sin servidor')
}

export function setServerOrigin(url: string) {
  cached = url.replace(/\/$/, '')
  localStorage.setItem('once11.server', cached)
}
































