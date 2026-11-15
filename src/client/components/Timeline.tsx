// Oś aktywności z dodawaniem notatki, kontaktu i wsparcia (przeniesiona z desktopu).
// Usunięcie odsyła `version` wpisu.
import { useState } from 'react'
import { HandHeart, MessageSquare, NotebookPen, Phone, Settings2, Trash2 } from 'lucide-react'
import type { ActionStatus } from '@shared/domain'
import type { ActivityView } from '@shared/types'
import { useApp } from '../app/context'
import { pl } from '../i18n/pl'
import { call, errorMessage } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { ActivityForm, type NewActivityType } from './ActivityForm'
import { Button, Card, Empty, ErrorText } from './ui'

/** Tekst wpisu systemowego (treść w bazie to JSON ze zdarzeniem). */
export function systemText(content: string): string {
  try {
    const e = JSON.parse(content) as { event: string; actionTitle?: string; from?: ActionStatus; to?: ActionStatus }
    if (e.event === 'contact_created') return pl.timeline.system.contact_created
    if (e.event === 'participant_added') return pl.timeline.system.participant_added(e.actionTitle ?? '')
    if (e.event === 'action_status' && e.from && e.to) return pl.timeline.system.action_status(pl.actionStatuses[e.from], pl.actionStatuses[e.to])
  } catch {
    /* zwykły tekst */
  }
  return pl.timeline.system.unknown
}

const ICONS = {
  note: <NotebookPen size={14} />,
  contact: <Phone size={14} />,
  support: <HandHeart size={14} />,
  system: <Settings2 size={14} />
}

export function Timeline({
  activities,
  contactIds,
  actionId,
  onChange,
  showContacts,
  editable
}: {
  activities: ActivityView[]
  contactIds: string[]
  actionId?: string
  onChange: () => void
  showContacts?: boolean
  editable: boolean
}) {
  const { go } = useApp()
  const [adding, onAdding] = useState<NewActivityType | null>(null)
  const [error, setError] = useState('')

  const remove = async (a: ActivityView) => {
    if (!confirm(pl.common.confirmDelete)) return
    setError('')
    try {
      await call('activities.delete', { id: a.id, version: a.version })
      onChange()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Card
      title={pl.timeline.title}
      actions={
        editable && (
          <>
            <Button size="sm" variant="outline" onClick={() => onAdding('note')}>
              <NotebookPen size={13} /> {pl.timeline.addNote}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAdding('contact')}>
              <MessageSquare size={13} /> {pl.timeline.addContact}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAdding('support')}>
              <HandHeart size={13} /> {pl.timeline.addSupport}
            </Button>
          </>
        )
      }
    >
      {adding && (
        <ActivityForm
          key={adding}
          type={adding}
          contactIds={contactIds}
          actionId={actionId}
          onCancel={() => onAdding(null)}
          onSaved={() => {
            onAdding(null)
            onChange()
          }}
        />
      )}
      <ErrorText>{error}</ErrorText>

      {activities.length === 0 && <Empty>{pl.timeline.empty}</Empty>}
      <ol className="flex flex-col">
        {activities.map((a) => (
          <li key={a.id} className="group flex gap-3 border-b border-border py-2.5 last:border-0">
            <div className={`mt-0.5 ${a.type === 'system' ? 'text-muted-foreground' : 'text-primary'}`}>{ICONS[a.type]}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{formatDateTime(a.occurredAt)}</span>
                <span>· {pl.activityTypes[a.type]}</span>
                {a.channel && <span>· {pl.channels[a.channel]}</span>}
                {a.form && <span>· {a.form}</span>}
                {a.durationMinutes ? <span>· {pl.timeline.minutes(a.durationMinutes)}</span> : null}
                {a.authorName && <span>· {a.authorName}</span>}
                {a.actionTitle && !actionId && (
                  <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => go({ name: 'action', id: a.actionId! })}>
                    · {a.actionTitle}
                  </button>
                )}
              </div>
              <p className={`text-sm whitespace-pre-wrap ${a.type === 'system' ? 'text-muted-foreground' : ''}`}>{a.type === 'system' ? systemText(a.content) : a.content || `(${pl.anonymize.contentRemoved})`}</p>
              {showContacts && a.contacts.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {a.contacts.map((c) => (
                    <button key={c.id} type="button" className="cursor-pointer text-xs text-primary hover:underline" onClick={() => go({ name: 'contact', id: c.id })}>
                      {c.label || pl.contacts.anonymized}
                      {c.deleted && ` ${pl.common.deletedSuffix}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {editable && a.type !== 'system' && (
              <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void remove(a)} aria-label={pl.common.delete}>
                <Trash2 size={14} />
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}
