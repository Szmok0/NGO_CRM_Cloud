// „Odzyskaj dostęp” (D10): administrator bez slotu wpisuje klucz odzyskiwania z kartki i dostaje slot do bieżącej wersji klucza.
// Klucz odzyskiwania i klucz organizacji zostają w przeglądarce; na serwer idzie tylko nowy slot.
import { useState, type FormEvent } from 'react'
import { Button, Card, ErrorNote, InfoNote, InputField } from '../components/ui'
import { createSlot, importPublicKey } from '../crypto/keys'
import { openRecoverySlot, parseRecoveryKey } from '../crypto/recovery'
import { pl } from '../i18n/pl'
import { call, errorMessage } from '../lib/api'
import { loadOrgKeys, ownPublicKey } from '../lib/keyring'

export function RecoverAccessCard({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const publicKey = await ownPublicKey()
      if (!publicKey) return setError(pl.recover.noPublicKey)
      const { keyVersion, recoverySlot } = await call('keys.recoverySlot', {})
      let orgKey: CryptoKey
      try {
        orgKey = await openRecoverySlot(recoverySlot, await parseRecoveryKey(text), keyVersion, true)
      } catch {
        return setError(pl.recover.wrongKey)
      }
      await call('keys.recover', { keyVersion, wrappedKey: await createSlot(orgKey, await importPublicKey(publicKey), keyVersion) })
      setText('')
      await loadOrgKeys()
      setDone(true)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={pl.recover.title}>
      <p className="text-sm text-secondary-foreground">{pl.recover.intro}</p>
      {done ? (
        <InfoNote>{pl.recover.done}</InfoNote>
      ) : (
        <form onSubmit={submit}>
          <InputField label={pl.recover.key} hint={pl.recover.keyHint} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" required disabled={busy} />
          <ErrorNote>{error}</ErrorNote>
          <div className="mt-4">
            <Button type="submit" size="sm" disabled={busy || !text.trim()}>
              {busy ? pl.recover.working : pl.recover.submit}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
