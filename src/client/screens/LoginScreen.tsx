// Logowanie: e-mail i hasło → kod z aplikacji. Hasło nie opuszcza przeglądarki: do serwera idzie tylko authKey.
import { useRef, useState, type FormEvent } from 'react'
import { AuthCard, Button, ErrorNote, InputField } from '../components/ui'
import { fromBase64 } from '../crypto/encoding'
import { deriveKeys } from '../crypto/kdf'
import { pl } from '../i18n/pl'
import { authApi, call, errorMessage, isApiError } from '../lib/api'

interface Props {
  /** Jest już sesja po haśle (np. po odświeżeniu strony): od razu krok z kodem. */
  resumeCode?: boolean
  /** Pełne logowanie. `wrapKey` = null, gdy hasło nie było podawane w tej karcie (klucze zostają zablokowane). */
  onSignedIn: (wrapKey: CryptoKey | null) => void
  /** Konto bez 2FA: najpierw konfiguracja. */
  onTotpSetup: (wrapKey: CryptoKey) => void
}

export function LoginScreen({ resumeCode, onSignedIn, onTotpSetup }: Props) {
  const [step, setStep] = useState<'credentials' | 'code'>(resumeCode ? 'code' : 'credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapKey = useRef<CryptoKey | null>(null)

  async function submitCredentials(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const mail = email.trim().toLowerCase()
      const pre = await authApi.prelogin(mail)
      const keys = await deriveKeys(password, fromBase64(pre.kdfSalt), pre.kdfIterations)
      const result = await authApi.login(mail, keys.authKey)
      wrapKey.current = keys.wrapKey
      setPassword('')
      if (result.totpEnabled) setStep('code')
      else onTotpSetup(keys.wrapKey)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await authApi.totp(code)
      onSignedIn(wrapKey.current)
    } catch (err) {
      setCode('')
      if (isApiError(err, 'UNAUTHENTICATED')) {
        setStep('credentials')
        setError(pl.login.sessionExpired)
      } else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function back() {
    await call('auth.logout', {}).catch(() => undefined)
    wrapKey.current = null
    setCode('')
    setError(null)
    setStep('credentials')
  }

  if (step === 'code') {
    return (
      <AuthCard title={pl.login.codeTitle}>
        <form onSubmit={submitCode}>
          <InputField
            label={pl.login.code}
            hint={pl.login.codeHint}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            autoFocus
            required
            disabled={busy}
          />
          <ErrorNote>{error}</ErrorNote>
          <div className="mt-6 flex gap-3">
            <Button type="submit" disabled={busy}>
              {pl.login.confirm}
            </Button>
            <Button variant="outline" onClick={back} disabled={busy}>
              {pl.login.back}
            </Button>
          </div>
        </form>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={pl.login.title}>
      <form onSubmit={submitCredentials}>
        <InputField label={pl.login.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required disabled={busy} />
        <InputField label={pl.login.password} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required disabled={busy} />
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-6 flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {pl.login.submit}
          </Button>
          {busy && <span className="text-sm text-slate-500">{pl.login.working}</span>}
        </div>
      </form>
    </AuthCard>
  )
}
