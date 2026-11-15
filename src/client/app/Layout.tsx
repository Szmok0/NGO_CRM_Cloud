// Układ aplikacji jak w wersji desktopowej: menu boczne (zwijane poniżej 1280 px), pasek górny (wyszukiwarka, „+ Utwórz”), treść.
// Moduły, które jeszcze nie przeszły z desktopu, są w menu wyszarzone („wkrótce”).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarDays,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FolderOpen,
  HandHeart,
  LogOut,
  MessageSquare,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  User,
  UserPlus,
  Users
} from 'lucide-react'
import type { ModuleId } from '@shared/modules'
import type { SearchHit } from '@shared/types'
import { Avatar, Button } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, useDataChanged } from '../lib/api'
import { cn } from '../lib/cn'
import { useApp, type CreateKind, type Route } from './context'

const NAV: { route?: Route['name']; label: string; icon: ReactNode; also?: Route['name'][]; module?: ModuleId; counter?: boolean }[] = [
  { route: 'today', label: pl.nav.today, icon: <Sun size={18} /> },
  { route: 'contacts', label: pl.nav.contacts, icon: <Users size={18} />, also: ['contact'] },
  { route: 'actions', label: pl.nav.actions, icon: <ClipboardList size={18} />, also: ['action'], module: 'actions' },
  { route: 'calendar', label: pl.nav.calendar, icon: <CalendarDays size={18} />, module: 'calendar' },
  { route: 'tasks', label: pl.nav.tasks, icon: <CheckSquare size={18} />, module: 'tasks', counter: true },
  { label: pl.nav.materials, icon: <FolderOpen size={18} /> },
  { route: 'topics', label: pl.nav.topics, icon: <BookOpen size={18} />, also: ['topic'], module: 'actions' },
  { route: 'trash', label: pl.nav.trash, icon: <Trash2 size={18} /> },
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

function Sidebar() {
  const { session, route: current, go, moduleOn, logout: onLogout } = useApp()
  const route = current.name
  const onNavigate = (name: Route['name']) => go({ name } as Route)
  const user = { id: session.me.userId, name: session.account.name, role: session.me.role }
  const orgName = session.settings.orgName
  const narrow = useMedia('(max-width: 1279px)')
  // poniżej 1280 px menu zwija się do ikon; przycisk pozwala to zmienić
  const [pref, setPref] = useState<boolean | null>(null)
  useEffect(() => setPref(null), [narrow])
  const collapsed = pref ?? narrow

  // licznik przy „Zadaniach”: moje zaległe i na dziś (odświeżany po zmianie widoku i po każdym zapisie)
  const [counter, setCounter] = useState(0)
  const loadCounter = useCallback(() => void call('today.counter', {}).then(setCounter).catch(() => setCounter(0)), [])
  useEffect(loadCounter, [loadCounter, route])
  useDataChanged(loadCounter)

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

      {NAV.filter((n) => !n.module || moduleOn(n.module)).map((n) => {
        const active = n.route === route || !!n.also?.includes(route)
        const target = n.route
        const count = n.counter ? counter : 0
        return (
          <button
            key={n.label}
            type="button"
            disabled={!target}
            onClick={target ? () => onNavigate(target) : undefined}
            title={collapsed || !target ? `${n.label}${target ? '' : ` (${pl.nav.soon})`}` : undefined}
            aria-label={collapsed ? n.label + (count ? `, ${pl.nav.tasksCounter(count)}` : '') : undefined}
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
            {count > 0 &&
              (collapsed ? (
                <span aria-hidden="true" className="absolute top-1 right-1.5 h-2.5 w-2.5 rounded-full bg-counter" />
              ) : (
                <span aria-label={pl.nav.tasksCounter(count)} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-counter px-1.5 text-xs font-bold text-nav">
                  {count}
                </span>
              ))}
          </button>
        )
      })}

      <div className={cn('mt-auto flex items-center gap-2.5 border-t border-nav-line pt-3.5', collapsed ? 'flex-col px-0' : 'px-2.5')}>
        <Avatar id={user.id} name={user.name} size={34} />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{user.name}</div>
            <div className="text-xs text-nav-muted">{pl.userRoles[user.role]}</div>
          </div>
        )}
        <button type="button" onClick={onLogout} title={pl.nav.logout} aria-label={pl.nav.logout} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-nav-muted hover:bg-nav-hover hover:text-white">
          <LogOut size={16} />
        </button>
      </div>
    </nav>
  )
}

const HIT_ICON = {
  person: { icon: <User size={14} />, cls: 'bg-primary-soft text-primary-soft-foreground' },
  institution: { icon: <Building2 size={14} />, cls: 'bg-info-soft text-info' },
  action: { icon: <ClipboardList size={14} />, cls: 'bg-violet-soft text-violet' },
  topic: { icon: <BookOpen size={14} />, cls: 'bg-warning-soft text-orange' }
}

/** Wyszukiwarka globalna (od 2 znaków): osoby, instytucje, działania, tematy. */
function GlobalSearch() {
  const { go } = useApp()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(() => call('search.global', { q }).then(setHits).catch(() => setHits([])), 150)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (h: SearchHit) => {
    go(h.type === 'action' ? { name: 'action', id: h.id } : h.type === 'topic' ? { name: 'topic', id: h.id } : { name: 'contact', id: h.id })
    setQ('')
    setOpen(false)
  }

  return (
    <div ref={box} className="relative max-w-[460px] min-w-0 flex-1" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <label className="flex h-10 items-center gap-2 rounded-[10px] border border-input bg-subtle px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          aria-label={pl.common.search}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={pl.nav.globalSearch}
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
        />
      </label>
      {open && q.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-control border border-border bg-background py-1 shadow-lg">
          {hits.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{pl.nav.searchNoResults}</p>}
          {hits.map((h) => (
            <button key={h.type + h.id} type="button" onClick={() => pick(h)} className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-subtle focus-visible:bg-subtle">
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', HIT_ICON[h.type].cls)}>{HIT_ICON[h.type].icon}</span>
              <span className="font-semibold">{h.label}</span>
              {h.sub && <span className="truncate text-xs text-muted-foreground">{h.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Menu „+ Utwórz”. */
function CreateMenu() {
  const { create, moduleOn } = useApp()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const items: { kind: CreateKind; icon: ReactNode }[] = [
    { kind: 'person', icon: <UserPlus size={16} /> },
    { kind: 'institution', icon: <Building2 size={16} /> },
    { kind: 'note', icon: <NotebookPen size={16} /> },
    { kind: 'contactEntry', icon: <MessageSquare size={16} /> },
    ...(moduleOn('tasks') ? [{ kind: 'task' as const, icon: <CheckSquare size={16} /> }] : []),
    ...(moduleOn('actions') ? [{ kind: 'action' as const, icon: <HandHeart size={16} /> }] : [])
  ]

  return (
    <div
      ref={box}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
        if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault()
          const btns = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])]
          const i = btns.indexOf(document.activeElement as HTMLButtonElement)
          btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus()
        }
      }}
    >
      <Button size="lg" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus size={18} strokeWidth={2.2} /> {pl.create.button}
      </Button>
      {open && (
        <div role="menu" aria-label={pl.create.menuLabel} className="absolute right-0 z-30 mt-1 w-56 rounded-control border border-border bg-background py-1 shadow-lg">
          {items.map((i, idx) => (
            <button
              key={i.kind}
              ref={idx === 0 ? first : undefined}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                create(i.kind)
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
            >
              <span className="text-muted-foreground">{i.icon}</span>
              {pl.create[i.kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { session, back, canGoBack, canWrite } = useApp()
  const name = session.account.name
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center gap-3 border-b border-border bg-background px-8 py-3 print:hidden">
          {canGoBack && (
            <Button variant="ghost" size="icon" onClick={back} aria-label={pl.common.back} title={pl.common.back}>
              <ArrowLeft size={18} />
            </Button>
          )}
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2.5">
            {canWrite && <CreateMenu />}
            <span title={name}>
              <Avatar id={session.me.userId} name={name} size={40} />
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
