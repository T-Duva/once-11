import { useEffect, useState } from 'react'
import { resolveServerOrigin } from '../lib/server'
import { APP_VERSION } from '../version'

const RELOAD_KEY = 'once11.reloadFor'

export function UpdateBanner() {
  const [remote, setRemote] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    const check = async () => {
      try {
        const origin = await resolveServerOrigin()
        const r = await fetch(`${origin}/api/health?t=${Date.now()}`, { cache: 'no-store' })
        const j = (await r.json()) as { version?: string }
        if (!stop && j.version) setRemote(j.version)
      } catch {
        /* sin red */
      }
    }
    void check()
    const id = window.setInterval(check, 20_000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [])

  const mismatch = Boolean(remote && remote !== APP_VERSION)

  useEffect(() => {
    if (!mismatch || !remote) return
    if (sessionStorage.getItem(RELOAD_KEY) === remote) return
    sessionStorage.setItem(RELOAD_KEY, remote)
    const t = window.setTimeout(() => window.location.reload(), 800)
    return () => window.clearTimeout(t)
  }, [mismatch, remote])

  if (!mismatch) return null

  return (
    <div className="update-bar" role="status">
      <strong>Hay una versión nueva</strong>
      <span>
        v{APP_VERSION} → v{remote}
      </span>
    </div>
  )
}
