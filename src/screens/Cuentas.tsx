import { useMemo, useState } from 'react'
import { formatDateISO, money } from '../lib/format'
import { lineCostForStation, lineHasPurchase, orderIsPurchased } from '../lib/stats'
import { useApp } from '../state/store'
import { STATIONS, STATION_LABEL, type Station } from '../types'

export function Cuentas() {
  const db = useApp((s) => s.db)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [mode, setMode] = useState<'all' | 'range'>('all')

  const purchasedOrders = useMemo(
    () => db.orders.filter((o) => orderIsPurchased(db, o.id)).sort((a, b) => b.date.localeCompare(a.date)),
    [db],
  )

  const filtered = purchasedOrders.filter((o) => {
    if (mode !== 'range') return true
    if (from && o.date < from) return false
    if (to && o.date > to) return false
    return true
  })

  const ids = new Set(filtered.map((o) => o.id))

  const byStation = (st: Station) => {
    const lines = db.purchaseLines.filter((l) => ids.has(l.orderId) && lineHasPurchase(l) && (l.split[st] || 0) > 0)
    const spent = lines.reduce((s, l) => s + lineCostForStation(l, st), 0)
    const paid = db.payments.filter((p) => p.station === st && (!p.orderId || ids.has(p.orderId))).reduce((s, p) => s + p.amount, 0)
    const byDate = filtered
      .map((o) => ({
        order: o,
        spent: db.purchaseLines
          .filter((l) => l.orderId === o.id && lineHasPurchase(l))
          .reduce((s, l) => s + lineCostForStation(l, st), 0),
        items: db.purchaseLines
          .filter((l) => l.orderId === o.id && lineHasPurchase(l) && (l.split[st] || 0) > 0)
          .map((l) => ({
            name: db.products.find((p) => p.id === l.productId)?.name ?? 'Producto',
            qty: l.split[st],
            cost: lineCostForStation(l, st),
          })),
      }))
      .filter((x) => x.spent > 0 || x.items.length > 0)
    return { spent, paid, byDate }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Cuentas</h1>
      </header>
      <p className="hint">Solo lo que ya se compró. Lo planificado no entra.</p>
      <div className="filter-row">
        <button type="button" className={`btn ${mode === 'all' ? 'primary' : 'ghost'}`} onClick={() => setMode('all')}>
          Todo
        </button>
        <button type="button" className={`btn ${mode === 'range' ? 'primary' : 'ghost'}`} onClick={() => setMode('range')}>
          Fechas
        </button>
      </div>
      {mode === 'range' && (
        <div className="grid2">
          <label>
            Desde
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}

      {filtered.length === 0 && <p className="empty">No hay compras en este período.</p>}

      {STATIONS.map((st) => {
        const info = byStation(st)
        return (
          <section key={st} className={`station-block ${st}`}>
            <h2>{STATION_LABEL[st]}</h2>
            <div className="pay-sum">
              <div>
                <span>Compró</span>
                <strong>{money(info.spent)}</strong>
              </div>
              {st === 'madro' && (
                <>
                  <div>
                    <span>Pagó</span>
                    <strong>{money(info.paid)}</strong>
                  </div>
                  <div className={info.spent - info.paid > 0 ? 'neg' : 'ok-txt'}>
                    <span>Saldo</span>
                    <strong>{money(info.spent - info.paid)}</strong>
                  </div>
                </>
              )}
            </div>
            <ul className="mini-list">
              {info.byDate.map((row) => (
                <li key={row.order.id} className="cuenta-date">
                  <div className="cuenta-head">
                    <strong>{formatDateISO(row.order.date)}</strong>
                    <span>{money(row.spent)}</span>
                  </div>
                  {row.items.map((it, i) => (
                    <p key={i} className="muted mini">
                      {it.qty} × {it.name} · {money(it.cost)}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
