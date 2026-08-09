import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import './index.css'
import App from './App.tsx'

if (Capacitor.isNativePlatform()) {
  void StatusBar.setOverlaysWebView({ overlay: false })
  void StatusBar.setBackgroundColor({ color: '#070708' })
  void StatusBar.setStyle({ style: Style.Dark })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
