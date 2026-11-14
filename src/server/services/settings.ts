// Ustawienia organizacji (jeden wiersz tabeli settings, zakłada go kreator). Wzór: desktopowe src/main/services/settings.ts.
import { isNull } from 'drizzle-orm'
import type { ApiParsed, OrgSettings } from '@shared/api'
import type { RoleLabels } from '@shared/domain'
import { AppError } from '@shared/errors'
import { normalizeModules, type Profile } from '@shared/modules'
import type { Db } from '../db/connection'
import { settings } from '../db/schema'
import { repoFor, type Actor } from './common'

export async function getSettings(db: Db): Promise<OrgSettings> {
  const [s] = await db.select().from(settings).where(isNull(settings.deletedAt)).limit(1)
  if (!s) throw new AppError('NOT_FOUND')
  return {
    id: s.id,
    version: s.version,
    orgName: s.orgName,
    profile: s.profile as Profile,
    enabledModules: normalizeModules(s.enabledModules),
    roleLabels: s.roleLabels as RoleLabels,
    staleDays: s.staleDays
  }
}

/** Zapis ustawień organizacji (tylko administrator). Moduły normalizowane, puste nazwy ról = domyślne. */
export async function updateSettings(db: Db, i: ApiParsed<'settings.update'>, actor: Actor): Promise<void> {
  const current = await getSettings(db)
  await repoFor(db, actor).update(settings, current.id, i.version, {
    orgName: i.orgName,
    profile: i.profile,
    enabledModules: normalizeModules(i.enabledModules),
    roleLabels: Object.fromEntries(Object.entries(i.roleLabels).filter(([, v]) => v)),
    staleDays: i.staleDays
  })
}
