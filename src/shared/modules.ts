// Profile organizacji i rejestr modułów (przeniesione z desktopu: src/shared/domain.ts i modules.ts).

export const PROFILES = ['kgw', 'donors', 'projects', 'custom'] as const
export type Profile = (typeof PROFILES)[number]

// "soon" = widoczne w ustawieniach jako „wkrótce”, nieaktywne.
export const MODULES = [
  { id: 'contacts', status: 'active', alwaysOn: true },
  { id: 'actions', status: 'active', alwaysOn: false },
  { id: 'tasks', status: 'active', alwaysOn: false },
  { id: 'projects', status: 'soon', alwaysOn: false },
  { id: 'volunteers', status: 'soon', alwaysOn: false },
  { id: 'members', status: 'soon', alwaysOn: false },
  { id: 'donors', status: 'soon', alwaysOn: false },
  { id: 'media', status: 'soon', alwaysOn: false },
  { id: 'resources', status: 'soon', alwaysOn: false },
  { id: 'calendar', status: 'active', alwaysOn: true },
  { id: 'knowledge', status: 'active', alwaysOn: true }
] as const

export type ModuleId = (typeof MODULES)[number]['id']

export const PROFILE_DEFAULT_MODULES: Record<Profile, ModuleId[]> = {
  kgw: ['contacts', 'actions', 'tasks'],
  donors: ['contacts', 'actions', 'tasks'],
  projects: ['contacts', 'actions', 'tasks'],
  custom: ['contacts']
}

/** Zostawia tylko aktywne moduły i zawsze dokłada moduły `alwaysOn` (osoby, kalendarz). */
export function normalizeModules(ids: readonly string[]): ModuleId[] {
  const active = MODULES.filter((m) => m.status === 'active' && (m.alwaysOn || ids.includes(m.id)))
  return active.map((m) => m.id)
}
