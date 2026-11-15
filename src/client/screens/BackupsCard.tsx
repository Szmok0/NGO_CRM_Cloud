// Kopie zapasowe w ustawieniach (ZADANIE_04, D1, D4; tylko administrator): lista, „Zrób kopię teraz”, pobranie, przypomnienie.
// Pobranie to zwykły link do strumienia z serwera (plik jest zaszyfrowany, otwiera go hasło administratora; krok 2).
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import type { BackupItem } from '@shared/api'
import { Alert, Badge, Button, Card, Empty, ErrorText, Table } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, errorMessage, useLoad } from '../lib/api'
import { formatDateTime } from '../lib/format'

function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

const TONE: Record<BackupItem['status'], 'success' | 'warning' | 'danger'> = { done: 'success', running: 'warning', failed: 'danger' }

export function BackupsCard({ storageConfigured }: { storageConfigured: boolean }) {
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
        <Button variant="outline" size="sm" disabled={busy || running || !storageConfigured} onClick={() => void create()}>
          {pl.backups.now}
        </Button>
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
    </Card>
  )
}
