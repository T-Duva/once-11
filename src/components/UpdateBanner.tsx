import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { isNativeApp, resolveServerOrigin } from '../lib/server'
import { APP_VERSION } from '../version'

export function UpdateBanner() {
  const [remote, setRemote] = useState<string | null>(null)
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const tick = () => {
        void reg.update()
      }
      tick()
      const id = window.setInterval(tick, 20_000)
      return () => window.clearInterval(id)
    },
  })

  useEffect(() => {
    let stop = false
    const check = async () => {
      try {
        const origin = await resolveServerOrigin()
        const r = await fetch(`${origin}/api/health?t=${Date.now()}`, { cache: 'no-store' })
        const j = (await r.json()) as { version?: string }
        if (!stop && j.version) setRemote(j.version)
      } catch {
        /* sin red: no molestar */
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
  if (!needRefresh && !mismatch) return null

  const apply = async () => {
    if (isNativeApp()) {
      const origin = await resolveServerOrigin()
      window.open(`${origin}/once-11.apk`, '_system')
      return
    }
    try {
      await updateServiceWorker(true)
    } catch {
      /* igual recargamos */
    }
    window.location.reload()
  }

  return (
    <div className="update-bar" role="status">
      <div>
        <strong>Hay una versión nueva</strong>
        <span>
          Estás en v{APP_VERSION}
          {remote ? ` → v${remote}` : ''}
        </span>
      </div>
      <button type="button" className="btn primary" onClick={() => void apply()}>
        Actualizar
      </button>
    </div>
  )
}
