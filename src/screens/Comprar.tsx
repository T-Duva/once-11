import { useEffect, useMemo, useRef, useState } from 'react'
import { DateBar } from '../components/DateBar'
import { FocusField } from '../components/FocusField'
import { money, moneyDec } from '../lib/format'
import { lineTotal, orderSpent } from '../lib/stats'
import { useApp } from '../state/store'
import { STATIONS, STATION_LABEL, type PurchaseLine, type Station } from '../types'

export function Comprar() {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const orderId = useApp((s) => s.orderId)
  const apply = useApp((s) => s.apply)
  const [q, setQ] = useState('')

  const order = db.orders.find((o) => o.id === orderId)
  const plans = db.planItems.filter((p) => p.orderId === orderId)
  const lines = db.purchaseLines.filter((l) => l.orderId === orderId)

  const seededKeys = useRef(new Set<string>())
  useEffect(() => {
    seededKeys.current = new Set()
  }, [orderId])
  useEffect(() => {
    if (!orderId || !user) return
    for (const p of plans) {
      const key = `${orderId}:${p.productId}`
      if (seededKeys.current.has(key) || lines.some((l) => l.productId === p.productId)) {
        seededKeys.current.add(key)
        continue
      }
      seededKeys.current.add(key)
      const split = emptySplit()
      if (p.station) split[p.station] = p.qty || 0
      apply({
        op: 'upsert',
        col: 'purchaseLines',
        row: {
          id: crypto.randomUUID(),
          orderId,
          productId: p.productId,
          plannedQty: p.qty || 0,
          actualQty: 0,
          unitPrice: 0,
          totalPrice: 0,
          totalManual: false,
          address: '',
          notes: '',
          split,
        },
      })
    }
  }, [orderId, user, plans, lines, apply])

  const query = q.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!query) return []
    return db.products.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 8)
  }, [db.products, query])

  const spent = order ? orderSpent(db, order.id) : 0
  const rest = (order?.budget || 0) - spent

  const addLine = (productId: string, planned = 0) => {
    if (!orderId || lines.some((l) => l.productId === productId)) {
      setQ('')
      return
    }
    const plan = plans.find((p) => p.productId === productId)
    const split = emptySplit()
    if (plan?.station) split[plan.station] = plan.qty || planned
    apply({
      op: 'upsert',
      col: 'purchaseLines',
      row: {
        id: crypto.randomUUID(),
        orderId,
        productId,
        plannedQty: plan?.qty ?? planned,
        actualQty: 0,
        unitPrice: 0,
        totalPrice: 0,
        totalManual: false,
        address: '',
        notes: '',
        split,
      },
    })
    setQ('')
  }

  const createAndAdd = () => {
    if (!user || !orderId || !q.trim()) return
    const name = q.trim()
    const found = db.products.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (found) {
      addLine(found.id)
      return
    }
    const id = crypto.randomUUID()
    apply({ op: 'upsert', col: 'products', row: { id, name, createdBy: user, createdAt: Date.now() } })
    addLine(id)
  }

  if (!order) {
    return (
      <div className="page">
        <DateBar />
        <p className="empty">Elegí la fecha de esta compra arriba.</p>
      </div>
    )
  }

  return (
    <div className="page buy-page">
      <DateBar
        extra={
          <FocusField id={`budget-${order.id}`}>
            <label className="budget">
              Presupuesto
              <input
                inputMode="decimal"
                value={order.budget || ''}
                onChange={(e) =>
                  apply({
                    op: 'upsert',
                    col: 'orders',
                    row: { ...order, budget: Number(e.target.value.replace(',', '.')) || 0, status: 'comprando' },
                  })
                }
              />
            </label>
          </FocusField>
        }
      />

      <FocusField id="buy-search">
        <label className="search">
          Buscador
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Producto…" />
        </label>
      </FocusField>
      {query && (
        <ul className="suggest">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => addLine(p.id)}>
                {p.name}
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={createAndAdd}>
              Agregar “{q.trim()}”
            </button>
          </li>
        </ul>
      )}

      <ul className="cards">
        {lines.map((line) => {
          const prod = db.products.find((p) => p.id === line.productId)
          return (
            <li key={line.id} className="card">
              <div className="card-top">
                <h3>{prod?.name ?? 'Producto'}</h3>
                <button type="button" className="icon-x" onClick={() => apply({ op: 'remove', col: 'purchaseLines', id: line.id })}>
                  ×
                </button>
              </div>
              <div className="grid2">
                <FocusField id={`buy-plan-${line.id}`}>
                  <label>
                    A comprar
                    <input
                      inputMode="decimal"
                      value={line.plannedQty || ''}
                      onChange={(e) => patchLine(apply, line, { plannedQty: num(e.target.value) })}
                    />
                  </label>
                </FocusField>
                <FocusField id={`buy-real-${line.id}`}>
                  <label>
                    Compré
                    <input
                      inputMode="decimal"
                      value={line.actualQty || ''}
                      onChange={(e) => {
                        const actualQty = num(e.target.value)
                        const totalPrice = line.totalManual ? line.totalPrice : actualQty * (line.unitPrice || 0)
                        patchLine(apply, line, { actualQty, totalPrice })
                      }}
                    />
                  </label>
                </FocusField>
                <FocusField id={`buy-unit-${line.id}`}>
                  <label>
                    Precio u.
                    <input
                      inputMode="decimal"
                      value={line.unitPrice || ''}
                      onChange={(e) => {
                        const unitPrice = num(e.target.value)
                        const totalPrice = line.totalManual ? line.totalPrice : unitPrice * (line.actualQty || 0)
                        patchLine(apply, line, { unitPrice, totalPrice })
                      }}
                    />
                  </label>
                </FocusField>
                <FocusField id={`buy-total-${line.id}`}>
                  <label>
                    Total
                    <input
                      inputMode="decimal"
                      value={line.totalPrice || ''}
                      onChange={(e) => patchLine(apply, line, { totalPrice: num(e.target.value), totalManual: true })}
                    />
                  </label>
                </FocusField>
              </div>
              <FocusField id={`buy-addr-${line.id}`}>
                <label>
                  Dirección
                  <input value={line.address} onChange={(e) => patchLine(apply, line, { address: e.target.value })} />
                </label>
              </FocusField>
              <FocusField id={`buy-notes-${line.id}`}>
                <label>
                  Observaciones
                  <input
                    value={line.notes}
                    placeholder="Local de la china…"
                    onChange={(e) => patchLine(apply, line, { notes: e.target.value })}
                  />
                </label>
              </FocusField>
              <p className="split-label">Reparto</p>
              <div className="split-grid">
                {STATIONS.map((st) => (
                  <FocusField key={st} id={`buy-split-${st}-${line.id}`}>
                    <label className={`st-in ${st}`}>
                      {STATION_LABEL[st]}
                      <input
                        inputMode="decimal"
                        value={line.split[st] || ''}
                        onChange={(e) =>
                          patchLine(apply, line, { split: { ...line.split, [st]: num(e.target.value) } })
                        }
                      />
                    </label>
                  </FocusField>
                ))}
              </div>
              <p className="muted mini">Subtotal línea {moneyDec(lineTotal(line))}</p>
            </li>
          )
        })}
      </ul>

      <div className="totals-dock">
        <div>
          <span>Total compra</span>
          <strong>{money(spent)}</strong>
        </div>
        <div className={rest < 0 ? 'neg' : ''}>
          <span>Resta presupuesto</span>
          <strong>{money(rest)}</strong>
        </div>
      </div>
    </div>
  )
}

function emptySplit(): Record<Station, number> {
  return { madro: 0, ligux: 0, elugas: 0 }
}

function num(v: string) {
  return Number(v.replace(',', '.')) || 0
}

function patchLine(apply: (p: { op: 'upsert'; col: 'purchaseLines'; row: PurchaseLine }) => void, line: PurchaseLine, part: Partial<PurchaseLine>) {
  apply({ op: 'upsert', col: 'purchaseLines', row: { ...line, ...part } })
}
