// Okres przechowywania danych osób (ZADANIE_04, D10; tylko administrator): ustawienie okresu i lista osób do przejrzenia.
// Nic nie dzieje się samo: przy osobie administrator wybiera „Usuń na stałe…” (okno anonimizacji) albo „Zostaw jeszcze na rok”.
import { useEffect, useState } from 'react'
import { AnonymizeDialog } from '../components/AnonymizeDialog'
import { Alert, Button, Card, Empty, ErrorText, Field, Input, Table } from '../components/ui'
import { pl } from '../i18n/pl'
import { ApiError, call, errorMessage, useLoad } from '../lib/api'
import { formatDate } from '../lib/format'

export function RetentionCard() {
  const list = useLoad('retention.list', {})
  const { reload } = list
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [deleting, setDeleting] = useState<{ id: string; label: string } | null>(null)
  const loaded = list.data !== undefined && list.data !== null
  const months = list.data?.months ?? null

  useEffect(() => {
    if (loaded) setValue(months === null ? '' : String(months))
  }, [loaded, months])

  const save = async () => {
    const trimmed = value.trim()
    const n = trimmed === '' ? null : Number(trimmed)
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 240)) return setError(pl.retention.invalid)
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await call('retention.setPeriod', { months: n })
      setInfo(pl.retention.saved)
      reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const keep = async (contactId: string, version: number) => {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await call('retention.snooze', { contactId, version })
      setInfo(pl.retention.kept)
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? pl.retention.conflict : errorMessage(e))
    } finally {
      setBusy(false)
      reload()
    }
  }

  const items = list.data?.items ?? []

  return (
    <Card title={pl.retention.title} sub={pl.retention.sub}>
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy) void save()
          }}
        >
          <Field label={pl.retention.periodLabel} hint={pl.retention.periodHint}>
            <Input type="number" min={1} max={240} inputMode="numeric" className="w-32" placeholder="24" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Button type="submit" variant="outline" size="sm" disabled={busy || !loaded}>
            {pl.retention.save}
          </Button>
        </form>
        <p className="text-sm text-muted-foreground">{pl.retention.rule}</p>
        {info && <Alert tone="info">{info}</Alert>}
        <ErrorText>{error || list.error || ''}</ErrorText>
        {loaded && months === null && <Empty>{pl.retention.off}</Empty>}
        {loaded && months !== null && items.length === 0 && <Empty>{pl.retention.empty}</Empty>}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <h3 className="mb-2 text-sm font-bold">{pl.retention.listTitle(items.length)}</h3>
            <Table>
              <thead>
                <tr>
                  <th>{pl.retention.person}</th>
                  <th>{pl.retention.last}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.contactId}>
                    <td className="font-semibold">{p.label}</td>
                    <td className="whitespace-nowrap">
                      {formatDate(p.lastActivityOn)} ({pl.retention.months(p.monthsInactive)})
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => void keep(p.contactId, p.version)}>
                          {pl.retention.keep}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setDeleting({ id: p.contactId, label: p.label })}>
                          {pl.retention.delete}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
      {deleting && <AnonymizeDialog contactId={deleting.id} label={deleting.label} onClose={() => setDeleting(null)} onDone={reload} />}
    </Card>
  )
}
