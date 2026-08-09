import { useState, type FormEvent } from 'react'
import { APP_NAME, APP_VERSION } from '../version'
import { useApp } from '../state/store'
import type { UserId } from '../types'

function normalizeUser(raw: string): UserId | null {
  const t = raw.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (t === 'tomas') return 'tomas'
  if (t === 'martin') return 'martin'
  return null
}

export function Login() {
  const login = useApp((s) => s.login)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const id = normalizeUser(user)
    if (!id) {
      setErr('Usuario: Tomás o Martín')
      return
    }
    if (pass !== ' ') {
      setErr('Contraseña incorrecta')
      return
    }
    login(id)
  }

  return (
    <div className="login-wrap">
      <div className="login-mark" aria-hidden>
        11
      </div>
      <form className="login-card" onSubmit={onSubmit}>
        <p className="eyebrow">Once · Madro Ligux Elugas</p>
        <h1>{APP_NAME}</h1>
        <label>
          Usuario
          <input autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} placeholder="Tomás / Martín" />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder=""
          />
        </label>
        {err && <p className="err">{err}</p>}
        <button type="submit" className="btn primary big">
          Confirmar
        </button>
        <p className="ver">v{APP_VERSION}</p>
      </form>
    </div>
  )
}
