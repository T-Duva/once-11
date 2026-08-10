import { useState } from 'react'
import { DateBar } from '../components/DateBar'
import { FocusField } from '../components/FocusField'
import { formatDateISO, money } from '../lib/format'
import { newId } from '../lib/id'
import { lineCostForStation, lineHasPurchase, stationSpentInOrder } from '../lib/stats'
import { useApp } from '../state/store'
import { STATIONS, STATION_LABEL, type Payment, type Station } from '../types'

export function Repartir() {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const orderId = useApp((s) => s.orderId)
  const apply = useApp((s) => s.apply)
  const order = db.orders.find((o) => o.id === orderId)
  const [payDate, setPayDate] = useState(() => order?.distributeDate || order?.date || '')
  const [payAmt, setPayAmt] = useState('')

  if (!order) {
    return (
      <div className="page">
        <DateBar />
        <p className="empty">Tocá Cargar fecha para la repartición.</p>
      </div>
    )
  }

  const lines = db.purchaseLines.filter((l) => l.orderId === order.id && lineHasPurchase(l))
  const payments = db.payments.filter((p) => p.orderId === order.id)

  const addPay = (station: Station) => {
    if (!user) return
    const amount = Number(payAmt.replace(',', '.')) || 0
    if (amount <= 0 || !payDate) return
    const row: Payment = {
      id: newId(),
      station,
      date: payDate,
      amount,
      orderId: order.id,
      createdBy: user,
      createdAt: Date.now(),
    }
    apply({ op: 'upsert', col: 'payments', row })
    if (!order.distributeDate) {
      apply({ op: 'upsert', col: 'orders', row: { ...order, distributeDate: payDate, status: 'repartiendo' } })
    }
    setPayAmt('')
  }

  return (
    <div className="page">
      <DateBar />
      <header className="page-head">
        <h1>Repartir</h1>
      </header>
      <p className="hint">Resumen de lo comprado el {formatDateISO(order.date)}. Lo solo planificado no aparece.</p>

      {STATIONS.map((st) => {
        const spent = stationSpentInOrder(db, order.id, st)
        const paid = payments.filter((p) => p.station === st).reduce((s, p) => s + p.amount, 0)
        const items = lines
          .filter((l) => (l.split[st] || 0) > 0)
          .map((l) => ({
            name: db.products.find((p) => p.id === l.productId)?.name ?? 'Producto',
            qty: l.split[st],
            cost: lineCostForStation(l, st),
            notes: l.notes,
          }))
        return (
          <section key={st} className={`station-block ${st}`}>
            <h2>{STATION_LABEL[st]}</h2>
            {items.length === 0 ? (
              <p className="muted">Nada asignado en esta compra.</p>
            ) : (
              <ul className="mini-list">
                {items.map((it, i) => (
                  <li key={i}>
                    <span>
                      {it.qty} × {it.name}
                      {it.notes ? <em> · {it.notes}</em> : null}
                    </span>
                    <strong>{money(it.cost)}</strong>
                  </li>
                ))}
              </ul>
            )}
            <div className="pay-sum">
              <div>
                <span>Debe pagar</span>
                <strong>{money(spent)}</strong>
              </div>
              <div>
                <span>Pagó</span>
                <strong>{money(paid)}</strong>
              </div>
              <div className={spent - paid > 0 ? 'neg' : 'ok-txt'}>
                <span>Saldo</span>
                <strong>{money(spent - paid)}</strong>
              </div>
            </div>
            {st === 'madro' && (
              <div className="pay-form">
                <FocusField id={`pay-date-${order.id}`}>
                  <label>
                    Fecha de pago
                    <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                  </label>
                </FocusField>
                <FocusField id={`pay-amt-${order.id}`}>
                  <label>
                    Monto
                    <input inputMode="decimal" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                  </label>
                </FocusField>
                <button type="button" className="btn primary" onClick={() => addPay('madro')}>
                  Cargar pago Madro
                </button>
              </div>
            )}
            {st !== 'madro' && <p className="muted mini">Pagan adelantado: el gasto queda en el historial.</p>}
            {payments
              .filter((p) => p.station === st)
              .map((p) => (
                <p key={p.id} className="pay-log">
                  {formatDateISO(p.date)} · {money(p.amount)}
                </p>
              ))}
          </section>
        )
      })}
    </div>
  )
}
