// Dziennik dostępu w ustawieniach (D7, tylko administrator): zdarzenia po polsku, filtry, starsze wpisy partiami, eksport CSV.
import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import type { AccessLogEntry } from '@shared/api'
import { ACCESS_ACTION_LABELS, ACCESS_TARGET_LABELS } from '@shared/exportLabels'
import { Alert, Button, Card, Empty, ErrorText, Field, Input, Select, Table } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, errorMessage, useLoad } from '../lib/api'
import { downloadText } from '../lib/download'
import { formatDateTime } from '../lib/format'

const PAGE = 100

function targetText(e: AccessLogEntry): string {
  if (!e.targetType) return pl.common.none
  if (e.targetType === 'contact' && !e.targetLabel) return pl.accessLog.anonymizedTarget
  const kind = ACCESS_TARGET_LABELS[e.targetType] ?? e.targetType
  return e.targetLabel ? `${kind}: ${e.targetLabel}` : kind
}

export function AccessLogCard() {
  const users = useLoad('users.list', {})
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<AccessLogEntry[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const filter = useCallback(() => ({ userId: userId || null, action: action || null, from: from || null, to: to || null }), [userId, action, from, to])

  // Zmiana filtra wczytuje pierwszą stronę od nowa.
  useEffect(() => {
    let alive = true
    setRows(null)
    setError('')
    call('accessLog.list', { ...filter(), limit: PAGE, offset: 0 })
      .then((r) => {
        if (!alive) return
        setRows(r.rows)
        setHasMore(r.hasMore)
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
    }
  }, [filter])

  const more = async () => {
    if (!rows) return
    setBusy(true)
    setError('')
    try {
      const r = await call('accessLog.list', { ...filter(), limit: PAGE, offset: rows.length })
      setRows([...rows, ...r.rows])
      setHasMore(r.hasMore)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = async () => {
    setBusy(true)
    setError('')
    setDone('')
    try {
      const r = await call('accessLog.exportCsv', filter())
      downloadText(r.filename, '﻿' + r.csv, 'text/csv;charset=utf-8')
      setDone(pl.accessLog.exportDone(r.rows))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title={pl.accessLog.title}
      sub={pl.accessLog.sub}
      actions={
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void exportCsv()}>
          <Download size={13} /> {pl.accessLog.exportCsv}
        </Button>
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label={pl.accessLog.user}>
          <Select className="w-52" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{pl.accessLog.anyUser}</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={pl.accessLog.event}>
          <Select className="w-64" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{pl.accessLog.anyEvent}</option>
            {Object.entries(ACCESS_ACTION_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={pl.common.from}>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={pl.common.to}>
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      {done && <Alert tone="info">{done}</Alert>}
      {rows && rows.length === 0 && <Empty>{pl.accessLog.empty}</Empty>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <th>{pl.accessLog.when}</th>
                <th>{pl.accessLog.who}</th>
                <th>{pl.accessLog.what}</th>
                <th>{pl.accessLog.target}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{formatDateTime(e.at)}</td>
                  <td>{e.userName ?? pl.accessLog.unknownUser}</td>
                  <td>{ACCESS_ACTION_LABELS[e.action] ?? e.action}</td>
                  <td>{targetText(e)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {hasMore && (
        <div className="mt-3">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void more()}>
            {pl.accessLog.more}
          </Button>
        </div>
      )}
    </Card>
  )
}
