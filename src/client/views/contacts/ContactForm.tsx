// Dodawanie / edycja osoby lub instytucji (przeniesione z desktopu). Przy osobie: ostrzeżenie o możliwym duplikacie (nie blokada).
// W chmurze edycja odsyła `version` kontaktu i `identityVersion` tożsamości (blokada optymistyczna).
import { useState } from 'react'
import { ROLES, type ContactKind, type Role } from '@shared/domain'
import type { Contact, ContactListItem } from '@shared/types'
import { useApp } from '../../app/context'
import { Alert, Button, Checkbox, Dialog, ErrorText, Field, Input, Textarea } from '../../components/ui'
import { pl } from '../../i18n/pl'
import { call, errorMessage } from '../../lib/api'

interface Form {
  firstName: string
  lastName: string
  name: string
  email: string
  phone: string
  address: string
  city: string
  notes: string
  tags: string
}

const fromContact = (c?: Contact): Form => ({
  firstName: c?.firstName ?? '',
  lastName: c?.lastName ?? '',
  name: c?.name ?? '',
  email: c?.email ?? '',
  phone: c?.phone ?? '',
  address: c?.address ?? '',
  city: c?.city ?? '',
  notes: c?.notes ?? '',
  tags: c?.tags.join(', ') ?? ''
})

export function ContactForm({ kind, contact, onClose, onSaved }: { kind: ContactKind; contact?: Contact; onClose: () => void; onSaved: (id: string) => void }) {
  const { roleLabel } = useApp()
  const [f, setF] = useState<Form>(fromContact(contact))
  const [roles, setRoles] = useState<Role[]>([])
  const [duplicates, setDuplicates] = useState<ContactListItem[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Form, v: string) => {
    setF((x) => ({ ...x, [k]: v }))
    setDuplicates(null)
  }

  const fields = () => ({
    firstName: kind === 'person' ? f.firstName : null,
    lastName: kind === 'person' ? f.lastName : null,
    name: kind === 'institution' ? f.name : null,
    email: f.email,
    phone: f.phone,
    address: f.address,
    city: f.city,
    notes: f.notes,
    tags: f.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  })

  const save = async (skipDuplicateCheck = false) => {
    setError('')
    if (kind === 'person' && (!f.firstName.trim() || !f.lastName.trim())) return setError(pl.contacts.personNameRequired)
    if (kind === 'institution' && !f.name.trim()) return setError(pl.contacts.institutionNameRequired)
    setBusy(true)
    try {
      if (kind === 'person' && !skipDuplicateCheck) {
        const dups = await call('contacts.duplicates', { firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone, excludeId: contact?.id ?? null })
        if (dups.length > 0) return setDuplicates(dups)
      }
      if (contact) {
        await call('contacts.update', { id: contact.id, version: contact.version, identityVersion: contact.identityVersion ?? 0, ...fields() })
        onSaved(contact.id)
      } else {
        const { id } = await call('contacts.create', { kind, ...fields(), roles })
        onSaved(id)
      }
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const title = contact ? pl.contacts.editContact : kind === 'person' ? pl.contacts.newPerson : pl.contacts.newInstitution

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {pl.common.cancel}
          </Button>
          {duplicates ? (
            <Button variant="destructive" disabled={busy} onClick={() => void save(true)}>
              {pl.contacts.saveAnyway}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void save()}>
              {pl.common.save}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {kind === 'person' ? (
          <>
            <Field label={pl.contacts.firstName}>
              <Input autoFocus maxLength={100} value={f.firstName} onChange={(e) => set('firstName', e.target.value)} />
            </Field>
            <Field label={pl.contacts.lastName}>
              <Input maxLength={100} value={f.lastName} onChange={(e) => set('lastName', e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label={pl.contacts.name} className="col-span-2">
            <Input autoFocus maxLength={255} value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
        )}
        <Field label={pl.contacts.email}>
          <Input type="email" maxLength={254} value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label={pl.contacts.phone}>
          <Input maxLength={50} value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label={pl.contacts.address}>
          <Input maxLength={255} value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label={pl.contacts.city}>
          <Input maxLength={100} value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label={pl.contacts.tags} className="col-span-2">
          <Input value={f.tags} onChange={(e) => set('tags', e.target.value)} />
        </Field>
        <Field label={pl.common.notes} className="col-span-2">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {!contact && kind === 'person' && (
          <fieldset className="col-span-2">
            <legend className="text-sm font-medium text-secondary-foreground">{pl.contacts.rolesOnCreate}</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={roles.includes(r)} onChange={(e) => setRoles((x) => (e.target.checked ? [...x, r] : x.filter((y) => y !== r)))} />
                  {roleLabel(r)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
      {duplicates && (
        <div className="mt-4">
          <Alert>
            <p className="mb-1 font-medium">{pl.contacts.duplicateWarning}</p>
            <ul className="list-disc pl-5">
              {duplicates.map((d) => (
                <li key={d.id}>
                  {d.label} {[d.email, d.phone, d.city].filter(Boolean).join(' · ')}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </Dialog>
  )
}
