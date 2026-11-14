// Kontekst aplikacji po zalogowaniu (wzór: desktopowe src/renderer/app/context.tsx).
// Trasy i rodzaje „+ Utwórz” dochodzą razem z modułami w kolejnych krokach ZADANIA_02.
import { createContext, useContext } from 'react'
import type { ApiOutputs, OrgSettings } from '@shared/api'
import type { Role } from '@shared/domain'
import type { ModuleId } from '@shared/modules'

export type Route =
  | { name: 'today' }
  | { name: 'contacts' }
  | { name: 'contact'; id: string }
  | { name: 'actions' }
  | { name: 'action'; id: string }
  | { name: 'topics' }
  | { name: 'topic'; id: string }
  | { name: 'settings' }

/** Co można utworzyć z „+ Utwórz”. */
export type CreateKind = 'person' | 'institution' | 'note' | 'contactEntry' | 'action'

/** Zalogowana osoba i ustawienia organizacji. */
export interface SessionInfo {
  me: ApiOutputs['auth.me']
  account: ApiOutputs['auth.account']
  settings: OrgSettings
}

export interface AppContextValue {
  session: SessionInfo
  /** Ponowne wczytanie konta i ustawień (np. po zmianie ustawień organizacji). */
  refreshSession: () => Promise<void>
  route: Route
  go: (r: Route) => void
  back: () => void
  canGoBack: boolean
  /** Nazwa roli kontaktu z uwzględnieniem własnych nazw organizacji. */
  roleLabel: (r: Role) => string
  moduleOn: (m: ModuleId) => boolean
  /** Czy rola pozwala zapisywać dane (nie „tylko odczyt”). Serwer i tak odmówi zapisu bez uprawnień. */
  canWrite: boolean
  create: (kind: CreateKind) => void
  logout: () => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const v = useContext(AppContext)
  if (!v) throw new Error('Brak AppContext')
  return v
}
