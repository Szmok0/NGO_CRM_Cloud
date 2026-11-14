// Jedyne miejsce, w którym klient rozmawia z serwerem (POST /api/rpc i trasy logowania /api/auth/…).
// Ten sam interfejs co desktopowe src/renderer/lib/api.ts: call, ApiError, errorMessage, useLoad, useDataChanged.
import { useCallback, useEffect, useState } from 'react'
import type { ApiInput, ApiOutputs, Method } from '@shared/api'
import type { LoginResult, PreloginResult } from '@shared/auth'
import type { ErrorCode } from '@shared/errors'
import type { SetupCheckResult, SetupCompleteInput, SetupStatus, SetupTotpResult } from '@shared/setup'
import { pl } from '../i18n/pl'

export class ApiError extends Error {
  constructor(
    public code: string,
    public detail: string
  ) {
    super(code)
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    // X-NGO-CRM: wymagany przy każdym POST (ochrona CSRF, serwer sprawdza też Origin).
    headers: { 'Content-Type': 'application/json', 'X-NGO-CRM': '1' },
    body: JSON.stringify(body)
  })
  const r = (await res.json().catch(() => null)) as Envelope<T> | null
  if (!r) throw new ApiError('UNKNOWN', `HTTP ${res.status}`)
  if (!r.ok) throw new ApiError(r.code, r.message)
  return r.data
}

const MUTATION = /\.(create|update|delete|add|remove|set|setStatus|move|toggle|end|withdraw|restore|applyPaste|apply|shiftTasks)$/
const CHANGED = 'ngo-data-changed'

export async function call<M extends Method>(method: M, params: ApiInput<M>): Promise<ApiOutputs[M]> {
  const data = await postJson<ApiOutputs[M]>('/api/rpc', { method, params })
  // po każdym zapisie: odśwież liczniki i widoki zbiorcze
  if (MUTATION.test(method)) window.dispatchEvent(new Event(CHANGED))
  return data
}

/** Logowanie (trasy poza RPC). Hasło nigdy tu nie trafia: tylko `authKey` wyprowadzony w przeglądarce. */
export const authApi = {
  prelogin: (email: string) => postJson<PreloginResult>('/api/auth/prelogin', { email }),
  login: (email: string, authKey: string) => postJson<LoginResult>('/api/auth/login', { email, authKey }),
  totp: (code: string) => postJson<void>('/api/auth/totp', { code })
}

/** Kreator pierwszego uruchomienia (trasy poza RPC, bez sesji). */
export const setupApi = {
  status: () => postJson<SetupStatus>('/api/setup/status', {}),
  check: (token: string) => postJson<SetupCheckResult>('/api/setup/check', { token }),
  totp: (token: string, email: string) => postJson<SetupTotpResult>('/api/setup/totp', { token, email }),
  complete: (input: SetupCompleteInput) => postJson<void>('/api/setup/complete', input)
}

/** Wywołuje `cb` po każdym zapisie do bazy. */
export function useDataChanged(cb: () => void) {
  useEffect(() => {
    window.addEventListener(CHANGED, cb)
    return () => window.removeEventListener(CHANGED, cb)
  }, [cb])
}

export const isApiError = (e: unknown, code: ErrorCode) => e instanceof ApiError && e.code === code

/** Komunikat błędu po polsku. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const msg = pl.errors[e.code as ErrorCode]
    if (e.code === 'UNKNOWN') return `${msg} (${e.detail})`
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
