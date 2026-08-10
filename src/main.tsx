import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { nativeLiveUpdate } from './nativeBoot.ts'

async function dropServiceWorkers() {
  if (!('serviceWorker' in navigator)) return
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((r) => r.unregister()))
}

async function start() {
  const fromApp = new URLSearchParams(location.search).has('fromApp')
  const native = Capacitor.isNativePlatform()

  if (native) {
    void StatusBar.setOverlaysWebView({ overlay: false })
    void StatusBar.setBackgroundColor({ color: '#070708' })
    void StatusBar.setStyle({ style: Style.Dark })
    const moved = await nativeLiveUpdate()
    if (moved) return
  }

  if (native || fromApp) {
    await dropServiceWorkers()
  } else {
    registerSW({ immediate: true })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
