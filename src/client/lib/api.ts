// Jedyne miejsce, w którym klient rozmawia z serwerem (POST /api/rpc).
// Ten sam interfejs co desktopowe src/renderer/lib/api.ts: call, ApiError, errorMessage, useLoad, useDataChanged.
import { useCallback, useEffect, useState } from 'react'
import type { ApiInput, ApiOutputs, ApiResult, Method } from '@shared/api'
import type { ErrorCode } from '@shared/errors'
import { pl } from '../i18n/pl'

export class ApiError extends Error {
  constructor(
    public code: string,
    public detail: string
  ) {
    super(code)
  }
}

const MUTATION = /\.(create|update|delete|add|remove|set|setStatus|move|toggle|end|withdraw|restore|applyPaste|apply|shiftTasks)$/
const CHANGED = 'ngo-data-changed'

export async function call<M extends Method>(method: M, params: ApiInput<M>): Promise<ApiOutputs[M]> {
  const res = await fetch('/api/rpc', {
    method: 'POST',
    credentials: 'same-origin',
    // X-NGO-CRM: wymagany przy każdym POST (ochrona CSRF, serwer sprawdza też Origin).
    headers: { 'Content-Type': 'application/json', 'X-NGO-CRM': '1' },
    body: JSON.stringify({ method, params })
  })
  const r = (await res.json().catch(() => null)) as ApiResult<M> | null
  if (!r) throw new ApiError('UNKNOWN', `HTTP ${res.status}`)
  if (!r.ok) throw new ApiError(r.code, r.message)
  // po każdym zapisie: odśwież liczniki i widoki zbiorcze
  if (MUTATION.test(method)) window.dispatchEvent(new Event(CHANGED))
  return r.data
}

/** Wywołuje `cb` po każdym zapisie do bazy. */
export function useDataChanged(cb: () => void) {
  useEffect(() => {
    window.addEventListener(CHANGED, cb)
    return () => window.removeEventListener(CHANGED, cb)
  }, [cb])
}

/** Komunikat błędu po polsku. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const msg = pl.errors[e.code as ErrorCode]
    if (e.code === 'UNKNOWN' || e.code === 'VALIDATION') return `${msg ?? pl.errors.UNKNOWN} (${e.detail})`
    return msg ?? `${pl.errors.UNKNOWN} (${e.detail})`
  }
  return e instanceof Error ? e.message : String(e)
}

/** Wczytanie danych z serwera; `reload` po zapisie. */
export function useLoad<M extends Method>(method: M, params: ApiInput<M>) {
  const key = JSON.stringify(params ?? {})
  const [data, setData] = useState<ApiOutputs[M] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let alive = true
    call(method, JSON.parse(key) as ApiInput<M>)
      .then((d) => {
        if (alive) {
          setData(d)
          setError(null)
        }
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
    }
  }, [method, key, version])
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { data, error, reload }
}
