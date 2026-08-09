import { emptyDb, type Database, type Patch, type Presence, type UserId, type WatcherState } from '../types'

export type ServerMsg =
  | { type: 'hello'; db: Database; watcher: WatcherState; presence: Presence[]; vapidPublicKey: string }
  | { type: 'db'; db: Database }
  | { type: 'watcher'; watcher: WatcherState }
  | { type: 'presence'; presence: Presence[] }
  | { type: 'error'; message: string }

export type ClientMsg =
  | { type: 'patch'; patch: Patch; user: UserId }
  | { type: 'presence'; presence: Presence }
  | { type: 'report'; user: UserId; text: string; screen: Presence['screen']; orderId?: string; version: string }
  | { type: 'push-sub'; user: UserId; subscription: PushSubscriptionJSON }

type Handlers = {
  onDb: (db: Database) => void
  onWatcher: (w: WatcherState) => void
  onPresence: (p: Presence[]) => void
  onVapid: (key: string) => void
  onStatus: (connected: boolean) => void
}

export function createSync(user: UserId, handlers: Handlers, origin: string) {
  let ws: WebSocket | null = null
  let stopped = false
  let retry = 0
  let ping: ReturnType<typeof setInterval> | undefined

  const connect = () => {
    if (stopped) return
    const base = new URL(origin)
    const proto = base.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${base.host}/ws?user=${user}`
    ws = new WebSocket(url)

    ws.onopen = () => {
      retry = 0
      handlers.onStatus(true)
    }

    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg
      if (msg.type === 'hello') {
        handlers.onDb(msg.db)
        handlers.onWatcher(msg.watcher)
        handlers.onPresence(msg.presence)
        handlers.onVapid(msg.vapidPublicKey)
      } else if (msg.type === 'db') handlers.onDb(msg.db)
      else if (msg.type === 'watcher') handlers.onWatcher(msg.watcher)
      else if (msg.type === 'presence') handlers.onPresence(msg.presence)
    }

    ws.onclose = () => {
      handlers.onStatus(false)
      handlers.onWatcher({ status: 'off', lastSeenAt: 0 })
      if (stopped) return
      const wait = Math.min(8000, 600 * 2 ** retry++)
      setTimeout(connect, wait)
    }

    ws.onerror = () => ws?.close()
  }

  connect()
  ping = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
  }, 8000)

  return {
    send(msg: ClientMsg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    },
    stop() {
      stopped = true
      clearInterval(ping)
      ws?.close()
    },
  }
}

export function seedDb(): Database {
  return emptyDb()
}
