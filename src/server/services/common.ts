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

/** Strefa czasu organizacji: serwer hostingu może działać w UTC, a „dziś” ma być polskie. */
const WARSAW_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Data w Polsce (Europe/Warsaw) jako RRRR-MM-DD. */
export const today = (now: Date = new Date()): string => WARSAW_DAY.format(now)

/** Początek dnia (RRRR-MM-DD) w Europe/Warsaw jako chwila UTC: polska północ to 22:00 albo 23:00 UTC dnia poprzedniego. */
export function dayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const utc = Date.UTC(y, m - 1, d)
  for (const hours of [2, 1]) {
    const t = new Date(utc - hours * 3_600_000)
    if (WARSAW_DAY.format(t) === day && WARSAW_DAY.format(new Date(t.getTime() - 1)) !== day) return t
  }
  return new Date(utc - 3_600_000)
}

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
