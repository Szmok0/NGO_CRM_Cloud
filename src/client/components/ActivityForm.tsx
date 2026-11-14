// Formularz wpisu na osi (przeniesiony z desktopu). Powiązanie wpisu z działaniem dojdzie w kroku 4.
import { useState } from 'react'
import { CHANNELS, type Channel } from '@shared/domain'
import { pl } from '../i18n/pl'
import { call, errorMessage } from '../lib/api'
import { nowLocalInput } from '../lib/format'
import { ContactPicker } from './ContactPicker'
import { Badge, Button, Dialog, ErrorText, Field, Input, Select, Textarea } from './ui'

export type NewActivityType = 'note' | 'contact' | 'support'

function useActivityForm(type: NewActivityType) {
  const [content, setContent] = useState('')
  const [channel, setChannel] = useState<Channel>('phone')
  const [form, setForm] = useState('')
  const [duration, setDuration] = useState('')
  const [when, setWhen] = useState(nowLocalInput())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (contactIds: string[]) => {
    setBusy(true)
    try {
      await call('activities.add', {
        type,
        content,
        channel: type === 'contact' ? channel : null,
        form: type === 'support' ? form : null,
        durationMinutes: duration ? Number(duration) : null,
        occurredAt: new Date(when).toISOString(),
        contactIds
      })
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const fields = (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Field label={pl.timeline.when}>
          <Input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        {type === 'contact' && (
          <Field label={pl.timeline.channel}>
            <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {pl.channels[c]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {type === 'support' && (
          <Field label={pl.timeline.form}>
            <Input maxLength={255} value={form} onChange={(e) => setForm(e.target.value)} />
          </Field>
        )}
        {type !== 'note' && (
          <Field label={pl.timeline.duration}>
            <Input type="number" min={0} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label={pl.timeline.content}>
        <Textarea autoFocus maxLength={20000} value={content} onChange={(e) => setContent(e.target.value)} />
      </Field>
      <ErrorText>{error}</ErrorText>
    </>
  )

  return { fields, save, canSave: content.trim().length > 0 && !!when && !busy }
}

/** Formularz wpisu na osi (na karcie osoby). */
export function ActivityForm({ type, contactIds, onCancel, onSaved }: { type: NewActivityType; contactIds: string[]; onCancel: () => void; onSaved: () => void }) {
  const f = useActivityForm(type)
  return (
    <form
      className="mb-4 flex flex-col gap-3 rounded-control border border-border bg-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault()
        void f.save(contactIds).then((ok) => ok && onSaved())
      }}
    >
      <div className="flex flex-wrap gap-3">
        <Badge tone="primary">{pl.activityTypes[type]}</Badge>
      </div>
      {f.fields}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {pl.common.cancel}
        </Button>
        <Button type="submit" disabled={!f.canSave}>
          {pl.common.save}
        </Button>
      </div>
    </form>
  )
}

/** Wpis na osi w oknie (z „+ Utwórz”), z wyborem osoby, jeśli nie podano. */
export function ActivityDialog({
  type,
  contact: preset,
  onClose,
  onSaved
}: {
  type: NewActivityType
  contact?: { id: string; label: string }
  onClose: () => void
  onSaved: (contactId: string) => void
}) {
  const f = useActivityForm(type)
  const [contact, setContact] = useState(preset ?? null)
  const save = async () => {
    if (!contact) return
    if (await f.save([contact.id])) {
      onSaved(contact.id)
      onClose()
    }
  }
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={type === 'note' ? pl.create.noteTitle : pl.create.contactTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {pl.common.cancel}
          </Button>
          <Button disabled={!f.canSave || !contact} onClick={() => void save()}>
            {pl.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-secondary-foreground">{pl.create.who}</span>
          {contact ? (
            <div className="flex h-9 items-center gap-2 text-sm">
              <span className="font-semibold">{contact.label}</span>
              {!preset && (
                <Button variant="link" size="sm" onClick={() => setContact(null)}>
                  {pl.common.clear}
                </Button>
              )}
            </div>
          ) : (
            <ContactPicker onPick={(c) => setContact({ id: c.id, label: c.label })} />
          )}
        </div>
        {f.fields}
      </div>
    </Dialog>
  )
}
