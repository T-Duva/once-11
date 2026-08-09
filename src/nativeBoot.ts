import { Capacitor } from '@capacitor/core'
import { resolveServerOrigin } from './lib/server'

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

/** En la app instalada, entra al servidor vivo para no quedar pegado a una versión vieja. */
export async function nativeLiveUpdate(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  if (new URLSearchParams(location.search).has('bundled')) return false
  try {
    const origin = await resolveServerOrigin()
    if (sameHost(origin, location.origin)) return false
    const r = await fetch(`${origin}/api/health?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return false
    window.location.replace(`${origin}/?fromApp=1`)
    return true
  } catch {
    return false
  }
}
