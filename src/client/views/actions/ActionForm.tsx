// Nowe działanie / edycja (przeniesione z desktopu, bez pola osoby odpowiedzialnej — działania v2, D1).
import { useState } from 'react'
import { ACTION_STATUSES, ACTION_TYPES, FRAMEWORKS, type ActionStatus, type ActionType, type Framework } from '@shared/domain'
import type { Action } from '@shared/types'
import { Button, Dialog, ErrorText, Field, Input, Select, Textarea } from '../../components/ui'
import { pl } from '../../i18n/pl'
import { call, errorMessage, useLoad } from '../../lib/api'

export function ActionForm({ action, defaults, onClose, onSaved }: { action?: Action; defaults?: { startDate?: string }; onClose: () => void; onSaved: (id: string) => void }) {
  const topics = useLoad('topics.list', {})
  const [f, setF] = useState({
    title: action?.title ?? '',
    type: action?.type ?? ('training' as ActionType),
    framework: action?.framework ?? ('statutory_free' as Framework),
    status: action?.status ?? ('planned' as ActionStatus),
    startDate: action?.startDate ?? defaults?.startDate ?? '',
    endDate: action?.endDate ?? '',
    place: action?.place ?? '',
    topicId: action?.topicId ?? '',
    description: action?.description ?? '',
    expectedParticipants: action?.expectedParticipants?.toString() ?? ''
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const save = async () => {
    const fields = {
      ...f,
      startDate: f.startDate || null,
      endDate: f.endDate || null,
      topicId: f.type === 'training' ? f.topicId || null : null,
      expectedParticipants: f.expectedParticipants ? Number(f.expectedParticipants) : null
    }
    setBusy(true)
    try {
      if (action) {
        await call('actions.update', { id: action.id, version: action.version, ...fields })
        onSaved(action.id)
      } else {
        onSaved((await call('actions.create', fields)).id)
      }
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={action ? pl.actions.edit : pl.actions.add}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {pl.common.cancel}
          </Button>
          <Button disabled={!f.title.trim() || busy} onClick={() => void save()}>
            {pl.common.save}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={pl.actions.titleField} className="col-span-2">
          <Input autoFocus maxLength={255} value={f.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label={pl.actions.type}>
          <Select value={f.type} onChange={(e) => set('type', e.target.value as ActionType)}>
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {pl.actionTypes[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={pl.actions.framework}>
          <Select value={f.framework} onChange={(e) => set('framework', e.target.value as Framework)}>
            {FRAMEWORKS.map((t) => (
              <option key={t} value={t}>
                {pl.frameworks[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={pl.actions.status}>
          <Select value={f.status} onChange={(e) => set('status', e.target.value as ActionStatus)}>
            {ACTION_STATUSES.map((t) => (
              <option key={t} value={t}>
                {pl.actionStatuses[t]}
              </option>
            ))}
          </Select>
        </Field>
        {f.type === 'training' ? (
          <Field label={pl.actions.topic}>
            <Select value={f.topicId} onChange={(e) => set('topicId', e.target.value)}>
              <option value="">{pl.actions.noTopic}</option>
              {topics.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div />
        )}
        <Field label={pl.actions.startDate}>
          <Input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </Field>
        <Field label={pl.actions.endDate}>
          <Input type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </Field>
        <Field label={pl.actions.place}>
          <Input maxLength={255} value={f.place} onChange={(e) => set('place', e.target.value)} />
        </Field>
        <Field label={pl.actions.expected}>
          <Input type="number" min={0} value={f.expectedParticipants} onChange={(e) => set('expectedParticipants', e.target.value)} />
        </Field>
        <Field label={pl.actions.description} className="col-span-2">
          <Textarea value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </Dialog>
  )
}
