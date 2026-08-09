import { useState, type FormEvent } from 'react'
import { useApp } from '../state/store'

export function ReportModal() {
  const open = useApp((s) => s.reportOpen)
  const setOpen = useApp((s) => s.setReportOpen)
  const send = useApp((s) => s.sendReport)
  const user = useApp((s) => s.user)
  const [text, setText] = useState('')

  if (!open) return null

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    send(t)
    setText('')
  }

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <h2>Reportar</h2>
        <p className="hint">
          {user === 'martin'
            ? 'Tomás recibe el aviso en el celular y en la PC.'
            : 'Lo tomo como orden y lo hago desde acá.'}
        </p>
        <textarea
          autoFocus
          rows={5}
          placeholder="¿Qué pasó o qué hay que cambiar?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row-actions">
          <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={!text.trim()}>
            Enviar
          </button>
        </div>
      </form>
    </div>
  )
}
