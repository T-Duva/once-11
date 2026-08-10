import { useEffect, useState } from 'react'
import { useApp } from '../state/store'
import type { WatcherStatus } from '../types'

const LABELS: Record<WatcherStatus, string> = {
  online: 'Online',
  working: 'Trabajando…',
  stuck: 'Trabado',
  off: 'Apagado',
}

export function StatusLight() {
  const watcher = useApp((s) => s.watcher)
  const connected = useApp((s) => s.connected)
  const [, tick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  let status: WatcherStatus = 'off'
  if (connected) {
    if (watcher.status === 'stuck') status = 'stuck'
    else if (watcher.status === 'working') status = 'working'
    else status = 'online'
  }

  return (
    <button type="button" className={`light-btn light-${status}`} title={`Escucha: ${LABELS[status]}`} aria-label={LABELS[status]}>
      <span className="light-dot" />
      <span className="light-txt">{LABELS[status]}</span>
    </button>
  )
}
