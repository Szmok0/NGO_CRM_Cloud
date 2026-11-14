// Tematy szkoleń: lista i karta tematu (przeniesione z desktopu, bez materiałów i notatek wiedzy — ZADANIE_05).
import { useState } from 'react'
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Topic } from '@shared/types'
import { useApp } from '../app/context'
import { ActionStatusChip } from '../components/chips'
import { Badge, Button, Card, Dialog, Empty, EmptyState, ErrorText, Field, Input, PageHeader, Table, Textarea } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, errorMessage, useLoad } from '../lib/api'
import { dateRange } from '../lib/format'

function TopicForm({ topic, onClose, onSaved }: { topic?: Topic; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: topic?.name ?? '',
    description: topic?.description ?? '',
    program: topic?.program ?? '',
    durationHours: topic?.durationHours?.toString() ?? ''
  })
  const [error, setError] = useState('')
  const save = async () => {
    const fields = { ...f, durationHours: f.durationHours ? Number(f.durationHours) : null }
    try {
      if (topic) await call('topics.update', { id: topic.id, version: topic.version, ...fields })
      else await call('topics.create', fields)
      onSaved()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={topic ? topic.name : pl.topics.add}
      footer={
        <Button disabled={!f.name.trim()} onClick={() => void save()}>
          {pl.common.save}
        </Button>
      }
    >
      <div className="grid grid-cols-[1fr_10rem] gap-3">
        <Field label={pl.topics.name}>
          <Input autoFocus maxLength={255} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={pl.topics.hours}>
          <Input type="number" min={0} value={f.durationHours} onChange={(e) => setF({ ...f, durationHours: e.target.value })} />
        </Field>
        <Field label={pl.topics.description} className="col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label={pl.topics.program} className="col-span-2">
          <Textarea className="min-h-40" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} />
        </Field>
        <div className="col-span-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
    </Dialog>
  )
}

export function TopicsView() {
  const { go, canWrite } = useApp()
  const { data, error, reload } = useLoad('topics.list', {})
  const [adding, setAdding] = useState(false)
  return (
    <div>
      <PageHeader
        title={pl.topics.title}
        actions={
          canWrite && (
            <Button onClick={() => setAdding(true)}>
              <Plus size={14} /> {pl.topics.add}
            </Button>
          )
        }
      />
      <ErrorText>{error}</ErrorText>
      <Card flush>
        {data?.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={20} />}
            text={pl.topics.empty}
            action={
              canWrite && (
                <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                  <Plus size={14} /> {pl.topics.add}
                </Button>
              )
            }
          />
        ) : (
          <div className="px-3 pb-2">
            <Table>
              <thead>
                <tr>
                  <th>{pl.topics.name}</th>
                  <th>{pl.topics.description}</th>
                  <th className="text-right">{pl.topics.hours}</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((t) => (
                  <tr key={t.id} className="cursor-pointer" onClick={() => go({ name: 'topic', id: t.id })}>
                    <td>
                      <button type="button" className="cursor-pointer text-left font-semibold hover:text-primary" onClick={(e) => (e.stopPropagation(), go({ name: 'topic', id: t.id }))}>
                        {t.name}
                      </button>
                    </td>
                    <td className="text-muted-foreground">{t.description}</td>
                    <td className="text-right">{t.durationHours ? <Badge tone="primary">{pl.topics.hoursValue(t.durationHours)}</Badge> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      {adding && <TopicForm onClose={() => setAdding(false)} onSaved={reload} />}
    </div>
  )
}

export function TopicDetailView({ id }: { id: string }) {
  const { go, back, canWrite } = useApp()
  const { data, error, reload } = useLoad('topics.get', { id })
  const [editing, setEditing] = useState(false)
  const [actionError, setActionError] = useState('')
  if (error) return <ErrorText>{error}</ErrorText>
  if (!data) return null
  const t = data.topic
  const editable = canWrite && !t.deletedAt

  const remove = async () => {
    if (!confirm(pl.common.confirmDelete)) return
    try {
      await call('topics.delete', { id, version: t.version })
      back()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t.name}
        actions={
          editable && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil size={14} /> {pl.common.edit}
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={() => void remove()}>
                <Trash2 size={14} /> {pl.common.delete}
              </Button>
            </>
          )
        }
      />
      <ErrorText>{actionError}</ErrorText>
      <Card>
        {t.durationHours ? <p className="mb-2 text-sm">{pl.topics.hoursValue(t.durationHours)}</p> : null}
        {t.description && <p className="mb-3 text-sm">{t.description}</p>}
        {t.program && <pre className="font-sans text-sm whitespace-pre-wrap">{t.program}</pre>}
        {!t.durationHours && !t.description && !t.program && <Empty>{pl.common.empty}</Empty>}
      </Card>
      <Card title={pl.topics.trainings}>
        {data.actions.length === 0 && <Empty>{pl.topics.noTrainings}</Empty>}
        <ul className="flex flex-col gap-1">
          {data.actions.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <button type="button" className="cursor-pointer font-medium text-primary hover:underline" onClick={() => go({ name: 'action', id: a.id })}>
                {a.title}
              </button>
              <span className="text-xs text-muted-foreground">{dateRange(a.startDate, a.endDate)}</span>
              <ActionStatusChip status={a.status} />
            </li>
          ))}
        </ul>
      </Card>
      {editing && <TopicForm topic={t} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  )
}
