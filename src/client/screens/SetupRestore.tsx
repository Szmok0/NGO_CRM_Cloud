// „Odtwórz z kopii” w kreatorze pierwszego uruchomienia (ZADANIE_04, D6).
// Przeglądarka sprawdza e-mail i hasło (odwija klucz kopii), wysyła plik kawałkami i oddaje serwerowi klucz kopii
// tylko do tego pliku. Hasło nie opuszcza przeglądarki.
import { useState, type FormEvent } from 'react'
import { RESTORE_CHUNK_BYTES, type SetupCheckResult, type SetupRestoreResult } from '@shared/setup'
import { AuthCard, Button, ErrorNote, InputField } from '../components/ui'
import { BackupError, openBackup } from '../crypto/backupRead'
import { toBase64 } from '../crypto/encoding'
import { pl } from '../i18n/pl'
import { errorMessage, setupApi } from '../lib/api'

const t = pl.setup
const r = pl.setup.restore

function summary(x: SetupRestoreResult): string {
  const v = pl.backups.verify
  const parts = [v.persons(x.persons)]
  if (x.institutions > 0) parts.push(v.institutions(x.institutions))
  parts.push(v.actions(x.actions), v.documents(x.documents))
  return parts.join(', ')
}

export function SetupRestore({ token, checks, onBack, onDone }: { token: string; checks: SetupCheckResult | null; onBack: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SetupRestoreResult | null>(null)

  const run = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) return setError(r.noFile)
    setBusy(true)
    setError(null)
    try {
      setStatus(r.checking)
      const opened = await openBackup(file, email, password, true) // błąd: zły plik, e-mail, hasło, uszkodzenie
      if (checks && opened.header.migrations > checks.migrations) throw new BackupError('newer_format')
      const key = toBase64(await crypto.subtle.exportKey('raw', opened.key))

      const { uploadId } = await setupApi.restoreBegin(token)
      for (let off = 0; off < file.size; off += RESTORE_CHUNK_BYTES) {
        setStatus(r.uploading(Math.floor((off / file.size) * 100)))
        const part = new Uint8Array(await file.slice(off, off + RESTORE_CHUNK_BYTES).arrayBuffer())
        await setupApi.restoreChunk(token, uploadId, off, part)
      }
      setStatus(r.restoring)
      setResult(await setupApi.restoreFinish(token, uploadId, key))
      setPassword('')
    } catch (err) {
      if (err instanceof BackupError) setError(err.code === 'newer_format' ? r.newer : pl.backups.verify.problem[err.code])
      else setError(errorMessage(err))
    } finally {
      setBusy(false)
      setStatus('')
    }
  }

  if (result) {
    return (
      <AuthCard title={`${t.title}: ${r.doneTitle}`} wide>
        <p className="mt-3 text-sm">{r.doneIntro(summary(result))}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {result.erasuresApplied > 0 && <li>{r.erasures(result.erasuresApplied)}</li>}
          {result.filesMissing > 0 && <li>{r.missing(result.filesMissing)}</li>}
          {result.twoFaReset && <li className="text-amber-800">{r.twoFaReset}</li>}
          <li>{r.noErasureFile}</li>
        </ul>
        <div className="mt-6">
          <Button onClick={onDone}>{r.login}</Button>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={`${t.title}: ${r.title}`} wide>
      <p className="mt-3 text-sm text-slate-600">{r.intro}</p>
      <form onSubmit={(e) => void run(e)}>
        <label className="mt-4 block text-sm">
          <span className="font-medium text-secondary-foreground">{r.file}</span>
          <input type="file" accept=".ngb" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
        </label>
        <InputField label={r.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required disabled={busy} />
        <InputField label={r.password} hint={r.passwordHint} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required disabled={busy} />
        <ErrorNote>{error}</ErrorNote>
        {status && <p className="mt-3 text-sm text-slate-500">{status}</p>}
        <div className="mt-6 flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {r.start}
          </Button>
          <Button variant="outline" onClick={onBack} disabled={busy}>
            {r.cancel}
          </Button>
        </div>
      </form>
    </AuthCard>
  )
}

