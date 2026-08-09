import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import webpush from 'web-push'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataDir = path.join(root, 'data')
const inboxDir = path.join(root, 'inbox')
const dbPath = path.join(dataDir, 'db.json')
const vapidPath = path.join(__dirname, 'vapid.json')
const subsPath = path.join(dataDir, 'push-subs.json')
const PORT = Number(process.env.PORT || 8787)

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(inboxDir, { recursive: true })

function emptyDb() {
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

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

if (!fs.existsSync(vapidPath)) {
  saveJson(vapidPath, webpush.generateVAPIDKeys())
}
const vapid = loadJson(vapidPath, null)
webpush.setVapidDetails('mailto:once11@local', vapid.publicKey, vapid.privateKey)

let db = loadJson(dbPath, emptyDb())
let subs = loadJson(subsPath, { tomas: null, martin: null })
let watcher = { status: 'online', lastSeenAt: Date.now(), currentReportId: undefined, error: undefined }

const app = express()
app.use(cors({ origin: true }))
app.use(express.json({ limit: '1mb' }))
const apkPath = path.join(root, 'once-11.apk')
app.get('/once-11.apk', (_req, res) => {
  if (!fs.existsSync(apkPath)) return res.status(404).send('APK todavía no está listo')
  res.download(apkPath, 'Once11.apk')
})

const dist = path.join(root, 'dist')
function appVersion() {
  return loadJson(path.join(root, 'package.json'), { version: '0.0.0' }).version || '0.0.0'
}

if (fs.existsSync(dist)) {
  app.use(
    express.static(dist, {
      setHeaders(res, filePath) {
        if (/\.(html|webmanifest|js)$/i.test(filePath) && /index\.html|sw\.js|manifest\.webmanifest$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }),
  )
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api') || req.path === '/once-11.apk') return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: appVersion(), watcher })
})
app.get('/api/vapid', (_req, res) => {
  res.json({ publicKey: vapid.publicKey })
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set()

function persist() {
  saveJson(dbPath, db)
}

function broadcast(msg, except) {
  const raw = JSON.stringify(msg)
  for (const c of clients) {
    if (c !== except && c.ws.readyState === 1) c.ws.send(raw)
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}

function presenceList() {
  const now = Date.now()
  return [...clients]
    .filter((c) => c.presence && now - c.presence.updatedAt < 15000)
    .map((c) => c.presence)
}

function setWatcher(partial) {
  watcher = { ...watcher, ...partial, lastSeenAt: Date.now() }
  broadcast({ type: 'watcher', watcher })
}

function findRow(col, id) {
  return db[col].find((r) => r.id === id)
}

function applyPatch(patch, user) {
  if (patch.op === 'replace') {
    db = patch.db
    persist()
    return
  }
  if (patch.op === 'remove') {
    const before = findRow(patch.col, patch.id)
    db[patch.col] = db[patch.col].filter((r) => r.id !== patch.id)
    db.audit.unshift({
      id: crypto.randomUUID(),
      user,
      at: Date.now(),
      field: `${patch.col}.delete`,
      before,
      after: null,
      orderId: before?.orderId,
    })
    db.audit = db.audit.slice(0, 500)
    persist()
    return
  }
  if (patch.op === 'upsert') {
    const col = patch.col
    const row = patch.row
    const idx = db[col].findIndex((r) => r.id === row.id)
    const before = idx >= 0 ? db[col][idx] : null
    if (idx >= 0) db[col][idx] = row
    else db[col].unshift(row)
    const changed = diffFields(before, row)
    for (const field of changed) {
      db.audit.unshift({
        id: crypto.randomUUID(),
        user,
        at: Date.now(),
        field: `${col}.${field}`,
        before: before ? before[field] : null,
        after: row[field],
        orderId: row.orderId,
      })
    }
    if (!before) {
      db.audit.unshift({
        id: crypto.randomUUID(),
        user,
        at: Date.now(),
        field: `${col}.create`,
        before: null,
        after: row.name || row.id,
        orderId: row.orderId,
      })
    }
    db.audit = db.audit.slice(0, 500)
    persist()
  }
}

function diffFields(before, after) {
  if (!before) return []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out = []
  for (const k of keys) {
    if (k === 'id') continue
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(k)
  }
  return out
}

async function handleReport(report, client) {
  setWatcher({ status: 'working', currentReportId: report.id, error: undefined })
  db.reports.unshift(report)
  persist()
  broadcast({ type: 'db', db })

  const file = path.join(inboxDir, `${Date.now()}-${report.user}.md`)
  fs.writeFileSync(
    file,
    `# Reporte ${report.user}\n\n- fecha: ${new Date(report.at).toISOString()}\n- pantalla: ${report.screen}\n- orden: ${report.orderId || '-'}\n- version: ${report.version}\n\n${report.text}\n`,
  )

  try {
    if (report.user === 'martin') {
      const title = 'Martín reportó'
      const body = report.text.slice(0, 180)
      notifyWindows(title, body)
      const notif = {
        id: crypto.randomUUID(),
        to: 'tomas',
        title,
        body,
        at: Date.now(),
        read: false,
      }
      db.notifications.unshift(notif)
      report.status = 'notificado'
      report.note = 'Aviso enviado a Tomás'
      await sendPush('tomas', title, body)
    } else {
      notifyWindows('Orden de Tomás', report.text.slice(0, 180))
      report.status = 'hecho'
      report.note = `Encolado en inbox: ${path.basename(file)}`
    }
    const idx = db.reports.findIndex((r) => r.id === report.id)
    if (idx >= 0) db.reports[idx] = report
    persist()
    broadcast({ type: 'db', db })
    setWatcher({ status: 'online', currentReportId: undefined })
  } catch (err) {
    report.status = 'error'
    report.note = String(err?.message || err)
    persist()
    broadcast({ type: 'db', db })
    setWatcher({ status: 'stuck', error: report.note, currentReportId: report.id })
  }
  send(client.ws, { type: 'db', db })
}

async function sendPush(user, title, body) {
  const sub = subs[user]
  if (!sub) return
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body }))
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      subs[user] = null
      saveJson(subsPath, subs)
    }
  }
}

function notifyWindows(title, message) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.NotifyIcon].GetConstructors() | Out-Null;
[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;
[System.Windows.Forms.MessageBox]::Show('${esc(message).slice(0, 200)}','${esc(title)}')`
  // toast sin bloquear: balloon via powershell
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName('text')
$texts.Item(0).AppendChild($xml.CreateTextNode('${esc(title)}')) | Out-Null
$texts.Item(1).AppendChild($xml.CreateTextNode('${esc(message).slice(0, 180)}')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Once 11').Show($toast)
`
  import('node:child_process').then(({ spawn }) => {
    spawn('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', windowsHide: true })
  }).catch(() => {})
  void ps
}

function esc(s) {
  return String(s || '').replace(/'/g, "''").replace(/[`$]/g, '')
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost')
  const user = url.searchParams.get('user') === 'martin' ? 'martin' : 'tomas'
  const client = { ws, user, presence: null }
  clients.add(client)
  setWatcher({ status: watcher.status === 'stuck' ? 'stuck' : 'online' })
  send(ws, {
    type: 'hello',
    db,
    watcher,
    presence: presenceList(),
    vapidPublicKey: vapid.publicKey,
  })
  broadcast({ type: 'presence', presence: presenceList() }, ws)

  ws.on('message', async (buf) => {
    let msg
    try {
      msg = JSON.parse(String(buf))
    } catch {
      return
    }
    if (msg.type === 'ping') {
      setWatcher({ status: watcher.status === 'working' || watcher.status === 'stuck' ? watcher.status : 'online' })
      return
    }
    if (msg.type === 'presence') {
      client.presence = { ...msg.presence, user, updatedAt: Date.now() }
      broadcast({ type: 'presence', presence: presenceList() })
      return
    }
    if (msg.type === 'push-sub') {
      subs[user] = msg.subscription
      saveJson(subsPath, subs)
      return
    }
    if (msg.type === 'patch') {
      applyPatch(msg.patch, user)
      broadcast({ type: 'db', db })
      return
    }
    if (msg.type === 'report') {
      const report = {
        id: crypto.randomUUID(),
        user,
        text: String(msg.text || '').trim(),
        screen: msg.screen || 'home',
        orderId: msg.orderId,
        version: msg.version || '1.0.0',
        at: Date.now(),
        status: 'nuevo',
      }
      if (!report.text) return
      await handleReport(report, client)
    }
  })

  ws.on('close', () => {
    clients.delete(client)
    broadcast({ type: 'presence', presence: presenceList() })
  })
})

setInterval(() => {
  if (watcher.status === 'working' && Date.now() - watcher.lastSeenAt > 3 * 60 * 1000) {
    setWatcher({ status: 'stuck', error: 'El reporte lleva más de 3 minutos' })
  } else if (watcher.status !== 'stuck' && watcher.status !== 'working') {
    setWatcher({ status: 'online' })
  } else {
    watcher.lastSeenAt = Date.now()
    broadcast({ type: 'watcher', watcher })
  }
}, 5000)

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Once 11 v${appVersion()} → http://127.0.0.1:${PORT}`)
})
