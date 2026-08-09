import type { ReactNode } from 'react'
import { StatusLight } from './StatusLight'
import { ReportModal } from './ReportModal'
import { otherUser, useApp } from '../state/store'
import { APP_VERSION, APP_NAME } from '../version'
import { USER_LABEL, type Screen } from '../types'

const NAV: { id: Screen; label: string }[] = [
  { id: 'home', label: 'Órdenes' },
  { id: 'plan', label: 'Planificar' },
  { id: 'buy', label: 'Comprar' },
  { id: 'split', label: 'Repartir' },
  { id: 'accounts', label: 'Cuentas' },
]

export function Shell({ children }: { children: ReactNode }) {
  const screen = useApp((s) => s.screen)
  const setScreen = useApp((s) => s.setScreen)
  const setReportOpen = useApp((s) => s.setReportOpen)
  const user = useApp((s) => s.user)
  const logout = useApp((s) => s.logout)
  const presence = useApp((s) => s.presence)
  const toast = useApp((s) => s.toast)
  const clearToast = useApp((s) => s.clearToast)
  const db = useApp((s) => s.db)
  const mark = useApp((s) => s.markNotifRead)
  const other = user ? otherUser(user) : null
  const otherHere = other && presence.find((p) => p.user === other && Date.now() - p.updatedAt < 10000)
  const notifs = user ? db.notifications.filter((n) => n.to === user && !n.read).slice(-3) : []

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-11">11</span>
          <div>
            <strong>{APP_NAME}</strong>
            <small>
              {user ? USER_LABEL[user] : ''}
              {otherHere ? ` · ${USER_LABEL[otherHere.user]} en ${navLabel(otherHere.screen)}` : ''}
            </small>
          </div>
        </div>
        <div className="top-actions">
          <StatusLight />
          <button type="button" className="btn report" onClick={() => setReportOpen(true)}>
            Reportar
          </button>
        </div>
      </header>

      {notifs.map((n) => (
        <button type="button" key={n.id} className="banner" onClick={() => mark(n.id)}>
          <strong>{n.title}</strong>
          <span>{n.body}</span>
        </button>
      ))}
      {toast && (
        <button type="button" className="banner ok" onClick={clearToast}>
          {toast}
        </button>
      )}

      <main className="main">{children}</main>

      <nav className="tabbar">
        {NAV.map((n) => (
          <button key={n.id} type="button" className={screen === n.id ? 'on' : ''} onClick={() => setScreen(n.id)}>
            {n.label}
          </button>
        ))}
        <button type="button" className={screen === 'audit' ? 'on' : ''} onClick={() => setScreen('audit')}>
          Log
        </button>
      </nav>

      <footer className="foot">
        <span>v{APP_VERSION}</span>
        <button type="button" className="linkish" onClick={logout}>
          Salir
        </button>
      </footer>
      <ReportModal />
    </div>
  )
}

function navLabel(s: Screen): string {
  return NAV.find((n) => n.id === s)?.label ?? s
}
