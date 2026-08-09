import { useMemo } from 'react'
import { useApp } from '../state/store'
import type { WatcherStatus } from '../types'

const LABELS: Record<WatcherStatus | 'off', string> = {
  online: 'Online',
  working: 'Trabajando…',
  stuck: 'Trabado',
  off: 'Apagado',
}

export function StatusLight() {
  const watcher = useApp((s) => s.watcher)
  const connected = useApp((s) => s.connected)

  const status = useMemo((): WatcherStatus => {
    if (!connected) return 'off'
    const age = Date.now() - (watcher.lastSeenAt || 0)
    if (!watcher.lastSeenAt || age > 25000) return 'off'
    if (watcher.status === 'working' && age > 3 * 60 * 1000) return 'stuck'
    return watcher.status || 'off'
  }, [watcher, connected])

  return (
    <button type="button" className={`light-btn light-${status}`} title={`Escucha: ${LABELS[status]}`} aria-label={LABELS[status]}>
      <span className="light-dot" />
      <span className="light-txt">{LABELS[status]}</span>
    </button>
  )
}
