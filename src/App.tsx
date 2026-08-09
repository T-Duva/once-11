import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { UpdateBanner } from './components/UpdateBanner'
import { Login } from './screens/Login'
import { Home } from './screens/Home'
import { Planificar } from './screens/Planificar'
import { Comprar } from './screens/Comprar'
import { Repartir } from './screens/Repartir'
import { Cuentas } from './screens/Cuentas'
import { Historial } from './screens/Historial'
import { useApp } from './state/store'
import type { UserId } from './types'

export default function App() {
  const user = useApp((s) => s.user)
  const screen = useApp((s) => s.screen)
  const login = useApp((s) => s.login)

  useEffect(() => {
    const saved = localStorage.getItem('once11.user') as UserId | null
    if (saved === 'tomas' || saved === 'martin') login(saved)
  }, [login])

  if (!user) {
    return (
      <>
        <UpdateBanner />
        <Login />
      </>
    )
  }

  return (
    <>
      <UpdateBanner />
      <Shell>
      {screen === 'home' && <Home />}
      {screen === 'plan' && <Planificar />}
      {screen === 'buy' && <Comprar />}
      {screen === 'split' && <Repartir />}
      {screen === 'accounts' && <Cuentas />}
      {screen === 'audit' && <Historial />}
    </Shell>
    </>
  )
}
