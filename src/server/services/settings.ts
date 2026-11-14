// Ustawienia organizacji (jeden wiersz tabeli settings, zakłada go kreator). Wzór: desktopowe src/main/services/settings.ts.
import { isNull } from 'drizzle-orm'
import type { OrgSettings } from '@shared/api'
import type { RoleLabels } from '@shared/domain'
import { AppError } from '@shared/errors'
import { normalizeModules, type Profile } from '@shared/modules'
import type { Db } from '../db/connection'
import { settings } from '../db/schema'

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
