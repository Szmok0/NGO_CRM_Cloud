// Wspólne pomocnicze usług domenowych (wzór: desktopowe src/main/services/common.ts).
import { eq } from 'drizzle-orm'
import { displayName } from '@shared/text'
import type { ContactKind } from '@shared/domain'
import type { Contact, ContactRef, RecordMeta } from '@shared/types'
import type { Db } from '../db/connection'
import { createRepo } from '../db/repo'
import { contactIdentity, contacts } from '../db/schema'

/** Kto i kiedy wywołuje usługę (z sesji RPC). */
export interface Actor {
  userId: string
  now: Date
}

export const repoFor = (db: Pick<Db, 'transaction'>, actor: Actor) => createRepo(db, { userId: actor.userId, now: () => actor.now })

/** Dzisiejsza data lokalna serwera jako RRRR-MM-DD. */
export const today = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

/** Pola techniczne wiersza bazy → postać dla klienta (ISO 8601). */
export const meta = (r: { id: string; version: number; createdAt: Date; updatedAt: Date; deletedAt: Date | null }): RecordMeta => ({
  id: r.id,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  deletedAt: iso(r.deletedAt)
})

type ContactRow = typeof contacts.$inferSelect
type IdentityRow = typeof contactIdentity.$inferSelect

/** Kontakt z tożsamością (brak wiersza tożsamości = osoba zanonimizowana: pola puste). */
export function toContact(c: ContactRow, i: IdentityRow | null): Contact {
  return {
    ...meta(c),
    kind: c.kind as ContactKind,
    tags: c.tags,
    anonymizedAt: iso(c.anonymizedAt),
    identityVersion: i?.version ?? null,
    firstName: i?.firstName ?? null,
    lastName: i?.lastName ?? null,
    name: i?.name ?? null,
    email: i?.email ?? null,
    phone: i?.phone ?? null,
    address: i?.address ?? null,
    city: i?.city ?? null,
    notes: i?.notes ?? null
  }
}

export const contactRef = (c: Contact): ContactRef => ({ id: c.id, kind: c.kind, label: displayName(c), deleted: !!c.deletedAt })

/** Wszystkie kontakty z tożsamością (także usunięte — do historii) jako mapa id → kontakt. Jedno złączenie. */
export async function contactsById(db: Db): Promise<Map<string, Contact>> {
  const rows = await db.select().from(contacts).leftJoin(contactIdentity, eq(contactIdentity.contactId, contacts.id))
  return new Map(rows.map((r) => [r.contacts.id, toContact(r.contacts, r.contact_identity)]))
}
