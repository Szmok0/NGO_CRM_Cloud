// Kreator pierwszego uruchomienia: token i sprawdzenie → organizacja → administrator → klucz odzyskiwania → 2FA → gotowe.
// Klucze powstają w przeglądarce; hasło, klucz organizacji i klucz odzyskiwania nigdy nie trafiają do serwera.
// Do ostatniego kroku nic nie jest zapisane w bazie (serwer zapisuje wszystko jedną transakcją).
import { useState, type FormEvent, type ReactNode } from 'react'
import { PROFILES, type Profile } from '@shared/modules'
import type { SetupCheckResult, SetupTotpResult } from '@shared/setup'
import { Button, Card, ErrorNote, Field } from '../components/ui'
import { toBase64 } from '../crypto/encoding'
import { KDF_ITERATIONS, deriveKeys, newKdfSalt } from '../crypto/kdf'
import { createSlot, exportPublicKey, generateOrgKey, generateUserKeyPair, wrapPrivateKey } from '../crypto/keys'
import { createRecoverySlot, formatRecoveryKey, generateRecoveryKey } from '../crypto/recovery'
import { pl } from '../i18n/pl'
import { errorMessage, setupApi } from '../lib/api'
import { passwordProblem } from '../lib/password'

const t = pl.setup
const STEPS = 5

/** Wszystko, co powstało w przeglądarce dla nowego konta (tylko w pamięci tej karty). */
interface Material {
  enrollment: SetupTotpResult
  authKey: string
  kdfSalt: string
  publicKey: string
  privateKeyEnc: string
  slot: string
  recoverySlot: string
  /** Klucz odzyskiwania w postaci do wydruku. */
  recoveryText: string
}

async function createMaterial(token: string, email: string, password: string): Promise<Material> {
  const enrollment = await setupApi.totp(token, email)
  const salt = newKdfSalt()
  const { authKey, wrapKey } = await deriveKeys(password, salt, KDF_ITERATIONS)
  const pair = await generateUserKeyPair()
  const orgKey = await generateOrgKey()
  const recovery = generateRecoveryKey()
  return {
    enrollment,
    authKey,
    kdfSalt: toBase64(salt),
    publicKey: await exportPublicKey(pair.publicKey),
    privateKeyEnc: await wrapPrivateKey(pair.privateKey, wrapKey, enrollment.userId),
    slot: await createSlot(orgKey, pair.publicKey, 1),
    recoverySlot: await createRecoverySlot(orgKey, recovery, 1),
    recoveryText: await formatRecoveryKey(recovery)
  }
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card title={`${t.title}: ${title}`} wide>
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500 print:hidden">{t.step(n, STEPS)}</p>
      {children}
    </Card>
  )
}

function Actions({ busy, onBack, submit }: { busy: boolean; onBack?: () => void; submit: string }) {
  return (
    <div className="mt-6 flex items-center gap-3 print:hidden">
      <Button type="submit" disabled={busy}>
        {submit}
      </Button>
      {onBack && (
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          {t.back}
        </Button>
      )}
      {busy && <span className="text-sm text-slate-500">{t.working}</span>}
    </div>
  )
}

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'token' | 'org' | 'admin' | 'recovery' | 'totp' | 'done'>('token')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [token, setToken] = useState('')
  const [checks, setChecks] = useState<SetupCheckResult | null>(null)
  const [orgName, setOrgName] = useState('')
  const [profile, setProfile] = useState<Profile>('projects')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [material, setMaterial] = useState<Material | null>(null)
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')

  /** Wspólna obsługa kroków: blokada przycisków, komunikat błędu. */
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
  const go = (to: typeof step) => {
    setError(null)
    setStep(to)
  }

  if (step === 'token') {
    const ready = checks?.https && checks.storage.ok
    return (
      <Step n={1} title={t.token.checks}>
        <p className="mt-3 text-sm text-slate-600">{t.token.intro}</p>
        <form
          onSubmit={run(async () => {
            if (ready) return go('org')
            setChecks(await setupApi.check(token))
          })}
        >
          <Field label={t.token.label} type="password" value={token} onChange={(e) => (setToken(e.target.value), setChecks(null))} autoComplete="off" autoFocus required disabled={busy} />
          {checks && (
            <ul className="mt-4 space-y-1 text-sm">
              <Check ok={checks.https} label={t.token.https} />
              <Check ok label={t.token.database(checks.migrations)} />
              <Check ok={checks.storage.ok} label={t.token.storage} problem={checks.storage.ok ? undefined : t.token.storageProblems[checks.storage.problem]} />
            </ul>
          )}
          {checks && !ready && <p className="mt-3 text-sm text-amber-800">{t.token.fixAndRetry}</p>}
          <ErrorNote>{error}</ErrorNote>
          <Actions busy={busy} submit={ready ? t.next : checks ? t.token.retry : t.token.submit} />
        </form>
      </Step>
    )
  }

  if (step === 'org') {
    return (
      <Step n={2} title={t.org.title}>
        <form onSubmit={run(async () => go('admin'))}>
          <Field label={t.org.name} value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={200} autoFocus required />
          <fieldset className="mt-4 text-sm">
            <legend className="font-medium text-slate-700">{t.org.profile}</legend>
            {PROFILES.map((p) => (
              <label key={p} className="mt-2 flex cursor-pointer items-start gap-2 rounded border border-slate-200 p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                <input type="radio" name="profile" className="mt-1" checked={profile === p} onChange={() => setProfile(p)} />
                <span>
                  <span className="font-medium">{t.org.profiles[p][0]}</span>
                  <span className="block text-slate-500">{t.org.profiles[p][1]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Actions busy={busy} onBack={() => go('token')} submit={t.next} />
        </form>
      </Step>
    )
  }

  if (step === 'admin') {
    return (
      <Step n={3} title={t.admin.title}>
        <p className="mt-3 text-sm text-slate-600">{t.admin.intro}</p>
        <form
          onSubmit={run(async () => {
            const problem = password !== repeat ? t.admin.mismatch : passwordProblem(password, email)
            if (problem) throw new Error(problem)
            // Stąd nie ma już powrotu do tego kroku: klucze i wydruk klucza odzyskiwania pozostają spójne.
            setMaterial(await createMaterial(token, email.trim().toLowerCase(), password))
            setPassword('')
            setRepeat('')
            setConfirm('')
            go('recovery')
          })}
        >
          <Field label={t.admin.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" autoFocus required disabled={busy} />
          <Field label={t.admin.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required disabled={busy} />
          <Field label={t.admin.password} hint={pl.passwordRules.hint} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required disabled={busy} />
          <Field label={t.admin.repeat} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required disabled={busy} />
          <ErrorNote>{error}</ErrorNote>
          <Actions busy={busy} onBack={() => go('org')} submit={t.next} />
        </form>
      </Step>
    )
  }

  if (step === 'recovery' && material) {
    const key = material.recoveryText
    return (
      <Step n={4} title={t.recovery.title}>
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{t.recovery.warning}</p>
        <p className="mt-3 text-sm text-slate-600 print:hidden">{t.recovery.intro}</p>
        <div className="mt-4 rounded border border-slate-300 p-4">
          <p className="hidden text-sm font-semibold print:block">{t.recovery.printTitle}</p>
          <p className="hidden text-sm print:block">{t.recovery.printOrg(orgName)}</p>
          <p className="mt-2 select-all break-words font-mono text-lg leading-relaxed tracking-wide">{key}</p>
        </div>
        <p className="mt-3 text-xs text-slate-500 print:hidden">{t.recovery.restartNote}</p>
        <form
          onSubmit={run(async () => {
            if (confirm.trim().toUpperCase() !== key.slice(-4)) throw new Error(t.recovery.confirmWrong)
            go('totp')
          })}
        >
          <div className="mt-4 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>
              {t.recovery.print}
            </Button>
          </div>
          <div className="print:hidden">
            <Field label={t.recovery.confirm} hint={t.recovery.confirmHint} value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={4} autoComplete="off" required />
          </div>
          <ErrorNote>{error}</ErrorNote>
          <Actions busy={busy} submit={t.next} />
        </form>
      </Step>
    )
  }

  if (step === 'totp' && material) {
    const { enrollment } = material
    return (
      <Step n={5} title={t.totp.title}>
        <p className="mt-3 text-sm text-slate-600">{pl.totpSetup.intro}</p>
        <form
          onSubmit={run(async () => {
            try {
              await setupApi.complete({
                token,
                enrollment: enrollment.enrollment,
                totpCode: code,
                org: { name: orgName.trim(), profile },
                admin: { name: name.trim(), email: email.trim().toLowerCase(), authKey: material.authKey, kdfSalt: material.kdfSalt, kdfIterations: KDF_ITERATIONS, publicKey: material.publicKey, privateKeyEnc: material.privateKeyEnc },
                keys: { slot: material.slot, recoverySlot: material.recoverySlot }
              })
            } finally {
              setCode('')
            }
            setMaterial(null)
            go('done')
          })}
        >
          <img className="mx-auto mt-4 h-52 w-52" alt={pl.totpSetup.qrAlt} src={`data:image/svg+xml;utf8,${encodeURIComponent(enrollment.qrSvg)}`} />
          <p className="mt-4 text-sm text-slate-600">{pl.totpSetup.manual}</p>
          <p className="mt-1 select-all break-all rounded bg-slate-100 px-3 py-2 font-mono text-sm">{enrollment.secret.match(/.{1,4}/g)?.join(' ')}</p>
          <Field label={pl.totpSetup.code} hint={pl.totpSetup.codeHint} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} required disabled={busy} />
          <ErrorNote>{error}</ErrorNote>
          <Actions busy={busy} onBack={() => go('recovery')} submit={t.totp.submit} />
        </form>
      </Step>
    )
  }

  return (
    <Card title={`${t.title}: ${t.done.title}`} wide>
      <p className="mt-3 text-sm text-slate-700">{t.done.intro}</p>
      <p className="mt-4 text-sm font-medium">{t.done.checklist}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        {t.done.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      <div className="mt-6">
        <Button onClick={onDone}>{t.done.login}</Button>
      </div>
    </Card>
  )
}

function Check({ ok, label, problem }: { ok: boolean; label: string; problem?: string }) {
  return (
    <li className={ok ? 'text-emerald-800' : 'text-red-800'}>
      {ok ? '✓' : '✗'} {label}: {ok ? t.token.ok : (problem ?? '—')}
    </li>
  )
}
