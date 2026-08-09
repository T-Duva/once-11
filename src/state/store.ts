import { create } from 'zustand'
import { emptyDb, type Database, type Patch, type Presence, type Screen, type UserId, type WatcherState } from '../types'
import { createSync } from '../sync/client'
import { APP_VERSION } from '../version'

type SyncHandle = ReturnType<typeof createSync> | null

interface AppStore {
  user: UserId | null
  screen: Screen
  orderId: string | null
  db: Database
  watcher: WatcherState
  presence: Presence[]
  connected: boolean
  focusField: string | null
  vapidPublicKey: string
  reportOpen: boolean
  toast: string | null
  login: (user: UserId) => void
  logout: () => void
  setScreen: (s: Screen) => void
  setOrderId: (id: string | null) => void
  setFocus: (id: string | null) => void
  setReportOpen: (v: boolean) => void
  clearToast: () => void
  apply: (patch: Patch) => void
  sendReport: (text: string) => void
  markNotifRead: (id: string) => void
}

let sync: SyncHandle = null
let presenceTimer: ReturnType<typeof setInterval> | undefined

function persistUser(user: UserId | null) {
  if (user) localStorage.setItem('once11.user', user)
  else localStorage.removeItem('once11.user')
}

export const useApp = create<AppStore>((set, get) => ({
  user: null,
  screen: 'home',
  orderId: localStorage.getItem('once11.order') || null,
  db: emptyDb(),
  watcher: { status: 'off', lastSeenAt: 0 },
  presence: [],
  connected: false,
  focusField: null,
  vapidPublicKey: '',
  reportOpen: false,
  toast: null,

  login(user) {
    persistUser(user)
    sync?.stop()
    set({ user, screen: 'home' })
    sync = createSync(user, {
      onDb: (db) => set({ db }),
      onWatcher: (watcher) => set({ watcher }),
      onPresence: (presence) => set({ presence }),
      onVapid: async (vapidPublicKey) => {
        set({ vapidPublicKey })
        try {
          await registerPush(user, vapidPublicKey, (msg) => sync?.send(msg))
        } catch {
          /* permiso denegado: igual anda in-app */
        }
      },
      onStatus: (connected) => set({ connected }),
    })
    clearInterval(presenceTimer)
    presenceTimer = setInterval(() => {
      const s = get()
      if (!s.user || !sync) return
      sync.send({
        type: 'presence',
        presence: {
          user: s.user,
          screen: s.screen,
          orderId: s.orderId ?? undefined,
          fieldId: s.focusField,
          updatedAt: Date.now(),
        },
      })
    }, 2000)
  },

  logout() {
    persistUser(null)
    sync?.stop()
    sync = null
    clearInterval(presenceTimer)
    set({ user: null, connected: false, watcher: { status: 'off', lastSeenAt: 0 }, db: emptyDb() })
  },

  setScreen(screen) {
    set({ screen, focusField: null })
  },

  setOrderId(orderId) {
    if (orderId) localStorage.setItem('once11.order', orderId)
    else localStorage.removeItem('once11.order')
    set({ orderId })
  },

  setFocus(focusField) {
    set({ focusField })
  },

  setReportOpen(reportOpen) {
    set({ reportOpen })
  },

  clearToast() {
    set({ toast: null })
  },

  apply(patch) {
    const user = get().user
    if (!user || !sync) return
    sync.send({ type: 'patch', patch, user })
  },

  sendReport(text) {
    const s = get()
    if (!s.user || !sync) return
    sync.send({
      type: 'report',
      user: s.user,
      text,
      screen: s.screen,
      orderId: s.orderId ?? undefined,
      version: APP_VERSION,
    })
    set({ reportOpen: false, toast: 'Reporte enviado' })
  },

  markNotifRead(id) {
    const n = get().db.notifications.find((x) => x.id === id)
    if (!n) return
    get().apply({ op: 'upsert', col: 'notifications', row: { ...n, read: true } })
  },
}))

async function registerPush(
  user: UserId,
  vapidPublicKey: string,
  send: (msg: { type: 'push-sub'; user: UserId; subscription: PushSubscriptionJSON }) => void,
) {
  if (!('serviceWorker' in navigator) || !vapidPublicKey) return
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  })
  send({ type: 'push-sub', user, subscription: sub.toJSON() })
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function otherUser(me: UserId): UserId {
  return me === 'tomas' ? 'martin' : 'tomas'
}
