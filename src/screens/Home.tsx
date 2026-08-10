import { formatDateISO } from '../lib/format'
import { orderIsPurchased } from '../lib/stats'
import { useApp } from '../state/store'
import { DateBar, makeOrder, todayISO } from '../components/DateBar'

export function Home() {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const setOrderId = useApp((s) => s.setOrderId)
  const setScreen = useApp((s) => s.setScreen)
  const apply = useApp((s) => s.apply)

  const orders = [...db.orders].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

  const openNew = () => {
    if (!user) return
    const iso = todayISO()
    const existing = db.orders.find((o) => o.date === iso)
    if (existing) {
      setOrderId(existing.id)
      setScreen('plan')
      return
    }
    const row = makeOrder(iso, user)
    apply({ op: 'upsert', col: 'orders', row })
    setOrderId(row.id)
    setScreen('plan')
  }

  return (
    <div className="page">
      <DateBar />
      <header className="page-head">
        <h1>Órdenes</h1>
        <button type="button" className="btn primary" onClick={openNew}>
          Cargar hoy
        </button>
      </header>
      <p className="hint">Tocá Cargar hoy o Cargar fecha. Después andá a Planificar y agregá productos.</p>
      <ul className="order-list">
        {orders.length === 0 && <li className="empty">Todavía no hay órdenes. Tocá Cargar hoy.</li>}
        {orders.map((o) => {
          const bought = orderIsPurchased(db, o.id)
          return (
            <li key={o.id}>
              <button
                type="button"
                className="order-row"
                onClick={() => {
                  setOrderId(o.id)
                  setScreen(bought ? 'buy' : 'plan')
                }}
              >
                <strong>{formatDateISO(o.date)}</strong>
                <span className={`pill ${bought ? 'ok' : 'plan'}`}>{bought ? 'Comprado' : 'Planificando'}</span>
                <span className="muted">{o.status}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
