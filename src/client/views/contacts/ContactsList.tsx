// Lista osób i instytucji (przeniesiona z desktopu). Bez eksportu CSV: eksport danych osobowych z ostrzeżeniem
// i wpisem w dzienniku dostępu dojdzie z danymi wrażliwymi (ZADANIE_03).
import { useState } from 'react'
import { Building2, Plus, Users } from 'lucide-react'
import { ROLES, type ContactKind, type Role } from '@shared/domain'
import { useApp } from '../../app/context'
import { RoleChip } from '../../components/chips'
import { Avatar, Badge, Button, Card, EmptyState, ErrorText, Input, PageHeader, Select, Table, Tabs } from '../../components/ui'
import { pl } from '../../i18n/pl'
import { useLoad } from '../../lib/api'
import { ContactForm } from './ContactForm'

export function ContactsList() {
  const { go, roleLabel, canWrite } = useApp()
  const [kind, setKind] = useState<ContactKind | 'all'>('all')
  const [role, setRole] = useState<Role | ''>('')
  const [tag, setTag] = useState('')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState<ContactKind | null>(null)
  const { data, error } = useLoad('contacts.list', { kind, role: role || null, tag: tag || null, q: q || null })
  const tags = useLoad('contacts.tags', {})

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            {pl.contacts.title}
            {data && <Badge tone="muted">{data.length}</Badge>}
          </span>
        }
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setAdding('institution')}>
                <Building2 size={14} /> {pl.contacts.addInstitution}
              </Button>
              <Button onClick={() => setAdding('person')}>
                <Plus size={14} /> {pl.contacts.addPerson}
              </Button>
            </>
          )
        }
      >
        <Tabs
          value={kind}
          onChange={setKind}
          tabs={[
            { id: 'all', label: pl.common.all },
            { id: 'person', label: pl.contacts.persons },
            { id: 'institution', label: pl.contacts.institutions }
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" aria-label={pl.common.search} placeholder={pl.common.search} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="max-w-48" aria-label={pl.contacts.role} value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
            <option value="">{pl.contacts.anyRole}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
          <Select className="max-w-48" aria-label={pl.contacts.tag} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{pl.contacts.anyTag}</option>
            {tags.data?.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>
      <ErrorText>{error}</ErrorText>
      <Card flush>
        {data && data.length === 0 ? (
          <EmptyState
            icon={<Users size={20} />}
            text={pl.contacts.empty}
            action={
              canWrite && (
                <Button variant="outline" size="sm" onClick={() => setAdding('person')}>
                  <Plus size={14} /> {pl.contacts.addPerson}
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto px-3 pb-2">
            <Table>
              <thead>
                <tr>
                  <th>{pl.contacts.name}</th>
                  <th>{pl.contacts.roles}</th>
                  <th>{pl.contacts.email}</th>
                  <th>{pl.contacts.phone}</th>
                  <th>{pl.contacts.city}</th>
                  <th>{pl.contacts.tag}</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => go({ name: 'contact', id: c.id })}>
                    <td>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-2.5 text-left font-semibold hover:text-primary"
                        onClick={(e) => (e.stopPropagation(), go({ name: 'contact', id: c.id }))}
                      >
                        {c.kind === 'person' ? (
                          <Avatar id={c.id} name={c.label} size={30} />
                        ) : (
                          <span aria-hidden="true" className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
                            <Building2 size={15} />
                          </span>
                        )}
                        {!c.label ? pl.contacts.anonymized : c.kind === 'person' ? `${c.lastName} ${c.firstName}` : c.label}
                      </button>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {c.roles.map((r) => (
                          <RoleChip key={r} role={r} />
                        ))}
                      </div>
                    </td>
                    <td>{c.email}</td>
                    <td className="whitespace-nowrap">{c.phone}</td>
                    <td>{c.city}</td>
                    <td className="text-xs text-muted-foreground">{c.tags.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      {adding && <ContactForm kind={adding} onClose={() => setAdding(null)} onSaved={(id) => go({ name: 'contact', id })} />}
    </div>
  )
}
