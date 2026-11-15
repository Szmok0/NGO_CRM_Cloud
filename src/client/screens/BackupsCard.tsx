// Kopie zapasowe w ustawieniach (ZADANIE_04, D1, D4; tylko administrator): lista, „Zrób kopię teraz”, pobranie, przypomnienie.
// Pobranie to zwykły link do strumienia z serwera (plik jest zaszyfrowany, otwiera go hasło administratora; krok 2).
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import type { BackupItem } from '@shared/api'
import { Alert, Badge, Button, Card, Dialog, Empty, ErrorText, Field, Input, Table } from '../components/ui'
import { BackupError, verifyBackup, type BackupSummary } from '../crypto/backupRead'
import { pl } from '../i18n/pl'
import { call, errorMessage, useLoad } from '../lib/api'
import { formatDate, formatDateTime } from '../lib/format'

function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

const TONE: Record<BackupItem['status'], 'success' | 'warning' | 'danger'> = { done: 'success', running: 'warning', failed: 'danger' }

function summaryText(s: BackupSummary): string {
  const v = pl.backups.verify
  const parts = [v.persons(s.persons)]
  if (s.institutions > 0) parts.push(v.institutions(s.institutions))
  parts.push(v.actions(s.actions), v.documents(s.documents))
  return parts.join(', ')
}

/** „Sprawdź kopię” (D4): plik z dysku i hasło zostają w przeglądarce; na serwer idzie tylko wynik po ludzku, bez treści. */
function VerifyDialog({ open, email: initialEmail, onClose, onSaved }: { open: boolean; email: string; onClose: () => void; onSaved: () => void }) {
  const v = pl.backups.verify
  const [file, setFile] = useState<File | null>(null)
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ text: string; warn: string; saved: boolean } | null>(null)

  const close = () => {
    setPassword('')
    setFile(null)
    setError('')
    setResult(null)
    onClose()
  }

  const run = async () => {
    if (!file) return setError(v.noFile)
    setBusy(true)
    setError('')
    try {
      const s = await verifyBackup(file, email, password)
      const text = v.ok(formatDate(s.createdAt), summaryText(s))
      let saved = false
      try {
        saved = (await call('backups.markTested', { createdAt: s.createdAt, result: text.slice(0, 255) })).matched
      } catch {
        // wynik sprawdzenia jest ważny nawet bez zapisu na liście
      }
      setResult({ text, warn: s.filesMissing > 0 ? v.missing(s.filesMissing) : '', saved })
      setPassword('')
      onSaved()
    } catch (e) {
      setError(e instanceof BackupError ? v.problem[e.code] : v.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={v.title}
      footer={
        result ? (
          <>
            <Button variant="outline" onClick={() => setResult(null)}>
              {v.again}
            </Button>
            <Button onClick={close}>{v.close}</Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={close} disabled={busy}>
              {v.close}
            </Button>
            <Button onClick={() => void run()} disabled={busy || !password}>
              {busy ? v.running : v.run}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Alert tone="info">{result.text}</Alert>
          {result.warn && <Alert tone="warning">{result.warn}</Alert>}
          <p className="text-sm text-muted-foreground">{result.saved ? v.saved : v.notSaved}</p>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy && password) void run()
          }}
        >
          <p className="text-sm text-muted-foreground">{v.intro}</p>
          <Field label={v.file}>
            <Input type="file" accept=".ngb" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label={v.email}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </Field>
          <Field label={v.password} hint={v.passwordHint}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      )}
    </Dialog>
  )
}

export function BackupsCard({ storageConfigured, email }: { storageConfigured: boolean; email: string }) {
  const [verifying, setVerifying] = useState(false)
  const [support, setSupport] = useState(false)
  const list = useLoad('backups.list', {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const items = list.data?.items ?? []
  const running = items.some((b) => b.status === 'running')
  const { reload } = list

  // Kopia powstaje w tle: póki trwa, lista odświeża się co 2 s.
  useEffect(() => {
    if (!running) return
    const t = setInterval(reload, 2000)
    return () => clearInterval(t)
  }, [running, reload])

  const create = async () => {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await call('backups.create', {})
      setInfo(pl.backups.started)
      reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  // Po kliknięciu „Pobierz” znacznik pobrania pojawia się z krótkim opóźnieniem.
  const afterDownload = () => setTimeout(reload, 1500)

  return (
    <Card
      title={pl.backups.title}
      sub={pl.backups.sub}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSupport(true)}>
            {pl.supportCopy.button}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setVerifying(true)}>
            {pl.backups.check}
          </Button>
          <Button variant="outline" size="sm" disabled={busy || running || !storageConfigured} onClick={() => void create()}>
            {pl.backups.now}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {!storageConfigured && <Alert tone="danger">{pl.backups.noStorage}</Alert>}
        {list.data?.downloadDue && <Alert tone="warning">{pl.backups.reminder}</Alert>}
        {items[0]?.status === 'failed' && <Alert tone="danger">{pl.backups.lastFailed}</Alert>}
        {info && <Alert tone="info">{info}</Alert>}
        <ErrorText>{error || list.error || ''}</ErrorText>
        {list.data && items.length === 0 && storageConfigured && <Empty>{pl.backups.empty}</Empty>}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <th>{pl.backups.when}</th>
                  <th>{pl.backups.kind}</th>
                  <th>{pl.backups.size}</th>
                  <th>{pl.backups.status}</th>
                  <th>{pl.backups.downloaded}</th>
                  <th>{pl.backups.tested}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap">{formatDateTime(b.startedAt)}</td>
                    <td>{pl.backups.kinds[b.kind]}</td>
                    <td className="whitespace-nowrap">{formatSize(b.sizeBytes)}</td>
                    <td>
                      <Badge tone={TONE[b.status]}>{pl.backups.statuses[b.status]}</Badge>
                    </td>
                    <td className="whitespace-nowrap">{b.downloadedAt ? formatDateTime(b.downloadedAt) : pl.backups.never}</td>
                    <td className="whitespace-nowrap">{b.restoreTestedAt ? formatDateTime(b.restoreTestedAt) : pl.backups.never}</td>
                    <td className="text-right">
                      {b.status === 'done' && (
                        <a
                          href={`/api/backups/${b.id}`}
                          download
                          onClick={afterDownload}
                          className="inline-flex h-8 items-center gap-1.5 rounded-control border border-input px-3 text-sm font-semibold hover:bg-subtle"
                        >
                          <Download size={13} /> {pl.backups.download}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
      <Dialog
        open={support}
        onClose={() => setSupport(false)}
        title={pl.supportCopy.title}
        footer={
          <>
            <Button variant="outline" onClick={() => setSupport(false)}>
              {pl.supportCopy.close}
            </Button>
            <a
              href="/api/support-copy"
              download
              onClick={() => setSupport(false)}
              className="inline-flex h-9 items-center gap-1.5 rounded-control bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Download size={14} /> {pl.supportCopy.download}
            </a>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{pl.supportCopy.intro}</p>
          <Alert tone="warning">{pl.supportCopy.warning}</Alert>
        </div>
      </Dialog>
      <VerifyDialog open={verifying} email={email} onClose={() => setVerifying(false)} onSaved={reload} />
    </Card>
  )
}
