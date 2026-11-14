// Układ aplikacji jak w wersji desktopowej: menu boczne (zwijane poniżej 1280 px), nagłówek, treść.
// Moduły z ZADANIA_02 są w menu wyszarzone („wkrótce”).
import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, CalendarDays, CheckSquare, ChevronsLeft, ChevronsRight, ClipboardList, FolderOpen, LogOut, Settings, Sun, Trash2, Users } from 'lucide-react'
import type { Role } from '@shared/api'
import { Avatar } from '../components/ui'
import { pl } from '../i18n/pl'
import { cn } from '../lib/cn'

export type RouteName = 'today' | 'settings'

const NAV: { route?: RouteName; label: string; icon: ReactNode }[] = [
  { route: 'today', label: pl.nav.today, icon: <Sun size={18} /> },
  { label: pl.nav.contacts, icon: <Users size={18} /> },
  { label: pl.nav.actions, icon: <ClipboardList size={18} /> },
  { label: pl.nav.calendar, icon: <CalendarDays size={18} /> },
  { label: pl.nav.tasks, icon: <CheckSquare size={18} /> },
  { label: pl.nav.materials, icon: <FolderOpen size={18} /> },
  { label: pl.nav.topics, icon: <BookOpen size={18} /> },
  { label: pl.nav.trash, icon: <Trash2 size={18} /> },
  { route: 'settings', label: pl.nav.settings, icon: <Settings size={18} /> }
]

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

interface Props {
  route: RouteName
  onNavigate: (route: RouteName) => void
  user: { id: string; name: string; role: Role }
  orgName: string
  onLogout: () => void
  children: ReactNode
}

function Sidebar({ route, onNavigate, user, orgName, onLogout }: Omit<Props, 'children'>) {
  const narrow = useMedia('(max-width: 1279px)')
  // poniżej 1280 px menu zwija się do ikon; przycisk pozwala to zmienić
  const [pref, setPref] = useState<boolean | null>(null)
  useEffect(() => setPref(null), [narrow])
  const collapsed = pref ?? narrow

  return (
    <nav aria-label={pl.nav.mainMenu} className={cn('flex shrink-0 flex-col gap-0.5 bg-nav py-5 text-nav-foreground transition-[width] print:hidden', collapsed ? 'w-16 px-2' : 'w-60 px-3')}>
      <div className={cn('flex items-center gap-2.5 pb-5', collapsed ? 'flex-col px-0' : 'px-2.5')}>
        <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-nav-logo text-base font-bold text-white">
          N
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-white">{pl.app.name}</div>
            <div className="truncate text-xs text-nav-muted" title={orgName}>
              {orgName}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setPref(!collapsed)}
          title={collapsed ? pl.nav.expand : pl.nav.collapse}
          aria-label={collapsed ? pl.nav.expand : pl.nav.collapse}
          aria-expanded={!collapsed}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-nav-muted hover:bg-nav-hover hover:text-white"
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      {NAV.map((n) => {
        const active = n.route === route
        const target = n.route
        return (
          <button
            key={n.label}
            type="button"
            disabled={!target}
            onClick={target ? () => onNavigate(target) : undefined}
            title={collapsed || !target ? `${n.label}${target ? '' : ` (${pl.nav.soon})`}` : undefined}
            aria-label={collapsed ? n.label : undefined}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-control py-[9px] text-left text-sm',
              collapsed ? 'justify-center px-0' : 'px-2.5',
              active ? 'bg-primary font-semibold text-white' : target ? 'cursor-pointer hover:bg-nav-hover hover:text-white' : 'cursor-default opacity-45'
            )}
          >
            {n.icon}
            {!collapsed && <span className="flex-1">{n.label}</span>}
            {!collapsed && !target && <span className="text-[11px] text-nav-muted">{pl.nav.soon}</span>}
          </button>
        )
      })}

      <div className={cn('mt-auto flex items-center gap-2.5 border-t border-nav-line pt-3.5', collapsed ? 'flex-col px-0' : 'px-2.5')}>
        <Avatar id={user.id} name={user.name} />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{user.name}</div>
            <div className="text-xs text-nav-muted">{pl.roles[user.role]}</div>
          </div>
        )}
        <button type="button" onClick={onLogout} title={pl.nav.logout} aria-label={pl.nav.logout} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-nav-muted hover:bg-nav-hover hover:text-white">
          <LogOut size={16} />
        </button>
      </div>
    </nav>
  )
}

export function Layout({ children, ...nav }: Props) {
  return (
    <div className="flex h-full">
      <Sidebar {...nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center gap-3 border-b border-border bg-background px-8 py-3 print:hidden">
          <div className="ml-auto flex items-center gap-2.5">
            <span title={nav.user.name}>
              <Avatar id={nav.user.id} name={nav.user.name} size="lg" />
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-8 pt-7 pb-10">{children}</div>
        </main>
      </div>
    </div>
  )
}
