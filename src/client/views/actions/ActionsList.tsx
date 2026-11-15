// Lista działań (przeniesiona z desktopu). Bez filtra „moje” i kolumny osoby odpowiedzialnej (działania v2, D1).
// Eksport CSV z ostrzeżeniem i wpisem w dzienniku dostępu (ZADANIE_03, krok 6).
import { useState } from 'react'
import { ClipboardList, Download, Plus } from 'lucide-react'
import { ACTION_STATUSES, ACTION_TYPES, FRAMEWORKS, type ActionStatus, type ActionType, type Framework } from '@shared/domain'
import { useApp } from '../../app/context'
import { ActionStatusChip, ActionTypeChip } from '../../components/chips'
import { ExportCsvDialog } from '../../components/ExportCsvDialog'
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Select, Table } from '../../components/ui'
import { pl } from '../../i18n/pl'
import { useLoad } from '../../lib/api'
import { dateRange } from '../../lib/format'
import { ActionForm } from './ActionForm'

export function ActionsList() {
  const { go, canWrite } = useApp()
  const [type, setType] = useState<ActionType | ''>('')
  const [status, setStatus] = useState<ActionStatus | ''>('')
  const [framework, setFramework] = useState<Framework | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { data, error } = useLoad('actions.list', {
    type: type || null,
    status: status || null,
    framework: framework || null,
    from: from || null,
    to: to || null,
    q: q || null
  })

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            {pl.actions.title}
            {data && <Badge tone="muted">{data.length}</Badge>}
          </span>
        }
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setExporting(true)}>
                <Download size={14} /> {pl.common.exportCsv}
              </Button>
              <Button onClick={() => setAdding(true)}>
                <Plus size={14} /> {pl.actions.add}
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field label={pl.common.filter}>
            <Input className="w-56" placeholder={pl.common.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field label={pl.actions.type}>
            <Select className="w-40" value={type} onChange={(e) => setType(e.target.value as ActionType | '')}>
              <option value="">{pl.actions.anyType}</option>
              {ACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {pl.actionTypes[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={pl.actions.status}>
            <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value as ActionStatus | '')}>
              <option value="">{pl.actions.anyStatus}</option>
              {ACTION_STATUSES.map((t) => (
                <option key={t} value={t}>
                  {pl.actionStatuses[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={pl.actions.framework}>
            <Select className="w-64" value={framework} onChange={(e) => setFramework(e.target.value as Framework | '')}>
              <option value="">{pl.actions.anyFramework}</option>
              {FRAMEWORKS.map((t) => (
                <option key={t} value={t}>
                  {pl.frameworks[t]}
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
      </PageHeader>
      <ErrorText>{error}</ErrorText>
      <Card flush>
        {data && data.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={20} />}
            text={pl.actions.empty}
            action={
              canWrite && (
                <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                  <Plus size={14} /> {pl.actions.add}
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto px-3 pb-2">
            <Table>
              <thead>
                <tr>
                  <th>{pl.actions.titleField}</th>
                  <th>{pl.actions.type}</th>
                  <th>{pl.actions.status}</th>
                  <th>{pl.common.date}</th>
                  <th>{pl.actions.place}</th>
                  <th className="text-right">{pl.actions.participantsCount}</th>
                  <th className="text-right">{pl.actions.sessionsCount}</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((a) => (
                  <tr key={a.id} className="cursor-pointer" onClick={() => go({ name: 'action', id: a.id })}>
                    <td>
                      <button type="button" className="cursor-pointer text-left font-semibold hover:text-primary" onClick={(e) => (e.stopPropagation(), go({ name: 'action', id: a.id }))}>
                        {a.title}
                      </button>
                      <div className="text-xs text-muted-foreground">{[a.topicName, pl.frameworks[a.framework]].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>
                      <ActionTypeChip type={a.type} />
                    </td>
                    <td>
                      <ActionStatusChip status={a.status} />
                    </td>
                    <td className="whitespace-nowrap">{dateRange(a.startDate, a.endDate)}</td>
                    <td>{a.place}</td>
                    <td className="text-right">{a.participantCount}</td>
                    <td className="text-right">{a.sessionCount}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      {exporting && (
        <ExportCsvDialog
          source={{ list: 'actions', filter: { type: type || null, status: status || null, framework: framework || null, from: from || null, to: to || null, q: q || null } }}
          onClose={() => setExporting(false)}
        />
      )}
      {adding && <ActionForm onClose={() => setAdding(false)} onSaved={(id) => go({ name: 'action', id })} />}
    </div>
  )
}
