// Karta osoby lub instytucji (przeniesiona z desktopu). Każdy zapis odsyła `version` rekordu; błąd (np. konflikt wersji) pokazuje karta.
import { useState, type ReactNode } from 'react'
import { Building2, CheckSquare, HandHeart, MessageSquare, NotebookPen, Pencil, Plus, Trash2, X } from 'lucide-react'
import { CONSENT_TYPES, RELATIONSHIP_TYPES, ROLES, type ConsentType, type RelationshipType, type Role } from '@shared/domain'
import type { ContactDetail, ContactListItem } from '@shared/types'
import { useApp } from '../../app/context'
import { ActionStatusChip, RoleChip } from '../../components/chips'
import { ActivityDialog, type NewActivityType } from '../../components/ActivityForm'
import { ContactPicker } from '../../components/ContactPicker'
import { TaskDialog } from '../../components/TaskDialog'
import { TargetTasks } from '../../components/TaskRows'
import { Timeline } from '../../components/Timeline'
import { Avatar, Badge, Button, Card, Dialog, Empty, ErrorText, Field, Input, Select } from '../../components/ui'
import { pl } from '../../i18n/pl'
import { call, errorMessage, useLoad } from '../../lib/api'
import { formatDate, todayYmd } from '../../lib/format'
import { ContactForm } from './ContactForm'

/** Akcja zapisu z karty: po sukcesie odświeżenie, po błędzie komunikat. */
function useAction(onChange: () => void) {
  const [error, setError] = useState('')
  const run = (fn: () => Promise<unknown>) => {
    setError('')
    fn()
      .then(onChange)
      .catch((e: unknown) => setError(errorMessage(e)))
  }
  return { error, run }
}

export function ContactCard({ id }: { id: string }) {
  const { back, go, canWrite, moduleOn } = useApp()
  const { data, error, reload } = useLoad('contacts.get', { id })
  const [editing, setEditing] = useState(false)
  const [entry, setEntry] = useState<NewActivityType | null>(null)
  const [addingTask, setAddingTask] = useState(false)
  const action = useAction(reload)

  if (error) return <ErrorText>{error}</ErrorText>
  if (!data) return null
  const c = data.contact
  const isPerson = c.kind === 'person'
  const label = data.label || pl.contacts.anonymized
  const today = todayYmd()
  const activeRoles = data.roles.filter((r) => !r.until || r.until >= today)
  const editable = canWrite && !c.deletedAt && c.identityVersion !== null

  const remove = () => {
    if (!confirm(pl.common.confirmDelete)) return
    action.run(async () => {
      await call('contacts.delete', { id, version: c.version })
      back()
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center gap-5 rounded-card border border-border bg-background px-6 py-5 shadow-card">
        {isPerson ? (
          <Avatar id={c.id} name={label} size={64} />
        ) : (
          <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
            <Building2 size={28} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-xs font-semibold text-muted-foreground">{pl.contacts.kind[c.kind]}</div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
            {label}
            {c.deletedAt && <Badge tone="danger">{pl.common.deletedSuffix}</Badge>}
          </h1>
          {activeRoles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label={pl.contacts.roles}>
              {activeRoles.map((r) => (
                <RoleChip key={r.id} role={r.role} />
              ))}
            </div>
          )}
        </div>
        {editable && (
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2" role="group" aria-label={pl.contacts.quickActions}>
              <Button variant="outline" onClick={() => setEntry('note')}>
                <NotebookPen size={15} /> {pl.timeline.addNote}
              </Button>
              <Button variant="outline" onClick={() => setEntry('contact')}>
                <MessageSquare size={15} /> {pl.timeline.addContact}
              </Button>
              <Button variant="outline" onClick={() => setEntry('support')}>
                <HandHeart size={15} /> {pl.timeline.addSupport}
              </Button>
              {moduleOn('tasks') && (
                <Button variant="outline" onClick={() => setAddingTask(true)}>
                  <CheckSquare size={15} /> {pl.create.task}
                </Button>
              )}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                <Pencil size={14} /> {pl.common.edit}
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={remove}>
                <Trash2 size={14} /> {pl.contacts.deleteContact}
              </Button>
            </div>
          </div>
        )}
      </section>
      <ErrorText>{action.error}</ErrorText>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-4">
          <Card title={pl.contacts.data}>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <Row label={pl.contacts.email}>{c.email}</Row>
              <Row label={pl.contacts.phone}>{c.phone}</Row>
              <Row label={pl.contacts.address}>{c.address}</Row>
              <Row label={pl.contacts.city}>{c.city}</Row>
              <Row label={pl.contacts.tag}>{c.tags.join(', ')}</Row>
              <Row label={pl.common.notes}>{c.notes && <span className="whitespace-pre-wrap">{c.notes}</span>}</Row>
            </dl>
          </Card>
          {isPerson && <RolesCard data={data} editable={editable} onChange={reload} />}
          <RelationshipsCard data={data} editable={editable} onChange={reload} />
          {isPerson && <ConsentsCard data={data} editable={editable} onChange={reload} />}
          {isPerson && moduleOn('actions') && (
            <Card title={pl.contacts.participations}>
              {data.participations.length === 0 && <Empty>{pl.contacts.noParticipations}</Empty>}
              <ul className="flex flex-col gap-1">
                {data.participations.map((p) => (
                  <li key={p.participantId} className="flex items-center gap-2 text-sm">
                    <button type="button" className="cursor-pointer font-medium text-primary hover:underline" onClick={() => go({ name: 'action', id: p.action.id })}>
                      {p.action.title}
                    </button>
                    <span className="text-xs text-muted-foreground">{formatDate(p.action.startDate)}</span>
                    <ActionStatusChip status={p.action.status} />
                    <Badge tone={p.status === 'resigned' ? 'muted' : 'default'}>{pl.participantStatuses[p.status]}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {moduleOn('tasks') && <TargetTasks tasks={data.tasks} target={{ targetType: 'contact', targetId: id, targetLabel: label }} editable={editable} onChange={reload} />}
          <Timeline activities={data.activities} contactIds={[id]} editable={editable} onChange={reload} />
        </div>
      </div>
      {editing && <ContactForm kind={c.kind} contact={c} onClose={() => setEditing(false)} onSaved={reload} />}
      {addingTask && <TaskDialog taskId={null} defaults={{ targetType: 'contact', targetId: id, targetLabel: label }} onClose={() => setAddingTask(false)} onSaved={reload} />}
      {entry && <ActivityDialog key={entry} type={entry} contact={{ id, label }} onClose={() => setEntry(null)} onSaved={reload} />}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children || pl.common.none}</dd>
    </>
  )
}

/** Przycisk usuwania pozycji z listy (widoczny po najechaniu i z klawiatury). */
function RemoveButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} className={`h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ${className ?? ''}`} onClick={onClick}>
      <X size={12} />
    </Button>
  )
}

function RolesCard({ data, editable, onChange }: { data: ContactDetail; editable: boolean; onChange: () => void }) {
  const { roleLabel } = useApp()
  const [role, setRole] = useState<Role>('participant')
  const [adding, setAdding] = useState(false)
  const { error, run } = useAction(onChange)
  const today = todayYmd()
  return (
    <Card
      title={pl.contacts.roles}
      actions={
        editable && (
          <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
            <Plus size={13} /> {pl.contacts.addRole}
          </Button>
        )
      }
    >
      {adding && (
        <div className="mb-3 flex gap-2">
          <Select aria-label={pl.contacts.role} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
          <Button
            onClick={() =>
              run(async () => {
                await call('roles.add', { contactId: data.contact.id, role, since: today, note: null })
                setAdding(false)
              })
            }
          >
            {pl.common.add}
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {data.roles.length === 0 && <Empty>{pl.common.empty}</Empty>}
      <ul className="flex flex-col gap-1">
        {data.roles.map((r) => {
          const ended = !!r.until && r.until < today
          return (
            <li key={r.id} className="group flex items-center gap-2 text-sm">
              {ended ? <Badge tone="muted">{roleLabel(r.role)}</Badge> : <RoleChip role={r.role} />}
              <span className="text-xs text-muted-foreground">
                {r.since && pl.contacts.roleSince(formatDate(r.since))} {r.until && pl.contacts.roleUntil(formatDate(r.until))}
              </span>
              {editable && !r.until && (
                <Button variant="link" size="sm" className="ml-auto h-auto" onClick={() => run(() => call('roles.end', { id: r.id, version: r.version, until: today }))}>
                  {pl.contacts.endRole}
                </Button>
              )}
              {editable && (
                <RemoveButton
                  label={pl.contacts.removeItem}
                  className={r.until ? 'ml-auto' : ''}
                  onClick={() => confirm(pl.common.confirmDelete) && run(() => call('roles.delete', { id: r.id, version: r.version }))}
                />
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function RelationshipsCard({ data, editable, onChange }: { data: ContactDetail; editable: boolean; onChange: () => void }) {
  const { go } = useApp()
  const [open, setOpen] = useState(false)
  const [other, setOther] = useState<ContactListItem | null>(null)
  const [type, setType] = useState<RelationshipType>(data.contact.kind === 'person' ? 'works_at' : 'contact_person')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const { error, run } = useAction(onChange)
  const isPerson = data.contact.kind === 'person'

  const save = async () => {
    if (!other) return
    // strona A to osoba („pracuje w”, „osoba kontaktowa” instytucji, „opiekun”)
    const selfIsA = isPerson || other.kind === 'institution'
    try {
      await call('relationships.add', {
        contactAId: selfIsA ? data.contact.id : other.id,
        contactBId: selfIsA ? other.id : data.contact.id,
        type,
        note
      })
      setOpen(false)
      setOther(null)
      setNote('')
      onChange()
    } catch (e) {
      setFormError(errorMessage(e))
    }
  }

  return (
    <Card
      title={isPerson ? pl.contacts.relationships : pl.contacts.relatedPeople}
      actions={
        editable && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus size={13} /> {pl.contacts.addRelationship}
          </Button>
        )
      }
    >
      <ErrorText>{error}</ErrorText>
      {data.relationships.length === 0 && <Empty>{pl.common.empty}</Empty>}
      <ul className="flex flex-col gap-1">
        {data.relationships.map((r) => (
          <li key={r.id} className="group flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{r.isA ? pl.relationshipTypes[r.type] : pl.relationshipTypesReverse[r.type]}</span>
            <button type="button" className="cursor-pointer font-medium text-primary hover:underline" onClick={() => go({ name: 'contact', id: r.other.id })}>
              {r.other.label || pl.contacts.anonymized}
              {r.other.deleted && ` ${pl.common.deletedSuffix}`}
            </button>
            {r.note && <span className="text-xs text-muted-foreground">({r.note})</span>}
            {editable && (
              <RemoveButton
                label={pl.contacts.removeItem}
                className="ml-auto"
                onClick={() => confirm(pl.common.confirmDelete) && run(() => call('relationships.delete', { id: r.id, version: r.version }))}
              />
            )}
          </li>
        ))}
      </ul>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={pl.contacts.addRelationship}
        footer={
          <Button disabled={!other} onClick={() => void save()}>
            {pl.common.save}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={pl.contacts.relatedWith}>
            {other ? (
              <div className="flex items-center gap-2 text-sm font-medium">
                {other.label}
                <Button variant="link" size="sm" onClick={() => setOther(null)}>
                  {pl.common.clear}
                </Button>
              </div>
            ) : (
              <ContactPicker onPick={setOther} exclude={[data.contact.id]} kind={isPerson ? 'all' : 'person'} />
            )}
          </Field>
          <Field label={pl.contacts.relationType}>
            <Select value={type} onChange={(e) => setType(e.target.value as RelationshipType)}>
              {RELATIONSHIP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {pl.relationshipTypes[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={pl.common.note}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorText>{formError}</ErrorText>
        </div>
      </Dialog>
    </Card>
  )
}

function ConsentsCard({ data, editable, onChange }: { data: ContactDetail; editable: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ConsentType>('processing')
  const [basis, setBasis] = useState('')
  const [givenAt, setGivenAt] = useState(todayYmd())
  const [validUntil, setValidUntil] = useState('')
  const [formError, setFormError] = useState('')
  const { error, run } = useAction(onChange)
  const today = todayYmd()

  const save = async () => {
    try {
      await call('consents.add', { contactId: data.contact.id, type, basis, givenAt, validUntil: validUntil || null, note: null })
      setOpen(false)
      onChange()
    } catch (e) {
      setFormError(errorMessage(e))
    }
  }

  return (
    <Card
      title={pl.contacts.consents}
      actions={
        editable && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus size={13} /> {pl.contacts.addConsent}
          </Button>
        )
      }
    >
      <ErrorText>{error}</ErrorText>
      {data.consents.length === 0 && <Empty>{pl.common.empty}</Empty>}
      <ul className="flex flex-col gap-1">
        {data.consents.map((c) => {
          const inactive = !!c.withdrawnAt || (!!c.validUntil && c.validUntil < today)
          return (
            <li key={c.id} className="group flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={inactive ? 'danger' : 'success'}>{pl.consentTypes[c.type]}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatDate(c.givenAt)}
                {c.basis && ` · ${c.basis}`}
                {c.validUntil && ` · ${pl.contacts.validUntil(formatDate(c.validUntil))}`}
                {c.withdrawnAt && ` · ${pl.contacts.withdrawn(formatDate(c.withdrawnAt))}`}
              </span>
              {editable && !c.withdrawnAt && (
                <Button variant="link" size="sm" className="ml-auto h-auto" onClick={() => run(() => call('consents.withdraw', { id: c.id, version: c.version, at: today }))}>
                  {pl.contacts.withdraw}
                </Button>
              )}
              {editable && (
                <RemoveButton
                  label={pl.contacts.removeItem}
                  className={c.withdrawnAt ? 'ml-auto' : ''}
                  onClick={() => confirm(pl.common.confirmDelete) && run(() => call('consents.delete', { id: c.id, version: c.version }))}
                />
              )}
            </li>
          )
        })}
      </ul>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={pl.contacts.addConsent}
        footer={
          <Button disabled={!givenAt} onClick={() => void save()}>
            {pl.common.save}
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={pl.contacts.consentType}>
            <Select value={type} onChange={(e) => setType(e.target.value as ConsentType)}>
              {CONSENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {pl.consentTypes[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={pl.contacts.consentBasis}>
            <Input maxLength={255} value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
          <Field label={pl.contacts.consentGiven}>
            <Input type="date" value={givenAt} onChange={(e) => setGivenAt(e.target.value)} />
          </Field>
          <Field label={pl.contacts.consentValid}>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
          <div className="col-span-2">
            <ErrorText>{formError}</ErrorText>
          </div>
        </div>
      </Dialog>
    </Card>
  )
}
