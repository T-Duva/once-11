import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import webpush from 'web-push'
import { forceTouchMiddleware } from 'file:///E:/escuchadores-bot/tools/force-idle.mjs'
import { assertNotReposicionPort } from 'file:///E:/escuchadores-bot/tools/port-lock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataDir = path.join(root, 'data')
const inboxDir = path.join(root, 'inbox')
const dbPath = path.join(dataDir, 'db.json')
const metaPath = path.join(dataDir, 'db-meta.json')
const vapidPath = path.join(__dirname, 'vapid.json')
const subsPath = path.join(dataDir, 'push-subs.json')
const PORT = Number(process.env.PORT || 8787)
assertNotReposicionPort('once11', PORT)
const TOMAS_PRODUCT_ID = '57ff9d9c-b373-40cf-bf3b-12b8e1593e20'

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(inboxDir, { recursive: true })

function emptyDb() {
  return {
    products: [],
    orders: [],
    planItems: [],
    purchaseLines: [],
    placeDiscounts: [],
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

function sendApiJson(req, res, obj) {
  const raw = Buffer.from(JSON.stringify(obj))
  const enc = String(req.headers['accept-encoding'] || '')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (enc.includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip')
    res.end(zlib.gzipSync(raw))
    return
  }
  res.end(raw)
}

if (!fs.existsSync(vapidPath)) {
  saveJson(vapidPath, webpush.generateVAPIDKeys())
}
const vapid = loadJson(vapidPath, null)
webpush.setVapidDetails('mailto:once11@local', vapid.publicKey, vapid.privateKey)

let db = loadJson(dbPath, emptyDb())
let dbMeta = loadJson(metaPath, { dbRevision: 0 })
if (!Number.isFinite(Number(dbMeta.dbRevision))) dbMeta = { dbRevision: 0 }
function dedupeOrdersByDate() {
  const seen = new Set()
  const keep = []
  for (const o of db.orders || []) {
    if (seen.has(o.date)) {
      db.planItems = (db.planItems || []).filter((p) => p.orderId !== o.id)
      db.purchaseLines = (db.purchaseLines || []).filter((p) => p.orderId !== o.id)
      db.placeDiscounts = (db.placeDiscounts || []).filter((p) => p.orderId !== o.id)
      db.payments = (db.payments || []).filter((p) => p.orderId !== o.id)
      continue
    }
    seen.add(o.date)
    keep.push(o)
  }
  db.orders = keep
}
const orderCount = (db.orders || []).length
dedupeOrdersByDate()
if (!Array.isArray(db.orders)) db = emptyDb()
if (!Array.isArray(db.placeDiscounts)) {
  db.placeDiscounts = []
  persist()
}
if (db.orders.length !== orderCount) persist()
// NUNCA auto-restaurar borrados desde audit: eso devolvía filas que Tomás ya sacó.
if (sanitizeSkipPurchase()) {
  console.log('skipPurchase limpiado: productos con datos ya no se ocultan')
  persist()
}
if (dedupePurchaseLines()) {
  console.log('purchaseLines deduplicadas')
  persist()
}
if (repairOrphanProducts()) {
  console.log('productos huérfanos reparados')
  persist()
}
{
  // Sacá ruido del Log (updatedAt/updatedBy) que tapaba lo que cargó cada uno.
  const beforeAudit = (db.audit || []).length
  db.audit = (db.audit || [])
    .filter((a) => a && !/\.(updatedAt|updatedBy)$/.test(String(a.field || '')))
    .slice(0, 1200)
  if (db.audit.length !== beforeAudit) {
    console.log(`audit limpio: ${beforeAudit} → ${db.audit.length}`)
    persist()
  }
}
{
  const before = (db.notifications || []).length
  db.notifications = (db.notifications || []).filter(
    (n) => {
      const t = String(n.title || '')
      if (/cambi[oó]\s+datos/i.test(t)) return false
      if (/^Actualiz[aá]/i.test(t)) return false
      return true
    },
  )
  if (db.notifications.length !== before) {
    console.log(`avisos en pantalla quitados: ${before - db.notifications.length}`)
    persist()
  }
}
let subs = loadJson(subsPath, { tomas: null, martin: null, nacho: null, sole: null })
let watcher = { status: 'off', lastSeenAt: 0, currentReportId: undefined, error: undefined, pendingCount: 0 }
let lastBeatAt = 0
let workingSince = 0

const app = express()
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, bypass-tunnel-reminder')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(cors({ origin: true }))
app.use(forceTouchMiddleware('once11'))
app.use(express.json({ limit: '12mb' }))
const httpPresence = new Map()
const apkPath = path.join(root, 'once-11.apk')
app.get('/once-11.apk', (_req, res) => {
  if (!fs.existsSync(apkPath)) return res.status(404).send('APK todavía no está listo')
  res.download(apkPath, 'Once11.apk')
})

/** IPA nativo iPhone (mismo rol que el APK en Android). */
const ipaPath = path.join(root, 'once-11.ipa')
app.get('/once-11.ipa', (_req, res) => {
  if (!fs.existsSync(ipaPath)) return res.status(404).send('IPA todavía no está listo')
  res.download(ipaPath, 'Once11.ipa')
})

function publicBaseUrl(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim()
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim()
  if (!host) return ''
  return `${proto}://${host}`.replace(/\/$/, '')
}

/** Manifest OTA: Safari en iPhone abre itms-services y descarga la app (no es página web). */
app.get('/ios/manifest.plist', (req, res) => {
  if (!fs.existsSync(ipaPath)) return res.status(404).send('IPA todavía no está listo')
  const base = publicBaseUrl(req)
  if (!base) return res.status(500).send('Sin host público')
  const ver = versionFromMarkerFiles()
  const ipaUrl = `${base}/once-11.ipa`
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${ipaUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>com.once11.app</string>
        <key>bundle-version</key>
        <string>${ver}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>Once 11</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.send(plist)
})

app.get('/ios/install', (req, res) => {
  if (!fs.existsSync(ipaPath)) {
    return res.status(404).type('html').send(
      '<!doctype html><meta charset="utf-8"><title>Once 11 iPhone</title>' +
        '<body style="font-family:sans-serif;background:#070708;color:#f4efe4;padding:2rem">' +
        '<p>La app de iPhone todavía no tiene el archivo instalable listo.</p></body>',
    )
  }
  const base = publicBaseUrl(req)
  if (!base) return res.status(500).send('Sin host público')
  const manifest = `${base}/ios/manifest.plist`
  const itms = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifest)}`
  res.redirect(302, itms)
})

const dist = path.join(root, 'dist')
function appVersion() {
  return loadJson(path.join(root, 'package.json'), { version: '0.0.0' }).version || '0.0.0'
}

/** El cartel de actualizar usa /api/health.version = última release de GitHub. */
function versionFromMarkerFiles() {
  const raw =
    loadJson(path.join(root, 'version.json'), null)?.version ||
    loadJson(path.join(root, 'package.json'), { version: '0.0.0' }).version ||
    '0.0.0'
  const m = String(raw).match(/^\d+\.\d+\.\d+/)
  return m ? m[0] : '0.0.0'
}
let publishedApk = versionFromMarkerFiles()
let publishedAt = 0
let lastNotifiedApkVersion = ''
function apkVersionForPhone() {
  return publishedApk
}
function apkVersionParts(v) {
  return String(v || '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
    ?.slice(1, 4)
    .map((x) => Number.parseInt(x, 10) || 0) || [0, 0, 0]
}
function isNewerApkVersion(remote, local) {
  const a = apkVersionParts(remote)
  const b = apkVersionParts(local)
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}
function applyPublishedApkTag(tag) {
  const clean = String(tag || '')
    .replace(/^v/i, '')
    .trim()
  const m = clean.match(/^\d+\.\d+\.\d+/)
  if (!m) return false
  const prev = publishedApk
  const next = m[0]
  publishedApk = next
  publishedAt = Date.now()
  if (next !== prev && next !== lastNotifiedApkVersion && isNewerApkVersion(next, prev)) {
    lastNotifiedApkVersion = next
    const link = 'https://github.com/T-Duva/once-11/releases/latest/download/once-11.apk'
    void sendPushOnly(APP_USERS, 'Actualizar!', `Once 11 ${next}. Tocá para abrir y actualizar.\n${link}`)
  }
  return true
}
async function refreshPublishedApk() {
  try {
    const r = await fetch('https://api.github.com/repos/T-Duva/once-11/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Once11-server' },
    })
    if (r.ok) {
      const j = await r.json()
      if (applyPublishedApkTag(j?.tag_name)) return
    }
  } catch {
    /* probar gh abajo */
  }
  // Sin cupo de API anónima: gh autenticado (keyring) o version.json ya publicada.
  try {
    const { spawnSync } = await import('node:child_process')
    const out = spawnSync('gh', ['api', 'repos/T-Duva/once-11/releases/latest', '--jq', '.tag_name'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000,
    })
    if (out.status === 0 && applyPublishedApkTag(String(out.stdout || '').trim())) return
  } catch {
    /* queda el último conocido */
  }
}
void refreshPublishedApk()
setInterval(() => {
  if (Date.now() - publishedAt > 60_000) void refreshPublishedApk()
}, 60_000)

if (fs.existsSync(dist)) {
  app.use(
    express.static(dist, {
      setHeaders(res, filePath) {
        if (/\.(js|css|mjs)$/i.test(filePath)) {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
        }
        if (/\.(html|webmanifest|js)$/i.test(filePath) && /index\.html|sw\.js|manifest\.webmanifest$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }),
  )
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (
      req.path.startsWith('/api') ||
      req.path === '/once-11.apk' ||
      req.path === '/once-11.ipa' ||
      req.path.startsWith('/ios/')
    ) {
      return next()
    }
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  // Identidad fija: Once 11 nunca debe aceptar un health de REPOSICIÓN u otra.
  // Versión = la más nueva entre APK publicado (GitHub) y el build local (PWA / iPhone).
  const apkV = apkVersionForPhone()
  const webV = appVersion()
  const version = isNewerApkVersion(webV, apkV) ? webV : apkV
  res.json({
    ok: true,
    app: 'once11',
    appId: 'com.once11.app',
    name: 'Once 11',
    version,
    watcher,
  })
})
app.get('/api/app-bundle', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
    const js = html.match(/src="(\/assets\/[^"]+\.js)"/)
    const css = html.match(/href="(\/assets\/[^"]+\.css)"/)
    if (!js) return res.status(404).json({ error: 'bundle missing' })
    res.json({ version: appVersion(), js: js[1], css: css ? css[1] : '' })
  } catch {
    res.status(404).json({ error: 'bundle missing' })
  }
})
app.get('/api/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat)
  const lon = Number(req.query.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat/lon required' })
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=es`
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Once11/2.0.2' },
    })
    if (!r.ok) return res.status(502).json({ error: 'reverse failed' })
    const data = await r.json()
    const a = data.address || {}
    const road = a.road || a.pedestrian || a.footway || a.residential || ''
    const street = road ? (a.house_number ? `${road} ${a.house_number}` : road) : ''
    const parts = [street, a.suburb || a.neighbourhood, a.city || a.town || a.village].filter(Boolean)
    const formatted = parts.filter((p, i) => parts.indexOf(p) === i).join(', ')
    res.json({
      display_name: formatted || data.display_name || null,
      address: a,
    })
  } catch {
    res.status(502).json({ error: 'reverse failed' })
  }
})
app.get('/api/state', (req, res) => {
  sendApiJson(req, res, {
    ok: true,
    db,
    dbRevision: dbMeta.dbRevision || 0,
    watcher,
    presence: presenceList(),
    vapidPublicKey: vapid.publicKey,
    version: appVersion(),
  })
})
app.post('/api/patch', (req, res) => {
  const user = parseUser(req.body?.user)
  const patch = req.body?.patch
  if (!patch) return res.status(400).json({ ok: false, error: 'Falta el cambio' })
  const err = validatePatch(patch, user)
  if (err) return res.status(400).json({ ok: false, error: err })
  applyPatch(patch, user)
  broadcast({ type: 'db', db, dbRevision: dbMeta.dbRevision || 0 })
  res.json({ ok: true, db, dbRevision: dbMeta.dbRevision || 0 })
})

/** Une lo del celu con la base del servidor (por id gana updatedAt más nuevo). */
app.post('/api/merge-local', (req, res) => {
  const user = parseUser(req.body?.user)
  const localDb = req.body?.db
  if (!localDb || typeof localDb !== 'object') {
    return res.status(400).json({ ok: false, error: 'Falta la base local' })
  }
  db = mergeDbPreferRich(db, {
    products: localDb.products || [],
    orders: localDb.orders || [],
    planItems: localDb.planItems || [],
    purchaseLines: localDb.purchaseLines || [],
    placeDiscounts: localDb.placeDiscounts || [],
    payments: localDb.payments || [],
    audit: localDb.audit || [],
    reports: localDb.reports || [],
    notifications: localDb.notifications || [],
  })
  dedupeOrdersByDate()
  dedupePurchaseLines()
  sanitizeSkipPurchase()
  repairOrphanProducts()
  persistDbChange()
  broadcast({ type: 'db', db, dbRevision: dbMeta.dbRevision || 0 })
  res.json({ ok: true, db, dbRevision: dbMeta.dbRevision || 0, mergedBy: user })
})
app.post('/api/presence', (req, res) => {
  const p = req.body?.presence
  if (p?.user === 'tomas' || p?.user === 'martin' || p?.user === 'nacho' || p?.user === 'sole') {
    httpPresence.set(p.user, { ...p, updatedAt: Date.now() })
  }
  res.json({ ok: true, presence: presenceList() })
})
app.post('/api/report', async (_req, res) => {
  res.status(410).json({
    ok: false,
    error: 'IA desactivada en la app. Pedí por Telegram o Cursor.',
  })
})
app.post('/api/push-sub', (req, res) => {
  const user = parseUser(req.body?.user)
  subs[user] = req.body.subscription || null
  saveJson(subsPath, subs)
  res.json({ ok: true })
})
app.post('/api/watcher/beat', (req, res) => {
  lastBeatAt = Date.now()
  const want = String(req.body?.status || '')
  const countRaw = req.body?.pendingCount
  const count =
    countRaw === undefined || countRaw === null ? watcher.pendingCount || 0 : Math.max(0, Number(countRaw) || 0)
  if (want === 'done' || want === 'online') {
    // El escuchador manda online solo cuando no hay trabajo activo
    workingSince = 0
    setWatcher({ status: 'online', currentReportId: undefined, error: undefined, pendingCount: count })
  } else if (want === 'pending') {
    if (watcher.status !== 'working' && watcher.status !== 'stuck') {
      workingSince = 0
      setWatcher({ status: 'online', currentReportId: undefined, error: undefined, pendingCount: count })
    } else {
      watcher = { ...watcher, pendingCount: count, lastSeenAt: Date.now() }
      broadcast({ type: 'watcher', watcher })
    }
  } else if (want === 'working') {
    if (watcher.status !== 'working') workingSince = Date.now()
    setWatcher({ status: 'working', error: undefined, pendingCount: count })
  } else if (want === 'stuck') {
    setWatcher({ status: 'stuck', error: req.body?.error || watcher.error, pendingCount: count })
  } else if (watcher.status === 'stuck' || watcher.status === 'working') {
    watcher = { ...watcher, pendingCount: count, lastSeenAt: Date.now() }
    broadcast({ type: 'watcher', watcher })
  } else {
    setWatcher({ status: 'online', pendingCount: count })
  }
  res.json({ ok: true, watcher })
})
app.post('/api/agent-note', (req, res) => {
  const title = String(req.body?.title || 'Once 11').slice(0, 120)
  const body = String(req.body?.body || '').slice(0, 1200)
  const push = String(req.body?.push || body).slice(0, 280)
  const targets = parseNotifyTargets(req.body?.to)
  if (!body) return res.status(400).json({ ok: false, error: 'Vacío' })
  notifyUsers(targets, title, body, push)
  res.json({ ok: true, to: targets })
})
app.post('/api/push-only', async (req, res) => {
  const title = String(req.body?.title || 'Once 11').slice(0, 120)
  const body = String(req.body?.body || '').slice(0, 500)
  const targets = parseNotifyTargets(req.body?.to || 'tomas')
  if (!title && !body) return res.status(400).json({ ok: false, error: 'Vacío' })
  await sendPushOnly(targets, title || 'Once 11', body)
  res.json({ ok: true, to: targets })
})
app.get('/api/vapid', (_req, res) => {
  res.json({ publicKey: vapid.publicKey })
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set()

let lastDbBackupAt = 0
const SAFE_BACKUP_DIR = path.join(dataDir, 'safe-backups')
const SAFE_BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Copia de seguridad aparte (NO se usa en la app). Vive 7 días. */
function safeBackupBeforeWrite() {
  try {
    fs.mkdirSync(SAFE_BACKUP_DIR, { recursive: true })
    if (fs.existsSync(dbPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const dest = path.join(SAFE_BACKUP_DIR, `db-${stamp}.json`)
      fs.copyFileSync(dbPath, dest)
    }
    const now = Date.now()
    for (const name of fs.readdirSync(SAFE_BACKUP_DIR)) {
      if (!name.startsWith('db-') || !name.endsWith('.json')) continue
      const p = path.join(SAFE_BACKUP_DIR, name)
      try {
        const st = fs.statSync(p)
        if (now - st.mtimeMs > SAFE_BACKUP_MAX_AGE_MS) fs.unlinkSync(p)
      } catch {
        /* ok */
      }
    }
  } catch (e) {
    console.warn('[safe-backup]', e?.message || e)
  }
}

function persist() {
  // Siempre backup antes de escribir la base viva.
  safeBackupBeforeWrite()
  try {
    const now = Date.now()
    // Copia horaria extra en backups/ (también se limpia por cantidad).
    if (now - lastDbBackupAt > 3600000 && fs.existsSync(dbPath)) {
      const backupDir = path.join(dataDir, 'backups')
      fs.mkdirSync(backupDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      fs.copyFileSync(dbPath, path.join(backupDir, `db-${stamp}.json`))
      const backups = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith('db-') && f.endsWith('.json'))
        .sort()
      while (backups.length > 48) {
        fs.unlinkSync(path.join(backupDir, backups.shift()))
      }
      lastDbBackupAt = now
    }
  } catch {
    /* backup opcional */
  }
  saveJson(dbPath, db)
}

function persistDbChange() {
  bumpDbRevision()
  persist()
}

function broadcastDb() {
  broadcast({ type: 'db', db, dbRevision: dbMeta.dbRevision || 0 })
}

function bumpDbRevision() {
  dbMeta.dbRevision = (Number(dbMeta.dbRevision) || 0) + 1
  saveJson(metaPath, dbMeta)
}

function lineRichness(l) {
  if (!l || typeof l !== 'object') return -1
  return (
    (Number(l.actualQty) || 0) * 1000 +
    (Number(l.plannedQty) || 0) * 100 +
    (Number(l.unitPrice) || 0) +
    (Number(l.totalPrice) || 0) +
    (String(l.address || '').trim() ? 50 : 0) +
    (String(l.notes || '').trim() ? 25 : 0) +
    ((Number(l.split?.madro) || 0) + (Number(l.split?.ligux) || 0) + (Number(l.split?.elugas) || 0)) +
    (l.ready ? 10 : 0)
  )
}

function mergeRowsById(serverRows, localRows, scoreFn) {
  const map = new Map()
  const consider = (r, preferIfTie) => {
    if (!r?.id) return
    const prev = map.get(r.id)
    if (!prev) {
      map.set(r.id, r)
      return
    }
    const ta = Number(r.updatedAt) || 0
    const tb = Number(prev.updatedAt) || 0
    const sa = scoreFn ? scoreFn(r) : 0
    const sb = scoreFn ? scoreFn(prev) : 0
    // Más nuevo gana, salvo que venga claramente vacío/pobre y pise algo rico
    // (pasa cuando un celu tenía cache vieja con updatedAt fresco tras reconnect).
    if (ta > tb) {
      if (scoreFn && sb > sa + 80 && sb >= sa * 2) {
        map.set(r.id, preferIfTie ? { ...r, ...prev } : prev)
        return
      }
      map.set(r.id, { ...prev, ...r })
      return
    }
    if (tb > ta) {
      if (scoreFn && sa > sb + 80 && sa >= sb * 2) {
        map.set(r.id, preferIfTie ? { ...prev, ...r } : r)
        return
      }
      map.set(r.id, { ...r, ...prev })
      return
    }
    if (preferIfTie || sa >= sb) map.set(r.id, { ...prev, ...r })
    else map.set(r.id, { ...r, ...prev })
  }
  for (const r of serverRows || []) consider(r, false)
  // Lo que sube ahora se aplica segundo → si empatan, gana esta subida.
  for (const r of localRows || []) consider(r, true)
  return [...map.values()]
}

/** Une bases: nunca borra filas; por id gana updatedAt más nuevo, si no el más rico. */
function mergeDbPreferRich(serverDb, localDb) {
  const out = {
    products: mergeRowsById(serverDb.products, localDb.products, (p) => String(p.name || '').length),
    orders: mergeRowsById(
      serverDb.orders,
      localDb.orders,
      (o) =>
        (o?.purchased === true ? 40 : o?.purchased === false ? 20 : 0) -
        (o.skipPurchase || []).length,
    ).map((o) => {
      // Si el merge perdió el tilde y alguna de las dos bases lo tenía, recuperarlo.
      const server = (serverDb.orders || []).find((x) => x.id === o.id)
      const local = (localDb.orders || []).find((x) => x.id === o.id)
      if (Object.prototype.hasOwnProperty.call(o, 'purchased') && o.purchased !== undefined) return o
      const from =
        local?.purchased !== undefined
          ? local.purchased
          : server?.purchased !== undefined
            ? server.purchased
            : undefined
      if (from === undefined) return o
      return { ...o, purchased: from }
    }),
    planItems: mergeRowsById(
      serverDb.planItems,
      localDb.planItems,
      (p) =>
        (Number(p.qty) || 0) +
        (Number(p.split?.madro) || 0) +
        (Number(p.split?.ligux) || 0) +
        (Number(p.split?.elugas) || 0),
    ),
    purchaseLines: mergeRowsById(serverDb.purchaseLines, localDb.purchaseLines, lineRichness),
    placeDiscounts: mergeRowsById(serverDb.placeDiscounts, localDb.placeDiscounts),
    payments: mergeRowsById(serverDb.payments, localDb.payments),
    audit: [...(serverDb.audit || []), ...(localDb.audit || [])]
      .filter((a, i, arr) => a?.id && arr.findIndex((x) => x.id === a.id) === i)
      .slice(0, 1200),
    reports: mergeRowsById(serverDb.reports || [], localDb.reports || []),
    notifications: mergeRowsById(
      serverDb.notifications,
      localDb.notifications,
      (n) => (n.read ? 1 : 0),
    ),
  }
  return out
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
  const map = new Map()
  for (const c of clients) {
    if (c.presence && now - c.presence.updatedAt < 15000) map.set(c.user, c.presence)
  }
  for (const [user, p] of httpPresence) {
    if (p && now - p.updatedAt < 15000) map.set(user, p)
  }
  return [...map.values()]
}

const STATIONS = ['ligux', 'elugas', 'madro']
const STATION_LABEL = { ligux: 'Ligux', elugas: 'Elugas', madro: 'Madro' }

function splitSum(split) {
  if (!split || typeof split !== 'object') return 0
  return (Number(split.madro) || 0) + (Number(split.ligux) || 0) + (Number(split.elugas) || 0)
}

function splitDetail(split) {
  return STATIONS.map((st) => `${STATION_LABEL[st]} ${Number(split?.[st]) || 0}`).join(' + ')
}

function parseUser(raw) {
  if (raw === 'martin') return 'martin'
  if (raw === 'nacho') return 'nacho'
  if (raw === 'sole') return 'sole'
  return 'tomas'
}

const USER_LABEL = { tomas: 'Tomás', martin: 'Martín', nacho: 'Nacho', sole: 'Sole' }
const APP_USERS = ['tomas', 'martin', 'nacho', 'sole']
const MADRO_ONLY_USERS = new Set(['nacho', 'sole'])

function parseNotifyTargets(raw) {
  const t = String(raw || 'tomas').toLowerCase()
  if (t === 'all' || t === 'todos' || t === '*') return [...APP_USERS]
  if (t === 'martin') return ['martin']
  if (t === 'nacho') return ['nacho']
  if (t === 'sole') return ['sole']
  return ['tomas']
}

function patchForbiddenForMadroOnly(patch) {
  if (patch.op === 'replace') return 'Sin permiso'
  const allowed = new Set(['orders', 'planItems', 'products'])
  if (patch.op === 'remove') {
    if (!allowed.has(patch.col)) return 'Sin permiso'
    if (patch.col === 'orders') return 'Sin permiso'
    return null
  }
  if (patch.op === 'upsert') {
    if (!allowed.has(patch.col)) return 'Sin permiso'
    if (patch.col === 'planItems') {
      const row = patch.row || {}
      const before = findRow('planItems', row.id)
      const ns = row.split || {}
      if (before) {
        const bs = before.split || {}
        if ((Number(ns.ligux) || 0) !== (Number(bs.ligux) || 0)) return 'Sin permiso: Ligux'
        if ((Number(ns.elugas) || 0) !== (Number(bs.elugas) || 0)) return 'Sin permiso: Elugas'
      } else if ((Number(ns.ligux) || 0) !== 0 || (Number(ns.elugas) || 0) !== 0) {
        return 'Sin permiso: Ligux/Elugas'
      }
    }
  }
  return null
}

function validatePatch(patch, user) {
  if (MADRO_ONLY_USERS.has(user)) {
    const forbidden = patchForbiddenForMadroOnly(patch)
    if (forbidden) return forbidden
  }
  if (patch?.op === 'replace') return 'Sin permiso: base única en servidor'
  // Borrar SIEMPRE permitido (Tomás lo pide: si hay algo mal lo borran ellos).
  if (!patch || patch.op !== 'upsert') return null
  const row = patch.row || {}
  if (patch.col === 'purchaseLines') {
    const parts = splitSum(row.split)
    const actual = Number(row.actualQty) || 0
    const planned = Number(row.plannedQty) || 0
    const cupo = parts || actual || planned
    if (cupo <= 0) return null
    if (parts > cupo + 0.001) {
      const verb = actual > 0 || parts > 0 ? 'compraste' : 'planificaste'
      return `No da: ${verb} ${cupo} y el reparto suma ${parts} (${splitDetail(row.split)}).`
    }
  }
  if (patch.col === 'planItems') {
    const qty = Number(row.qty) || 0
    const parts = splitSum(row.split)
    if (parts > qty + 0.001) {
      return `No da: llevás ${qty} y el reparto suma ${parts} (${splitDetail(row.split)}).`
    }
  }
  return null
}

function setWatcher(partial) {
  watcher = { ...watcher, ...partial, lastSeenAt: Date.now() }
  broadcast({ type: 'watcher', watcher })
}

function findRow(col, id) {
  return db[col].find((r) => r.id === id)
}

function mergeOrderUpsert(before, row) {
  const merged = before ? { ...before, ...row } : { ...row }
  // Si el patch no trae purchased, no pisar el tilde que ya estaba (true/false).
  if (before && !Object.prototype.hasOwnProperty.call(row, 'purchased') && before.purchased !== undefined) {
    merged.purchased = before.purchased
  } else if (
    before &&
    Object.prototype.hasOwnProperty.call(row, 'purchased') &&
    row.purchased === undefined &&
    before.purchased !== undefined
  ) {
    // purchased: undefined explícito no es “sacar tilde”.
    merged.purchased = before.purchased
  }
  if (before?.skipPurchase?.length && row.skipPurchase !== undefined) {
    const kept = before.skipPurchase.filter((id) => row.skipPurchase.includes(id))
    if (kept.length) merged.skipPurchase = kept
    else delete merged.skipPurchase
  } else if (before?.skipPurchase?.length) {
    merged.skipPurchase = before.skipPurchase
  } else {
    delete merged.skipPurchase
  }
  const orderId = merged.id || before?.id
  if (orderId && merged.skipPurchase?.length) {
    merged.skipPurchase = merged.skipPurchase.filter((pid) => {
      const line = db.purchaseLines.find((l) => l.orderId === orderId && l.productId === pid)
      return !line || !purchaseLineHasData(line)
    })
    if (!merged.skipPurchase.length) delete merged.skipPurchase
  }
  return merged
}

/** El patch del celu manda: si borró precio a propósito (solo U./Tot. a 0), se respeta.
 *  No dejar que un snapshot viejo (precio 0) pise uno ya cargado al editar
 *  otra cosa (reparto / listo / notas) — pasa mucho en viático y gastos. */
function mergePurchaseLineUpsert(before, row) {
  if (!before) return row
  const merged = { ...before, ...row }
  const beforePrice = Number(before.unitPrice) || 0
  const rowPrice = Number(row.unitPrice) || 0
  if (beforePrice > 0 && rowPrice === 0) {
    const splitChanged =
      JSON.stringify(before.split || {}) !== JSON.stringify(row.split || {})
    const qtyChanged = (Number(before.actualQty) || 0) !== (Number(row.actualQty) || 0)
    const plannedChanged = (Number(before.plannedQty) || 0) !== (Number(row.plannedQty) || 0)
    const readyChanged = Boolean(before.ready) !== Boolean(row.ready)
    const notesChanged = String(before.notes || '') !== String(row.notes || '')
    const addrChanged = String(before.address || '') !== String(row.address || '')
    const otherChanged =
      splitChanged || qtyChanged || plannedChanged || readyChanged || notesChanged || addrChanged
    // Solo borrar precio si el patch es “vaciar U.” (nada más cambió).
    // Cualquier otro cambio con precio 0 = fila vieja: conservar.
    if (otherChanged || ((Number(before.totalPrice) || 0) > 0 && (Number(row.totalPrice) || 0) > 0)) {
      merged.unitPrice = before.unitPrice
      const qty = splitSum(merged.split) || Number(merged.actualQty) || 0
      const keepTotal = Number(before.totalPrice) || beforePrice
      if ((Number(row.totalPrice) || 0) === 0) {
        merged.totalPrice = qty > 0 ? beforePrice * qty : keepTotal
      } else if ((Number(row.totalPrice) || 0) > 0 && !(Number(merged.unitPrice) > 0)) {
        merged.unitPrice = before.unitPrice
      }
    }
  } else if (beforePrice > 0 && rowPrice > 0) {
    const beforeTotal = Number(before.totalPrice) || 0
    const rowTotal = Number(row.totalPrice) || 0
    if (beforeTotal > 0 && rowTotal === 0) {
      const qty = splitSum(merged.split) || Number(merged.actualQty) || 0
      merged.totalPrice = qty > 0 ? rowPrice * qty : beforeTotal
    }
  } else if (beforePrice === 0 && rowPrice === 0) {
    // Recuperar U. desde total (dato a medias de sync viejo).
    const keepTotal = Number(before.totalPrice) || Number(row.totalPrice) || 0
    const qty = splitSum(merged.split) || Number(merged.actualQty) || 0
    if (keepTotal > 0 && qty <= 0) {
      merged.unitPrice = keepTotal
      merged.totalPrice = keepTotal
    }
  }
  return merged
}

function mergePlanItemUpsert(before, row) {
  if (!before) return row
  return { ...before, ...row }
}

function restoreDeletedFromAudit(target) {
  let restored = 0
  for (const e of [...(target.audit || [])].reverse()) {
    if (!e.field?.endsWith('.delete') || !e.before?.id) continue
    const col = e.field.split('.')[0]
    if (!Array.isArray(target[col])) continue
    if (target[col].some((r) => r.id === e.before.id)) continue
    target[col].push(e.before)
    restored += 1
  }
  return restored
}

function purchaseLineScore(l) {
  return (
    (Number(l?.actualQty) || 0) * 1000 +
    (Number(l?.plannedQty) || 0) * 100 +
    (Number(l?.unitPrice) || 0) +
    (Number(l?.totalPrice) || 0) +
    (String(l?.address || '').trim() ? 50 : 0) +
    splitSum(l?.split)
  )
}

function dedupePurchaseLines() {
  const best = new Map()
  for (const l of db.purchaseLines || []) {
    const key = l.id
    const prev = best.get(key)
    if (!prev || purchaseLineScore(l) > purchaseLineScore(prev)) best.set(key, l)
  }
  if (best.size !== (db.purchaseLines || []).length) {
    db.purchaseLines = [...best.values()]
    return true
  }
  return false
}

function purchaseLineHasData(l) {
  return !!(
    l?.actualQty ||
    l?.plannedQty ||
    l?.unitPrice ||
    l?.totalPrice ||
    String(l?.address || '').trim() ||
    String(l?.notes || '').trim() ||
    splitSum(l?.split)
  )
}

function repairOrphanProducts() {
  let changed = false
  const byId = new Map((db.products || []).map((p) => [p.id, p]))
  for (const line of db.purchaseLines || []) {
    if (byId.has(line.productId)) continue
    if (line.productId === TOMAS_PRODUCT_ID) {
      db.products.unshift({
        id: TOMAS_PRODUCT_ID,
        name: 'Tomas',
        createdBy: 'tomas',
        createdAt: 1787689316707,
      })
      byId.set(TOMAS_PRODUCT_ID, db.products[0])
      changed = true
      continue
    }
    db.products.unshift({
      id: line.productId,
      name: '',
      createdBy: 'tomas',
      createdAt: Date.now(),
    })
    byId.set(line.productId, db.products[0])
    changed = true
  }
  return changed
}

function sanitizeSkipPurchase() {
  let changed = false
  for (const order of db.orders || []) {
    if (!order.skipPurchase?.length) continue
    const kept = order.skipPurchase.filter((pid) => {
      const line = db.purchaseLines.find((l) => l.orderId === order.id && l.productId === pid)
      return !line || !purchaseLineHasData(line)
    })
    if (kept.length !== order.skipPurchase.length) {
      changed = true
      if (kept.length) order.skipPurchase = kept
      else delete order.skipPurchase
    }
  }
  return changed
}

function purgeSkippedPurchaseLines(order) {
  if (!order?.skipPurchase?.length) return
  const blocked = new Set(order.skipPurchase)
  db.purchaseLines = db.purchaseLines.filter(
    (l) => l.orderId !== order.id || !blocked.has(l.productId) || purchaseLineHasData(l),
  )
  sanitizeSkipPurchase()
}

function noteSkipPurchase(orderId, productId) {
  const left = db.purchaseLines.some((l) => l.orderId === orderId && l.productId === productId)
  if (left) return
  const idx = db.orders.findIndex((o) => o.id === orderId)
  if (idx < 0) return
  const order = db.orders[idx]
  if (order.skipPurchase?.includes(productId)) return
  db.orders[idx] = { ...order, skipPurchase: [...(order.skipPurchase || []), productId] }
}

function auditMeta(col, row) {
  const meta = { orderId: row?.orderId, rowId: row?.id }
  if (col === 'orders') meta.orderId = row?.id
  if (col === 'purchaseLines' || col === 'planItems') {
    meta.productId = row?.productId
    const p = db.products.find((x) => x.id === row?.productId)
    if (p?.name) meta.productName = p.name
  }
  return meta
}

function applyPatch(patch, user) {
  if (patch.op === 'replace') {
    // Desactivado: una sola base en la PC; no aceptar “pisar todo” desde un celu.
    return
  }
  if (patch.op === 'remove') {
    const before = findRow(patch.col, patch.id)
    if (patch.col === 'orders') {
      db.planItems = db.planItems.filter((r) => r.orderId !== patch.id)
      db.purchaseLines = db.purchaseLines.filter((r) => r.orderId !== patch.id)
      db.placeDiscounts = (db.placeDiscounts || []).filter((r) => r.orderId !== patch.id)
      db.payments = db.payments.filter((r) => r.orderId !== patch.id)
    }
    if (patch.col === 'products') {
      db.planItems = db.planItems.filter((r) => r.productId !== patch.id)
      db.purchaseLines = db.purchaseLines.filter((r) => r.productId !== patch.id)
    }
    db[patch.col] = db[patch.col].filter((r) => r.id !== patch.id)
    if (patch.col === 'purchaseLines' && before) {
      noteSkipPurchase(before.orderId, before.productId)
      const order = db.orders.find((o) => o.id === before.orderId)
      if (order) purgeSkippedPurchaseLines(order)
    }
    if (before || patch.col !== 'purchaseLines') {
      db.audit.unshift({
        id: crypto.randomUUID(),
        user,
        at: Date.now(),
        field: `${patch.col}.delete`,
        before,
        after: null,
        ...auditMeta(patch.col, before || { id: patch.id }),
      })
      db.audit = db.audit.slice(0, 1200)
    }
    persistDbChange()
    return
  }
  if (patch.op === 'upsert') {
    const col = patch.col
    const row = patch.row
    if (col === 'notifications') {
      const idx = db.notifications.findIndex((r) => r.id === row.id)
      if (idx >= 0) db.notifications[idx] = row
      else db.notifications.unshift(row)
      persistDbChange()
      return
    }
    if (col === 'purchaseLines') {
      const oidx = db.orders.findIndex((o) => o.id === row.orderId)
      if (oidx >= 0) {
        const order = db.orders[oidx]
        // Si lo cargan de nuevo, sacar el skip (borrar y reponer tiene que andar).
        if (order.skipPurchase?.includes(row.productId)) {
          const nextSkip = order.skipPurchase.filter((id) => id !== row.productId)
          if (nextSkip.length) db.orders[oidx] = { ...order, skipPurchase: nextSkip }
          else {
            const copy = { ...order }
            delete copy.skipPurchase
            db.orders[oidx] = copy
          }
        }
      }
    }
    const idx = db[col].findIndex((r) => r.id === row.id)
    // Misma fecha solo bloquea ALTA nueva (no updates: checkbox comprado, presupuesto, etc.).
    if (col === 'orders' && idx < 0) {
      const sameDate = db.orders.find((o) => o.date === row.date && o.id !== row.id)
      if (sameDate) {
        return
      }
    }
    const before = idx >= 0 ? db[col][idx] : null
    let finalRow = row
    if (col === 'orders') finalRow = mergeOrderUpsert(before, row)
    else if (col === 'purchaseLines') finalRow = mergePurchaseLineUpsert(before, row)
    else if (col === 'planItems') finalRow = mergePlanItemUpsert(before, row)
    // WS + HTTP mandan el mismo patch: si no cambió nada real, no pisar ni spamear el Log.
    const meaningful = diffFields(before, finalRow)
    if (before && meaningful.length === 0) return
    finalRow = {
      ...finalRow,
      updatedAt: Date.now(),
      updatedBy: user,
    }
    if (idx >= 0) db[col][idx] = finalRow
    else db[col].unshift(finalRow)
    if (col === 'orders') purgeSkippedPurchaseLines(finalRow)
    for (const field of meaningful) {
      db.audit.unshift({
        id: crypto.randomUUID(),
        user,
        at: Date.now(),
        field: `${col}.${field}`,
        before: before ? before[field] : null,
        after: finalRow[field],
        ...auditMeta(col, finalRow),
      })
    }
    if (!before) {
      db.audit.unshift({
        id: crypto.randomUUID(),
        user,
        at: Date.now(),
        field: `${col}.create`,
        before: null,
        after: finalRow.name || finalRow.id,
        ...auditMeta(col, finalRow),
      })
    }
    db.audit = db.audit.slice(0, 1200)
    // Sin avisos: el cambio queda solo en el Log (audit).
    persistDbChange()
  }
}

function diffFields(before, after) {
  if (!before) return []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out = []
  for (const k of keys) {
    if (k === 'id' || k === 'updatedAt' || k === 'updatedBy') continue
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(k)
  }
  return out
}

function saveReportPhotos(stamp, photoData) {
  if (!Array.isArray(photoData) || !photoData.length) return []
  const saved = []
  photoData.forEach((data, i) => {
    const raw = String(data || '')
    const m = raw.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!m) return
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1].replace(/[^a-z0-9]/gi, '') || 'jpg'
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length) return
    const name = `${stamp}-${i + 1}.${ext}`
    fs.writeFileSync(path.join(inboxDir, name), buf)
    saved.push(name)
  })
  return saved
}

async function handleReport(report, client, photoData = []) {
  const actionable = report.user === 'tomas'
  // El número de pendientes lo manda solo el escuchador (no sumar acá: se trababa en 2).
  if (actionable) {
    if (watcher.status !== 'working' && watcher.status !== 'stuck') {
      workingSince = 0
      setWatcher({ status: 'online', currentReportId: report.id, error: undefined })
    } else {
      setWatcher({ currentReportId: report.id })
    }
  }
  db.reports.unshift(report)
  persist()
  broadcastDb()

  // Evitar duplicados: mismo texto + usuario en < 4s (doble Enter / doble flush)
  const recentDup = db.reports.some(
    (r) =>
      r.id !== report.id &&
      r.user === report.user &&
      r.text === report.text &&
      Math.abs((r.at || 0) - (report.at || 0)) < 4000,
  )
  if (recentDup) {
    report.status = 'duplicado'
    report.note = 'Ignorado (mismo texto recién enviado)'
    const idx = db.reports.findIndex((r) => r.id === report.id)
    if (idx >= 0) db.reports[idx] = report
    persist()
    broadcastDb()
    if (client?.ws) send(client.ws, { type: 'db', db })
    return
  }

  const file = path.join(inboxDir, `${Date.now()}-${report.user}.md`)
  const savedPhotos = saveReportPhotos(path.basename(file, '.md'), photoData)
  report.photos = savedPhotos
  const photoBlock = savedPhotos.length
    ? `\n## Fotos\n\n${savedPhotos.map((name) => `- ${name}`).join('\n')}\n`
    : ''
  fs.writeFileSync(
    file,
    `# Reporte ${report.user}\n\n- fecha: ${new Date(report.at).toISOString()}\n- pantalla: ${report.screen}\n- orden: ${report.orderId || '-'}\n- version: ${report.version}\n\n${report.text || '(sin texto)'}\n${photoBlock}`,
  )

  try {
    if (actionable) {
      notifyWindows('Orden de Tomás', report.text.slice(0, 180))
      report.status = 'hecho'
      report.note = `Encolado en inbox: ${path.basename(file)}`
    } else {
      const name = USER_LABEL[report.user] || report.user
      const title = `${name} te envió un reporte`
      const body = report.text.slice(0, 180)
      notifyWindows(title, body)
      db.notifications.unshift({
        id: crypto.randomUUID(),
        to: 'tomas',
        title,
        body,
        at: Date.now(),
        read: false,
      })
      report.status = 'notificado'
      report.note = 'Solo log — sin acción del agente'
      db.audit.unshift({
        id: crypto.randomUUID(),
        user: report.user,
        at: report.at,
        field: 'reports.create',
        before: null,
        after: report.text || '',
        orderId: report.orderId,
      })
      db.audit = db.audit.slice(0, 1200)
      await sendPush('tomas', title, body)
      fs.writeFileSync(path.join(inboxDir, `DONE.${path.basename(file, '.md')}`), 'log-only', 'utf8')
    }
    const idx = db.reports.findIndex((r) => r.id === report.id)
    if (idx >= 0) db.reports[idx] = report
    persist()
    broadcastDb()
  } catch (err) {
    report.status = 'error'
    report.note = String(err?.message || err)
    persist()
    broadcastDb()
    setWatcher({ status: 'stuck', error: report.note, currentReportId: report.id })
  }
  if (client?.ws) send(client.ws, { type: 'db', db })
}

async function sendPush(user, title, body) {
  const sub = subs[user]
  if (!sub) return false
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body }))
    return true
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      subs[user] = null
      saveJson(subsPath, subs)
    }
    return false
  }
}

/** Solo barra del celu — sin carteles amarillos en la app. */
async function sendPushOnly(users, title, body) {
  const targets = [...new Set((users || []).filter((u) => APP_USERS.includes(u)))]
  for (const to of targets) {
    await sendPush(to, title, body)
  }
}

function notifyUsers(users, title, body, push) {
  const targets = [...new Set(users.filter((u) => APP_USERS.includes(u)))]
  if (!targets.length) return
  for (const to of targets) {
    db.notifications.unshift({
      id: crypto.randomUUID(),
      to,
      title,
      body,
      at: Date.now(),
      read: false,
    })
    void sendPush(to, title, push)
  }
  db.notifications = db.notifications.slice(0, 100)
  persist()
  broadcastDb()
  notifyWindows(title, body)
}

function notifyAllUsersUpdate(_version) {
  /* apagado: el cartel amarillo no vuelve; solo el popup Actualizar en la app */
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
  const user = parseUser(url.searchParams.get('user'))
  const client = { ws, user, presence: null }
  clients.add(client)
  send(ws, {
    type: 'hello',
    db,
    dbRevision: dbMeta.dbRevision || 0,
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
      const err = validatePatch(msg.patch, user)
      if (err) {
        send(ws, { type: 'error', message: err })
        return
      }
      applyPatch(msg.patch, user)
      broadcastDb()
      return
    }
    if (msg.type === 'report') {
      const photos = Array.isArray(msg.photos) ? msg.photos.filter((p) => typeof p === 'string') : []
      const report = {
        id: crypto.randomUUID(),
        user,
        text: String(msg.text || '').trim(),
        photos: [],
        screen: msg.screen || 'home',
        orderId: msg.orderId,
        version: msg.version || '1.0.0',
        at: Date.now(),
        status: 'nuevo',
      }
      if (!report.text && !photos.length) return
      await handleReport(report, client, photos)
    }
  })

  ws.on('close', () => {
    clients.delete(client)
    broadcast({ type: 'presence', presence: presenceList() })
  })
})

setInterval(() => {
  const now = Date.now()
  const beatAge = now - lastBeatAt
  if (watcher.status === 'working') {
    if (workingSince && now - workingSince > 15 * 60 * 1000) {
      setWatcher({ status: 'stuck', error: 'El trabajo lleva más de 15 minutos' })
    } else if (lastBeatAt > 0 && beatAge > 45000) {
      setWatcher({ status: 'stuck', error: 'El escuchador se cortó' })
    }
    return
  }
  if (beatAge > 20000 && watcher.status !== 'off') {
    setWatcher({ status: 'off' })
  }
}, 3000)

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Once 11 v${appVersion()} → http://127.0.0.1:${PORT}`)
})
