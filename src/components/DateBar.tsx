import { useEffect, useState, type ReactNode } from 'react'
import { formatDateISO, parseISO, toISODate } from '../lib/format'
import { useApp } from '../state/store'
import type { Order, UserId } from '../types'

export function DateBar({ extra }: { extra?: ReactNode }) {
  const db = useApp((s) => s.db)
  const user = useApp((s) => s.user)
  const orderId = useApp((s) => s.orderId)
  const setOrderId = useApp((s) => s.setOrderId)
  const apply = useApp((s) => s.apply)
  const order = db.orders.find((o) => o.id === orderId)
  const parsed = order ? parseISO(order.date) : parseISO(todayISO())
  const [day, setDay] = useState(String(parsed.day))
  const [month, setMonth] = useState(String(parsed.month))
  const [year, setYear] = useState(parsed.year)

  useEffect(() => {
    const o = db.orders.find((x) => x.id === orderId)
    const p = o ? parseISO(o.date) : parseISO(todayISO())
    setDay(String(p.day))
    setMonth(String(p.month))
    setYear(p.year)
  }, [orderId, db.orders])

  const commit = () => {
    const d = clamp(Number(day), 1, 31)
    const m = clamp(Number(month), 1, 12)
    const y = year || new Date().getFullYear()
    const iso = toISODate(d, m, y)
    const existing = db.orders.find((o) => o.date === iso)
    if (existing) {
      setOrderId(existing.id)
      return
    }
    if (!user) return
    const created = makeOrder(iso, user)
    apply({ op: 'upsert', col: 'orders', row: created })
    setOrderId(created.id)
  }

  return (
    <div className="datebar">
      <label className="date-edit">
        <span>Fecha</span>
        <span className="date-inputs">
          <input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} onBlur={commit} />
          <span>/</span>
          <input inputMode="numeric" value={month} onChange={(e) => setMonth(e.target.value.replace(/\D/g, '').slice(0, 2))} onBlur={commit} />
          <span>/</span>
          <input
            className="year-in"
            inputMode="numeric"
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || new Date().getFullYear())}
            onBlur={commit}
          />
        </span>
      </label>
      {order && <span className="date-preview">{formatDateISO(order.date)}</span>}
      {extra}
    </div>
  )
}

export function todayISO(): string {
  const n = new Date()
  const dd = String(n.getDate()).padStart(2, '0')
  const mm = String(n.getMonth() + 1).padStart(2, '0')
  return `${n.getFullYear()}-${mm}-${dd}`
}

export function makeOrder(iso: string, user: UserId): Order {
  return {
    id: crypto.randomUUID(),
    date: iso,
    budget: 0,
    status: 'planificando',
    createdBy: user,
    createdAt: Date.now(),
  }
}

function clamp(n: number, a: number, b: number) {
  if (!Number.isFinite(n)) return a
  return Math.min(b, Math.max(a, n))
}
