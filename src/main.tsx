import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import './index.css'
import App from './App.tsx'
import { nativeLiveUpdate } from './nativeBoot.ts'

async function start() {
  if (Capacitor.isNativePlatform()) {
    void StatusBar.setOverlaysWebView({ overlay: false })
    void StatusBar.setBackgroundColor({ color: '#070708' })
    void StatusBar.setStyle({ style: Style.Dark })
    const moved = await nativeLiveUpdate()
    if (moved) return
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
