import type { Station } from '../types'
import { STATION_LABEL } from '../types'

export function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v)
}

export function moneyDec(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(v)
}

export function formatDateISO(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

export function toISODate(day: number, month: number, year: number): string {
  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export function parseISO(iso: string): { day: number; month: number; year: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { day: d || 1, month: m || 1, year: y || new Date().getFullYear() }
}

export function stationName(s: Station): string {
  return STATION_LABEL[s]
}

export function qtyLabel(n: number | null): string {
  if (n === null || Number.isNaN(n)) return 'sin datos'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(1).replace('.', ',')
}
