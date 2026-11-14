// Konfiguracja 2FA: kod QR i klucz do ręcznego wpisania, potwierdzenie pierwszym kodem.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApiOutputs } from '@shared/api'
import { Button, Card, ErrorNote, Field } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, errorMessage } from '../lib/api'

export function TotpSetupScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [setup, setSetup] = useState<ApiOutputs['auth.totpSetup.start'] | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // Raz na ekran: każdy start tworzy nowy sekret i unieważnia poprzedni.
    if (started.current) return
    started.current = true
    call('auth.totpSetup.start', {})
      .then(setSetup)
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await call('auth.totpSetup.confirm', { code })
      onDone()
    } catch (err) {
      setCode('')
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={pl.totpSetup.title}>
      <p className="mt-3 text-sm text-slate-600">{pl.totpSetup.intro}</p>
      {!setup && !error && <p className="mt-4 text-sm text-slate-500">{pl.app.loading}</p>}
      {setup && (
        <form onSubmit={submit}>
          {/* SVG z serwera jako obrazek (data:), nie jako HTML: nic z niego nie może się wykonać. */}
          <img className="mx-auto mt-4 h-52 w-52" alt={pl.totpSetup.qrAlt} src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} />
          <p className="mt-4 text-sm text-slate-600">{pl.totpSetup.manual}</p>
          <p className="mt-1 select-all break-all rounded bg-slate-100 px-3 py-2 font-mono text-sm">{setup.secret.match(/.{1,4}/g)?.join(' ')}</p>
          <Field
            label={pl.totpSetup.code}
            hint={pl.totpSetup.codeHint}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            disabled={busy}
          />
          <ErrorNote>{error}</ErrorNote>
          <div className="mt-6 flex gap-3">
            <Button type="submit" disabled={busy}>
              {pl.totpSetup.confirm}
            </Button>
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              {pl.totpSetup.cancel}
            </Button>
          </div>
        </form>
      )}
      {!setup && <ErrorNote>{error}</ErrorNote>}
      {!setup && error && (
        <div className="mt-6">
          <Button variant="secondary" onClick={onCancel}>
            {pl.totpSetup.cancel}
          </Button>
        </div>
      )}
    </Card>
  )
}
