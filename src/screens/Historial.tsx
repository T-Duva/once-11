import { USER_LABEL } from '../types'
import { useApp } from '../state/store'

export function Historial() {
  const db = useApp((s) => s.db)
  const logs = [...db.audit].sort((a, b) => b.at - a.at).slice(0, 200)

  return (
    <div className="page">
      <header className="page-head">
        <h1>Historial</h1>
      </header>
      <p className="hint">Quién tocó qué.</p>
      <ul className="audit-list">
        {logs.length === 0 && <li className="empty">Todavía no hay cambios.</li>}
        {logs.map((a) => (
          <li key={a.id} className={`audit ${a.user}`}>
            <strong>{USER_LABEL[a.user]}</strong>
            <span>{a.field}</span>
            <time>{new Date(a.at).toLocaleString('es-AR')}</time>
            <p className="muted mini">
              {fmt(a.before)} → {fmt(a.after)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}
