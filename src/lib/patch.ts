import { emptyDb, type Database, type Patch, type UserId } from '../types'

export function applyPatchLocal(db: Database, patch: Patch, _user: UserId): Database {
  if (patch.op === 'replace') return patch.db ?? emptyDb()

  const next = JSON.parse(JSON.stringify(db)) as Database

  if (patch.op === 'remove') {
    const col = patch.col
    next[col] = next[col].filter((r) => r.id !== patch.id) as never
    return next
  }

  if (patch.op === 'upsert') {
    const col = patch.col
    const list = next[col] as Array<{ id: string }>
    const idx = list.findIndex((r) => r.id === patch.row.id)
    if (idx >= 0) list[idx] = patch.row
    else list.unshift(patch.row)
    return next
  }

  return next
}
