import { useMemo, useState } from 'react'
import { FocusField } from '../components/FocusField'
import { DateBar } from '../components/DateBar'
import { qtyLabel } from '../lib/format'
import { lastPurchasedQty, productMedian } from '../lib/stats'
import { useApp } from '../state/store'
import { STATIONS, STATION_LABEL, type PlanItem } from '../types'

export function Planificar() {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const orderId = useApp((s) => s.orderId)
  const apply = useApp((s) => s.apply)
  const [q, setQ] = useState('')

  const order = db.orders.find((o) => o.id === orderId)
  const items = db.planItems.filter((p) => p.orderId === orderId)
  const query = q.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!query) return db.products.slice(0, 8)
    return db.products.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 12)
  }, [db.products, query])

  const addProduct = (name: string, existingId?: string) => {
    if (!user || !orderId) return
    const trimmed = name.trim()
    if (!trimmed) return
    let productId = existingId
    if (!productId) {
      const found = db.products.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
      if (found) productId = found.id
      else {
        productId = crypto.randomUUID()
        apply({
          op: 'upsert',
          col: 'products',
          row: { id: productId, name: trimmed, createdBy: user, createdAt: Date.now() },
        })
      }
    }
    if (items.some((i) => i.productId === productId)) {
      setQ('')
      return
    }
    const row: PlanItem = {
      id: crypto.randomUUID(),
      orderId,
      productId,
      qty: lastPurchasedQty(db, productId) ?? productMedian(db, productId) ?? 0,
      station: null,
    }
    apply({ op: 'upsert', col: 'planItems', row })
    setQ('')
  }

  if (!order) {
    return (
      <div className="page">
        <DateBar />
        <p className="empty">Poné una fecha arriba para armar el pedido.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <DateBar />
      <header className="page-head">
        <h1>Planificar</h1>
      </header>
      <FocusField id="plan-search">
        <label className="search">
          Buscar / agregar
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ej. bidón 20L"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addProduct(q, matches[0]?.id && matches[0].name.toLowerCase() === q.trim().toLowerCase() ? matches[0].id : undefined)
              }
            }}
          />
        </label>
      </FocusField>
      {q.trim() && (
        <ul className="suggest">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => addProduct(p.name, p.id)}>
                {p.name}
                <small>
                  última {qtyLabel(lastPurchasedQty(db, p.id))} · mediana {qtyLabel(productMedian(db, p.id))}
                </small>
              </button>
            </li>
          ))}
          {(!matches.length || !matches.some((p) => p.name.toLowerCase() === q.trim().toLowerCase())) && (
            <li>
              <button type="button" onClick={() => addProduct(q)}>
                Crear “{q.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}

      <ul className="cards">
        {items.map((item) => {
          const prod = db.products.find((p) => p.id === item.productId)
          const last = lastPurchasedQty(db, item.productId)
          const med = productMedian(db, item.productId)
          return (
            <li key={item.id} className="card">
              <div className="card-top">
                <h3>{prod?.name ?? 'Producto'}</h3>
                <button
                  type="button"
                  className="icon-x"
                  onClick={() => apply({ op: 'remove', col: 'planItems', id: item.id })}
                  aria-label="Sacar"
                >
                  ×
                </button>
              </div>
              <p className="stats-line">
                Última: <strong>{qtyLabel(last)}</strong>
                <span className="dot">·</span>
                Mediana: <strong>{qtyLabel(med)}</strong>
              </p>
              <FocusField id={`plan-qty-${item.id}`}>
                <label>
                  ¿Cuántas llevamos?
                  <input
                    inputMode="decimal"
                    value={item.qty || ''}
                    onChange={(e) =>
                      apply({
                        op: 'upsert',
                        col: 'planItems',
                        row: { ...item, qty: Number(e.target.value.replace(',', '.')) || 0 },
                      })
                    }
                  />
                </label>
              </FocusField>
              <div className="station-row">
                {STATIONS.map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`st-chip ${st} ${item.station === st ? 'on' : ''}`}
                    onClick={() =>
                      apply({
                        op: 'upsert',
                        col: 'planItems',
                        row: { ...item, station: item.station === st ? null : st },
                      })
                    }
                  >
                    {STATION_LABEL[st]}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
