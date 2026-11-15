// Okno anonimizacji osoby (D12): lista treści do przejrzenia, wybór „usuń treść”, potwierdzenie wpisaniem „ANONIMIZUJ”.
import { useState, type ReactNode } from 'react'
import type { AnonymizeActivityItem, AnonymizeTaskItem } from '@shared/api'
import { ANONYMIZE_CONFIRM } from '@shared/domain'
import { pl } from '../i18n/pl'
import { ApiError, call, errorMessage, useLoad } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { Alert, Button, Checkbox, Dialog, ErrorText, Input } from './ui'

function anonymizeError(e: unknown): string {
  if (e instanceof ApiError && e.code === 'VALIDATION') {
    if (e.detail === 'PERSON_ONLY') return pl.anonymize.personOnly
    if (e.detail === 'ALREADY_ANONYMIZED') return pl.anonymize.already
  }
  return errorMessage(e)
}

export function AnonymizeDialog({ contactId, label, onClose, onDone }: { contactId: string; label: string; onClose: () => void; onDone: () => void }) {
  const { data, error } = useLoad('contacts.anonymizePreview', { id: contactId })
  const [activityIds, setActivityIds] = useState<string[]>([])
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const submit = async () => {
    if (!data || confirmText !== ANONYMIZE_CONFIRM) return
    setBusy(true)
    setFormError('')
    try {
      await call('contacts.anonymize', { id: contactId, version: data.version, clearActivityIds: activityIds, clearTaskIds: taskIds, confirm: ANONYMIZE_CONFIRM })
      onDone()
      onClose()
    } catch (e) {
      setFormError(anonymizeError(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={pl.anonymize.title(label)}
      footer={
        <Button variant="destructive" disabled={!data || busy || confirmText !== ANONYMIZE_CONFIRM} onClick={() => void submit()}>
          {pl.anonymize.submit}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone="danger">{pl.anonymize.warning}</Alert>
        <ErrorText>{error}</ErrorText>
        {data && (
          <>
            <p className="text-sm">{pl.anonymize.always(data.attachments)}</p>
            <Section title={pl.anonymize.ownTitle} hint={pl.anonymize.ownHint} empty={data.ownActivities.length === 0}>
              {data.ownActivities.map((a) => (
                <ActivityRow key={a.id} a={a} />
              ))}
            </Section>
            <Section title={pl.anonymize.sharedTitle} hint={pl.anonymize.sharedHint} empty={data.sharedActivities.length === 0}>
              {data.sharedActivities.map((a) => (
                <ActivityRow key={a.id} a={a} checked={activityIds.includes(a.id)} onToggle={() => toggle(activityIds, setActivityIds, a.id)} />
              ))}
            </Section>
            <Section title={pl.anonymize.tasksTitle} hint={pl.anonymize.tasksHint} empty={data.tasks.length === 0}>
              {data.tasks.map((t) => (
                <TaskRow key={t.id} t={t} checked={taskIds.includes(t.id)} onToggle={() => toggle(taskIds, setTaskIds, t.id)} />
              ))}
            </Section>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-secondary-foreground">{pl.anonymize.confirmLabel(ANONYMIZE_CONFIRM)}</span>
              <Input value={confirmText} autoComplete="off" onChange={(e) => setConfirmText(e.target.value)} />
            </label>
          </>
        )}
        <ErrorText>{formError}</ErrorText>
      </div>
    </Dialog>
  )
}

function Section({ title, hint, empty, children }: { title: string; hint: string; empty: boolean; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-1 text-xs text-muted-foreground">{hint}</p>
      {empty ? <p className="text-sm text-muted-foreground">{pl.common.empty}</p> : <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-control border border-border p-2">{children}</ul>}
    </section>
  )
}

function ActivityRow({ a, checked, onToggle }: { a: AnonymizeActivityItem; checked?: boolean; onToggle?: () => void }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {onToggle && <Checkbox className="mt-1" checked={checked} onChange={onToggle} aria-label={pl.anonymize.clearContent} />}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">
          {formatDateTime(a.occurredAt)} · {pl.activityTypes[a.type]}
          {a.deleted && ` · ${pl.common.deletedSuffix}`}
        </div>
        <p className="whitespace-pre-wrap">{a.content || pl.common.none}</p>
      </div>
    </li>
  )
}

function TaskRow({ t, checked, onToggle }: { t: AnonymizeTaskItem; checked: boolean; onToggle: () => void }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Checkbox className="mt-1" checked={checked} onChange={onToggle} aria-label={pl.anonymize.clearContent} />
      <div className="min-w-0">
        <div className="font-medium">
          {t.title || pl.common.none}
          {t.deleted && <span className="text-xs text-muted-foreground"> {pl.common.deletedSuffix}</span>}
        </div>
        {t.description && <p className="whitespace-pre-wrap text-muted-foreground">{t.description}</p>}
      </div>
    </li>
  )
}
