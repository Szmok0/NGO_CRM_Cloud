// Osoby i instytucje, role, powiązania, zgody (wzór: desktopowe src/main/services/contacts.ts).
// Różnice wobec desktopu: tożsamość w osobnej tabeli (contact_identity), zapytania asynchroniczne, `version` przy każdym zapisie.
// Przy założeniu osoby wpis systemowy „Dodano do bazy” na osi aktywności (jak w desktopie).
import { and, eq, isNull, or } from 'drizzle-orm'
import type { ApiParsed } from '@shared/api'
import type { ActionStatus, ActionType, ConsentType, ContactKind, ParticipantStatus, RelationshipType, Role } from '@shared/domain'
import { AppError } from '@shared/errors'
import { displayName, isPossibleDuplicate, matchesQuery } from '@shared/text'
import type { Consent, ContactDetail, ContactListItem, ContactRole, IdentityFields, SearchHit } from '@shared/types'
import type { Db } from '../db/connection'
import { actionParticipants, actions, consents, contactIdentity, contactRoles, contacts, relationships, topics } from '../db/schema'
import { addSystemActivity, loadActivities } from './activities'
import { contactRef, contactsById, meta, repoFor, today, type Actor } from './common'
import { loadTasks } from './tasks'

/** Aktywne role (bez daty końca albo z końcem dziś lub później) dla każdego kontaktu. */
async function activeRoles(db: Db, now: Date): Promise<Map<string, Role[]>> {
  const t = today(now)
  const map = new Map<string, Role[]>()
  for (const r of await db.select().from(contactRoles).where(isNull(contactRoles.deletedAt))) {
    if (r.until && r.until < t) continue
    const list = map.get(r.contactId) ?? []
    if (!list.includes(r.role as Role)) list.push(r.role as Role)
    map.set(r.contactId, list)
  }
  return map
}

const sortByLabel = (a: ContactListItem, b: ContactListItem) =>
  a.kind === 'person' && b.kind === 'person'
    ? (a.lastName ?? '').localeCompare(b.lastName ?? '', 'pl') || (a.firstName ?? '').localeCompare(b.firstName ?? '', 'pl')
    : a.label.localeCompare(b.label, 'pl')

/** Kontakty nieusunięte z tożsamością i aktywnymi rolami. */
async function liveContacts(db: Db, now: Date): Promise<ContactListItem[]> {
  const [all, roles] = await Promise.all([contactsById(db), activeRoles(db, now)])
  return [...all.values()].filter((c) => !c.deletedAt).map((c) => ({ ...c, label: displayName(c), roles: roles.get(c.id) ?? [] }))
}

export async function listContacts(db: Db, f: ApiParsed<'contacts.list'>, now: Date): Promise<ContactListItem[]> {
  return (await liveContacts(db, now))
    .filter((c) => f.kind === 'all' || c.kind === f.kind)
    .filter((c) => !f.role || c.roles.includes(f.role))
    .filter((c) => !f.tag || c.tags.includes(f.tag))
    .filter((c) => !f.q || matchesQuery(f.q, c.firstName, c.lastName, c.name, c.email, c.phone, c.city))
    .sort(sortByLabel)
}

export async function listTags(db: Db): Promise<string[]> {
  const set = new Set<string>()
  for (const c of await db.select({ tags: contacts.tags }).from(contacts).where(isNull(contacts.deletedAt))) c.tags.forEach((t) => set.add(t))
  return [...set].sort((a, b) => a.localeCompare(b, 'pl'))
}

export async function findDuplicates(db: Db, f: ApiParsed<'contacts.duplicates'>, now: Date): Promise<ContactListItem[]> {
  return (await liveContacts(db, now)).filter((c) => c.kind === 'person' && c.id !== f.excludeId && isPossibleDuplicate(f, c))
}

/** Tylko pola tożsamości (do contact_identity), bez niczego więcej z parametrów. */
const identityOf = (i: IdentityFields): IdentityFields => ({
  firstName: i.firstName,
  lastName: i.lastName,
  name: i.name,
  email: i.email,
  phone: i.phone,
  address: i.address,
  city: i.city,
  notes: i.notes
})

function validate(kind: ContactKind, f: { firstName: string | null; lastName: string | null; name: string | null }) {
  if (kind === 'person' && (!f.firstName || !f.lastName)) throw new AppError('VALIDATION', 'PERSON_NAME')
  if (kind === 'institution' && !f.name) throw new AppError('VALIDATION', 'INSTITUTION_NAME')
}

export async function createContact(db: Db, input: ApiParsed<'contacts.create'>, actor: Actor): Promise<{ id: string }> {
  const { kind, tags, roles } = input
  const identity = identityOf(input)
  validate(kind, identity)
  return db.transaction(async (tx) => {
    const repo = repoFor(tx, actor)
    const c = await repo.insert(contacts, { kind, tags })
    await repo.insert(contactIdentity, { contactId: c.id, ...identity })
    for (const role of roles) await repo.insert(contactRoles, { contactId: c.id, role, since: today(actor.now) })
    await addSystemActivity(repo, actor.now, { event: 'contact_created' }, [c.id])
    return { id: c.id }
  })
}

export async function updateContact(db: Db, input: ApiParsed<'contacts.update'>, actor: Actor): Promise<void> {
  const { id, version, identityVersion, tags } = input
  const identity = identityOf(input)
  const [row] = await db.select().from(contacts).leftJoin(contactIdentity, eq(contactIdentity.contactId, contacts.id)).where(eq(contacts.id, id))
  if (!row) throw new AppError('NOT_FOUND')
  // osoba zanonimizowana nie ma tożsamości do edycji
  if (!row.contact_identity) throw new AppError('NOT_FOUND')
  validate(row.contacts.kind as ContactKind, identity)
  await db.transaction(async (tx) => {
    const repo = repoFor(tx, actor)
    await repo.update(contacts, id, version, { tags })
    await repo.update(contactIdentity, row.contact_identity!.id, identityVersion, identity)
  })
}

export async function getContact(db: Db, id: string): Promise<ContactDetail> {
  const all = await contactsById(db)
  const contact = all.get(id)
  if (!contact) throw new AppError('NOT_FOUND')

  const rels = await db
    .select()
    .from(relationships)
    .where(and(isNull(relationships.deletedAt), or(eq(relationships.contactAId, id), eq(relationships.contactBId, id))))
  const relationshipViews = rels.flatMap((r) => {
    const isA = r.contactAId === id
    const other = all.get(isA ? r.contactBId : r.contactAId)
    return other ? [{ id: r.id, version: r.version, type: r.type as RelationshipType, note: r.note, isA, other: contactRef(other) }] : []
  })

  const roleRows = await db.select().from(contactRoles).where(and(eq(contactRoles.contactId, id), isNull(contactRoles.deletedAt)))
  const consentRows = await db.select().from(consents).where(and(eq(consents.contactId, id), isNull(consents.deletedAt)))

  return {
    contact,
    label: displayName(contact),
    roles: roleRows
      .map((r): ContactRole => ({ ...meta(r), contactId: r.contactId, role: r.role as Role, since: r.since, until: r.until, note: r.note }))
      .sort((a, b) => (b.since ?? '').localeCompare(a.since ?? '')),
    relationships: relationshipViews,
    consents: consentRows
      .map(
        (c): Consent => ({
          ...meta(c),
          contactId: c.contactId,
          type: c.type as ConsentType,
          basis: c.basis,
          givenAt: c.givenAt,
          validUntil: c.validUntil,
          withdrawnAt: c.withdrawnAt,
          note: c.note
        })
      )
      .sort((a, b) => b.givenAt.localeCompare(a.givenAt)),
    participations: (
      await db
        .select({ p: actionParticipants, a: actions })
        .from(actionParticipants)
        .innerJoin(actions, eq(actions.id, actionParticipants.actionId))
        .where(and(eq(actionParticipants.contactId, id), isNull(actionParticipants.deletedAt), isNull(actions.deletedAt)))
    )
      .map(({ p, a }) => ({
        participantId: p.id,
        status: p.status as ParticipantStatus,
        action: { id: a.id, title: a.title, type: a.type as ActionType, status: a.status as ActionStatus, startDate: a.startDate, endDate: a.endDate }
      }))
      .sort((x, y) => (y.action.startDate ?? '').localeCompare(x.action.startDate ?? '')),
    tasks: await loadTasks(db, { targetType: 'contact', targetId: id }),
    activities: await loadActivities(db, { contactId: id }, all)
  }
}

export async function deleteContact(db: Db, { id, version }: ApiParsed<'contacts.delete'>, actor: Actor): Promise<void> {
  await repoFor(db, actor).softDelete(contacts, id, version)
}

// ---------- role, powiązania, zgody ----------

/** Rekord podrzędny musi wskazywać istniejący, nieusunięty kontakt (klucz obcy pilnuje tylko istnienia). */
async function requireLiveContact(db: Db, id: string) {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
  if (!c) throw new AppError('NOT_FOUND')
}

export async function addRole(db: Db, i: ApiParsed<'roles.add'>, actor: Actor): Promise<void> {
  await requireLiveContact(db, i.contactId)
  await repoFor(db, actor).insert(contactRoles, { contactId: i.contactId, role: i.role, since: i.since ?? today(actor.now), note: i.note })
}
export const endRole = async (db: Db, i: ApiParsed<'roles.end'>, actor: Actor) => void (await repoFor(db, actor).update(contactRoles, i.id, i.version, { until: i.until }))
export const deleteRole = async (db: Db, i: ApiParsed<'roles.delete'>, actor: Actor) => void (await repoFor(db, actor).softDelete(contactRoles, i.id, i.version))

export async function addRelationship(db: Db, i: ApiParsed<'relationships.add'>, actor: Actor): Promise<void> {
  if (i.contactAId === i.contactBId) throw new AppError('VALIDATION', 'SELF_RELATION')
  await requireLiveContact(db, i.contactAId)
  await requireLiveContact(db, i.contactBId)
  await repoFor(db, actor).insert(relationships, i)
}
export const deleteRelationship = async (db: Db, i: ApiParsed<'relationships.delete'>, actor: Actor) =>
  void (await repoFor(db, actor).softDelete(relationships, i.id, i.version))

export async function addConsent(db: Db, i: ApiParsed<'consents.add'>, actor: Actor): Promise<void> {
  await requireLiveContact(db, i.contactId)
  await repoFor(db, actor).insert(consents, i)
}
export const withdrawConsent = async (db: Db, i: ApiParsed<'consents.withdraw'>, actor: Actor) =>
  void (await repoFor(db, actor).update(consents, i.id, i.version, { withdrawnAt: i.at }))
export const deleteConsent = async (db: Db, i: ApiParsed<'consents.delete'>, actor: Actor) => void (await repoFor(db, actor).softDelete(consents, i.id, i.version))

// ---------- wyszukiwarka globalna (zadania dojdą w kroku 5) ----------

export async function searchGlobal(db: Db, q: string): Promise<SearchHit[]> {
  if (q.trim().length < 2) return []
  const hits: SearchHit[] = []
  for (const c of (await contactsById(db)).values()) {
    if (c.deletedAt) continue
    if (matchesQuery(q, c.firstName, c.lastName, c.name, c.email, c.phone)) hits.push({ type: c.kind, id: c.id, label: displayName(c), sub: c.email ?? c.city ?? null })
  }
  for (const a of await db.select().from(actions).where(isNull(actions.deletedAt))) {
    if (matchesQuery(q, a.title, a.place)) hits.push({ type: 'action', id: a.id, label: a.title, sub: a.startDate })
  }
  for (const t of await db.select().from(topics).where(isNull(topics.deletedAt))) {
    if (matchesQuery(q, t.name)) hits.push({ type: 'topic', id: t.id, label: t.name, sub: null })
  }
  return hits.slice(0, 20)
}
