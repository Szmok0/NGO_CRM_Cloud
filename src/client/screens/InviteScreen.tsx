// Przyjęcie zaproszenia z jednorazowego linku: imię, hasło, 2FA; para kluczy powstaje w przeglądarce.
// Do ostatniego kroku nic nie jest zapisane; po zakończeniu ekran logowania.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { InviteInfo, InviteTotpResult } from '@shared/invite'
import { Button, Card, ErrorNote, Field } from '../components/ui'
import { toBase64 } from '../crypto/encoding'
import { KDF_ITERATIONS, deriveKeys, newKdfSalt } from '../crypto/kdf'
import { exportPublicKey, generateUserKeyPair, wrapPrivateKey } from '../crypto/keys'
import { pl } from '../i18n/pl'
import { errorMessage, inviteApi } from '../lib/api'
import { passwordProblem } from '../lib/password'

const t = pl.invite

interface Material {
  totp: InviteTotpResult
  authKey: string
  kdfSalt: string
  publicKey: string
  privateKeyEnc: string
}

export function InviteScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [step, setStep] = useState<'form' | 'totp' | 'done'>('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [material, setMaterial] = useState<Material | null>(null)
  const [code, setCode] = useState('')
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    inviteApi
      .info(token)
      .then(setInfo)
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [token])

  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!info) {
    return (
      <Card title={t.title}>
        {!error && <p className="mt-4 text-sm text-muted-foreground">{pl.app.loading}</p>}
        <ErrorNote>{error}</ErrorNote>
        {error && (
          <div className="mt-6">
            <Button variant="secondary" onClick={onDone}>
              {t.login}
            </Button>
          </div>
        )}
      </Card>
    )
  }

  if (step === 'done') {
    return (
      <Card title={t.doneTitle}>
        <p className="mt-3 text-sm text-secondary-foreground">{t.done}</p>
        <div className="mt-6">
          <Button onClick={onDone}>{t.login}</Button>
        </div>
      </Card>
    )
  }

  if (step === 'totp' && material) {
    return (
      <Card title={pl.totpSetup.title} wide>
        <p className="mt-3 text-sm text-muted-foreground">{pl.totpSetup.intro}</p>
        <form
          onSubmit={run(async () => {
            try {
              await inviteApi.accept({ token, enrollment: material.totp.enrollment, totpCode: code, name: name.trim(), authKey: material.authKey, kdfSalt: material.kdfSalt, kdfIterations: KDF_ITERATIONS, publicKey: material.publicKey, privateKeyEnc: material.privateKeyEnc })
            } finally {
              setCode('')
            }
            setMaterial(null)
            setStep('done')
          })}
        >
          <img className="mx-auto mt-4 h-52 w-52" alt={pl.totpSetup.qrAlt} src={`data:image/svg+xml;utf8,${encodeURIComponent(material.totp.qrSvg)}`} />
          <p className="mt-4 text-sm text-muted-foreground">{pl.totpSetup.manual}</p>
          <p className="mt-1 select-all break-all rounded-control bg-muted px-3 py-2 font-mono text-sm">{material.totp.secret.match(/.{1,4}/g)?.join(' ')}</p>
          <Field label={pl.totpSetup.code} hint={pl.totpSetup.codeHint} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} required disabled={busy} />
          <ErrorNote>{error}</ErrorNote>
          <div className="mt-6 flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {t.submit}
            </Button>
          </div>
        </form>
      </Card>
    )
  }

  return (
    <Card title={t.title}>
      <p className="mt-3 text-sm text-muted-foreground">{t.intro(info.orgName, info.email)}</p>
      <form
        onSubmit={run(async () => {
          const problem = password !== repeat ? t.mismatch : passwordProblem(password, info.email)
          if (problem) throw new Error(problem)
          const totp = await inviteApi.totp(token)
          const salt = newKdfSalt()
          const { authKey, wrapKey } = await deriveKeys(password, salt, KDF_ITERATIONS)
          const pair = await generateUserKeyPair()
          setMaterial({ totp, authKey, kdfSalt: toBase64(salt), publicKey: await exportPublicKey(pair.publicKey), privateKeyEnc: await wrapPrivateKey(pair.privateKey, wrapKey, info.userId) })
          setPassword('')
          setRepeat('')
          setStep('totp')
        })}
      >
        <Field label={t.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" autoFocus required disabled={busy} />
        <Field label={t.password} hint={pl.passwordRules.hint} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required disabled={busy} />
        <Field label={t.repeat} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required disabled={busy} />
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-6 flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {t.next}
          </Button>
          {busy && <span className="text-sm text-muted-foreground">{t.working}</span>}
        </div>
      </form>
    </Card>
  )
}
