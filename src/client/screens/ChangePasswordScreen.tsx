// Zmiana hasła: nowe klucze liczone w przeglądarce, klucz prywatny przeszyfrowany nowym wrapKey.
// Serwer dostaje obecny i nowy authKey, świeży kod TOTP i nowy szyfrogram klucza prywatnego; haseł nie widzi.
import { useState, type FormEvent } from 'react'
import { AuthCard, Button, ErrorNote, InputField } from '../components/ui'
import { fromBase64, toBase64 } from '../crypto/encoding'
import { KDF_ITERATIONS, deriveKeys, newKdfSalt } from '../crypto/kdf'
import { rewrapPrivateKey } from '../crypto/keys'
import { pl } from '../i18n/pl'
import { call, errorMessage, isApiError } from '../lib/api'
import { passwordProblem } from '../lib/password'

interface Props {
  userId: string
  email: string
  /** Hasło zmienione; `wrapKey` nowego hasła do odblokowania kluczy w tej karcie. */
  onDone: (wrapKey: CryptoKey) => void
  onCancel: () => void
  onSignedOut: () => void
}

export function ChangePasswordScreen({ userId, email, onDone, onCancel, onSignedOut }: Props) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = next !== repeat ? pl.changePassword.mismatch : next === current ? pl.changePassword.same : passwordProblem(next, email)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      const keys = await call('auth.keys', {})
      const oldKeys = await deriveKeys(current, fromBase64(keys.kdfSalt), keys.kdfIterations)
      const salt = newKdfSalt()
      const newKeys = await deriveKeys(next, salt, KDF_ITERATIONS)
      let newPrivateKeyEnc: string | undefined
      if (keys.privateKeyEnc) {
        // Złe obecne hasło: klucza prywatnego nie da się odszyfrować (ten sam komunikat co z serwera).
        newPrivateKeyEnc = await rewrapPrivateKey(keys.privateKeyEnc, oldKeys.wrapKey, newKeys.wrapKey, userId).catch(() => {
          throw new Error(pl.errors.LOGIN_FAILED)
        })
      }
      await call('auth.changePassword', {
        currentAuthKey: oldKeys.authKey,
        totpCode: code,
        newAuthKey: newKeys.authKey,
        newKdfSalt: toBase64(salt),
        newKdfIterations: KDF_ITERATIONS,
        newPrivateKeyEnc
      })
      onDone(newKeys.wrapKey)
    } catch (err) {
      setCode('')
      setError(errorMessage(err))
      // Blokada konta kończy sesję: wracamy do logowania.
      await call('auth.me', {}).catch((e: unknown) => isApiError(e, 'UNAUTHENTICATED') && onSignedOut())
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title={pl.changePassword.title}>
      <form onSubmit={submit}>
        <InputField label={pl.changePassword.current} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus required disabled={busy} />
        <InputField label={pl.changePassword.next} hint={pl.passwordRules.hint} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required disabled={busy} />
        <InputField label={pl.changePassword.repeat} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required disabled={busy} />
        <InputField
          label={pl.changePassword.code}
          hint={pl.changePassword.codeHint}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          disabled={busy}
        />
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-6 flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {pl.changePassword.submit}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {pl.changePassword.cancel}
          </Button>
        </div>
        {busy && <p className="mt-3 text-sm text-slate-500">{pl.changePassword.working}</p>}
      </form>
    </AuthCard>
  )
}
