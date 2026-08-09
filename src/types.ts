export type UserId = 'tomas' | 'martin'
export type Station = 'madro' | 'ligux' | 'elugas'
export type Screen = 'home' | 'plan' | 'buy' | 'split' | 'accounts' | 'audit'
export type OrderStatus = 'planificando' | 'comprando' | 'repartiendo'
export type WatcherStatus = 'online' | 'working' | 'stuck' | 'off'

export const STATIONS: Station[] = ['madro', 'ligux', 'elugas']

export const STATION_LABEL: Record<Station, string> = {
  madro: 'Madro',
  ligux: 'Ligux',
  elugas: 'Elugas',
}

export const USER_LABEL: Record<UserId, string> = {
  tomas: 'Tomás',
  martin: 'Martín',
}

export interface Product {
  id: string
  name: string
  createdBy: UserId
  createdAt: number
}

export interface Order {
  id: string
  date: string
  budget: number
  status: OrderStatus
  createdBy: UserId
  createdAt: number
  distributeDate?: string
}

export interface PlanItem {
  id: string
  orderId: string
  productId: string
  qty: number
  station: Station | null
}

export interface PurchaseLine {
  id: string
  orderId: string
  productId: string
  plannedQty: number
  actualQty: number
  unitPrice: number
  totalPrice: number
  totalManual: boolean
  address: string
  notes: string
  split: Record<Station, number>
}

export interface Payment {
  id: string
  station: Station
  date: string
  amount: number
  orderId?: string
  createdBy: UserId
  createdAt: number
}

export interface AuditEntry {
  id: string
  user: UserId
  at: number
  orderId?: string
  field: string
  before: unknown
  after: unknown
}

export interface Report {
  id: string
  user: UserId
  text: string
  screen: Screen
  orderId?: string
  version: string
  at: number
  status: 'nuevo' | 'notificado' | 'hecho' | 'error'
  note?: string
}

export interface Presence {
  user: UserId
  screen: Screen
  orderId?: string
  fieldId?: string | null
  updatedAt: number
}

export interface WatcherState {
  status: WatcherStatus
  lastSeenAt: number
  currentReportId?: string
  error?: string
}

export interface NotificationItem {
  id: string
  to: UserId
  title: string
  body: string
  at: number
  read: boolean
}

export interface Database {
  products: Product[]
  orders: Order[]
  planItems: PlanItem[]
  purchaseLines: PurchaseLine[]
  payments: Payment[]
  audit: AuditEntry[]
  reports: Report[]
  notifications: NotificationItem[]
}

export function emptyDb(): Database {
  return {
    products: [],
    orders: [],
    planItems: [],
    purchaseLines: [],
    payments: [],
    audit: [],
    reports: [],
    notifications: [],
  }
}

export type Patch =
  | { op: 'upsert'; col: keyof Database; row: Database[keyof Database][number] }
  | { op: 'remove'; col: keyof Database; id: string }
  | { op: 'replace'; db: Database }
