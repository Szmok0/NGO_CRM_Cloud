import { useEffect, useState } from 'react'
import type { Health } from '@shared/health'

// Strona próbnego wdrożenia (ZADANIE_01, krok 1): czy serwer, baza i migracje działają.
export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setHealth)
      .catch(() => setError(true))
  }, [])

  return (
    <main className="mx-auto max-w-lg p-10 font-sans text-slate-800">
      <h1 className="text-2xl font-semibold">NGO CRM — działa</h1>
      {error && <p className="mt-4 text-red-700">Brak połączenia z serwerem albo bazą danych.</p>}
      {!health && !error && <p className="mt-4 text-slate-500">Sprawdzam serwer…</p>}
      {health && (
        <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-slate-500">Wersja</dt>
          <dd>{health.version}</dd>
          <dt className="text-slate-500">Migracje bazy</dt>
          <dd>{health.migrations}</dd>
          <dt className="text-slate-500">Połączenie HTTPS</dt>
          <dd className={health.https ? 'text-green-700' : 'text-red-700'}>{health.https ? 'tak' : 'nie'}</dd>
        </dl>
      )}
    </main>
  )
}
