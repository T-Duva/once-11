import { median } from './median'
import type { Database, PurchaseLine, Station } from '../types'

export function productHistory(db: Database, productId: string): number[] {
  return db.purchaseLines
    .filter((l) => l.productId === productId && l.actualQty > 0)
    .map((l) => l.actualQty)
}

export function productMedian(db: Database, productId: string): number | null {
  return median(productHistory(db, productId))
}

export function lastPurchasedQty(db: Database, productId: string): number | null {
  const lines = db.purchaseLines
    .filter((l) => l.productId === productId && l.actualQty > 0)
    .map((l) => {
      const order = db.orders.find((o) => o.id === l.orderId)
      return { qty: l.actualQty, date: order?.date ?? '', at: order?.createdAt ?? 0 }
    })
    .sort((a, b) => (a.date === b.date ? b.at - a.at : b.date.localeCompare(a.date)))
  return lines[0]?.qty ?? null
}

export function lineHasPurchase(l: PurchaseLine): boolean {
  return l.actualQty > 0 || l.unitPrice > 0 || l.totalPrice > 0
}

export function splitTotal(l: PurchaseLine): number {
  return l.split.madro + l.split.ligux + l.split.elugas
}

export function lineCostForStation(l: PurchaseLine, station: Station): number {
  const qty = l.split[station] || 0
  if (qty <= 0) return 0
  const parts = splitTotal(l)
  if (l.totalManual && parts > 0) return (l.totalPrice * qty) / parts
  if (l.unitPrice > 0) return qty * l.unitPrice
  if (l.actualQty > 0 && l.totalPrice > 0) return (l.totalPrice * qty) / l.actualQty
  return 0
}

export function lineTotal(l: PurchaseLine): number {
  if (l.totalManual) return l.totalPrice || 0
  if (l.unitPrice > 0 && l.actualQty > 0) return l.unitPrice * l.actualQty
  return l.totalPrice || 0
}

export function orderSpent(db: Database, orderId: string): number {
  return db.purchaseLines
    .filter((l) => l.orderId === orderId && lineHasPurchase(l))
    .reduce((s, l) => s + lineTotal(l), 0)
}

export function stationSpentInOrder(db: Database, orderId: string, station: Station): number {
  return db.purchaseLines
    .filter((l) => l.orderId === orderId && lineHasPurchase(l))
    .reduce((s, l) => s + lineCostForStation(l, station), 0)
}

export function orderIsPurchased(db: Database, orderId: string): boolean {
  return db.purchaseLines.some((l) => l.orderId === orderId && lineHasPurchase(l))
}
