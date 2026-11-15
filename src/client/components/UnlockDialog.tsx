// Okno „Odblokuj”: hasło liczy `wrapKey` w przeglądarce i otwiera klucze; nic nie idzie do serwera (D5).
import { useState, type FormEvent } from 'react'
import { pl } from '../i18n/pl'
import { errorMessage } from '../lib/api'
import { unlockWithPassword, WrongPasswordError } from '../lib/keyring'
import { Button, Dialog, ErrorNote, InputField } from './ui'

export function UnlockDialog({ userId, onClose, onUnlocked }: { userId: string; onClose: () => void; onUnlocked?: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (!(await unlockWithPassword(password, userId))) return setError(pl.unlock.noKeys)
      setPassword('')
      onClose()
      onUnlocked?.()
    } catch (err) {
      setError(err instanceof WrongPasswordError ? pl.unlock.wrongPassword : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      title={pl.unlock.title}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {pl.unlock.cancel}
          </Button>
          <Button type="submit" form="unlock-form" disabled={busy || !password}>
            {busy ? pl.unlock.working : pl.unlock.submit}
          </Button>
        </>
      }
    >
      <form id="unlock-form" onSubmit={submit}>
        <p className="text-sm text-secondary-foreground">{pl.unlock.intro}</p>
        <InputField label={pl.login.password} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required disabled={busy} />
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Dialog>
  )
}
