// Kalendarz (przeniesiony z desktopu): miesiąc / tydzień / lista, filtry, panel boczny, eksport .ics.
// Różnica wobec desktopu: plik .ics powstaje w przeglądarce i jest pobierany (zamiast okna „Zapisz jako”).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react'
import { pl } from '../../i18n/pl'
import { call, errorMessage, useDataChanged, useLoad } from '../../lib/api'
import { capitalize, formatDate, longDate, monthTitle, shortDay, timeRange, todayYmd } from '../../lib/format'
import { cn } from '../../lib/cn'
import { CATEGORY_TONE, entryKindLabel, entryLabel, entryTone } from '../../lib/calendarUi'
import { toIcsEvents } from '../../lib/calendarExport'
import { downloadText } from '../../lib/download'
import { useApp, type CalendarMode } from '../../app/context'
import { Button, Card, Checkbox, Dialog, ErrorText, Segmented } from '../../components/ui'
import { TaskDialog } from '../../components/TaskDialog'
import { addDays, addMonths, endOfMonth, monthGrid, startOfMonth, startOfWeek, dateRange, weekday } from '@shared/dates'
import { holidayOn } from '@shared/holidays'
import { buildIcs } from '@shared/ics'
import { CALENDAR_CATEGORIES, type CalendarCategory, type CalendarEntry, type OngoingAction } from '@shared/calendar'

const FILTERS_KEY = 'ngo-crm.calendar.hidden'
const MAX_IN_CELL = 3

function loadHidden(): CalendarCategory[] {
  try {
    const v = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is CalendarCategory => (CALENDAR_CATEGORIES as readonly string[]).includes(x)) : []
  } catch {
    return []
  }
}

function rangeOf(mode: CalendarMode, anchor: string): { from: string; to: string; days: string[] } {
  if (mode === 'week') {
    const from = startOfWeek(anchor)
    return { from, to: addDays(from, 6), days: dateRange(from, addDays(from, 6)) }
  }
  if (mode === 'list') return { from: startOfMonth(anchor), to: endOfMonth(anchor), days: dateRange(startOfMonth(anchor), endOfMonth(anchor)) }
  const days = monthGrid(anchor)
  return { from: days[0]!, to: days[days.length - 1]!, days }
}

export function CalendarView({ date, mode: initialMode }: { date?: string; mode?: CalendarMode }) {
  const { go, moduleOn, create, canWrite } = useApp()
  const today = todayYmd()
  const [mode, setMode] = useState<CalendarMode>(initialMode ?? 'month')
  const [anchor, setAnchor] = useState(date ?? today)
  const [focusDay, setFocusDay] = useState<string | null>(date ?? null)
  const [hidden, setHidden] = useState<CalendarCategory[]>(loadHidden)
  const [task, setTask] = useState<string | null>(null)
  const [createOn, setCreateOn] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const range = useMemo(() => rangeOf(mode, anchor), [mode, anchor])
  const main = useLoad('calendar.entries', { from: range.from, to: range.to })
  const side = useLoad('calendar.entries', { from: today, to: addDays(today, 60) })
  const reloadAll = useCallback(() => {
    main.reload()
    side.reload()
  }, [main.reload, side.reload])
  useDataChanged(reloadAll)

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(hidden))
    } catch {
      /* brak dostępu do pamięci przeglądarki: filtry tylko do zamknięcia */
    }
  }, [hidden])

  const visible = useMemo(() => (main.data?.entries ?? []).filter((e) => !hidden.includes(e.category)), [main.data, hidden])
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>()
    for (const e of visible) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return m
  }, [visible])

  const open = (e: CalendarEntry) => (e.kind === 'task' ? setTask(e.taskId) : go({ name: 'action', id: e.actionId! }))
  const startCreate = (d: string) => {
    if (!canWrite) return
    const canTask = moduleOn('tasks')
    const canAction = moduleOn('actions')
    if (canTask && canAction) setCreateOn(d)
    else if (canTask) create('task', { date: d })
    else if (canAction) create('action', { date: d })
  }
  const showDayList = (d: string) => {
    setMode('list')
    setAnchor(d)
    setFocusDay(d)
  }
  const shift = (dir: -1 | 1) => {
    setFocusDay(null)
    setAnchor((a) => (mode === 'week' ? addDays(a, 7 * dir) : addMonths(a, dir)))
  }

  const title = mode === 'week' ? pl.calendar.weekRange(formatDate(range.from), formatDate(range.to)) : monthTitle(anchor)
  const monthOngoing = (main.data?.ongoing ?? []).filter((o) => o.startDate <= endOfMonth(anchor) && o.endDate >= startOfMonth(anchor))

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="min-w-[13ch] text-2xl font-bold">{title}</h1>
          <Button variant="outline" size="icon" className="h-8.5 w-8.5" aria-label={pl.calendar.prev[mode]} title={pl.calendar.prev[mode]} onClick={() => shift(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="outline" size="icon" className="h-8.5 w-8.5" aria-label={pl.calendar.next[mode]} title={pl.calendar.next[mode]} onClick={() => shift(1)}>
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="outline"
            className="h-8.5"
            onClick={() => {
              setAnchor(today)
              setFocusDay(mode === 'list' ? today : null)
            }}
          >
            {pl.calendar.today}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m)
              setFocusDay(null)
            }}
            options={(['month', 'week', 'list'] as const).map((id) => ({ id, label: pl.calendar.modes[id] }))}
          />
          <Button variant="outline" className="h-8.5" onClick={() => setExporting(true)}>
            <Download size={15} /> {pl.calendar.export}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={pl.calendar.show}>
        <span className="mr-1 text-xs font-semibold text-muted-foreground">{pl.calendar.show}</span>
        {CALENDAR_CATEGORIES.filter((c) => (c === 'tasks' || c === 'overdue' ? moduleOn('tasks') : moduleOn('actions'))).map((c) => {
          const on = !hidden.includes(c)
          const tone = CATEGORY_TONE[c]
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => setHidden((h) => (on ? [...h, c] : h.filter((x) => x !== c)))}
              className={cn(
                'flex h-7.5 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-semibold',
                on ? cn(tone.chip, tone.border) : 'border-input bg-background text-muted-foreground'
              )}
            >
              <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', on ? tone.dot : 'bg-[#C9D1DE]')} />
              {pl.calendar.categories[c]}
            </button>
          )
        })}
      </div>

      <ErrorText>{main.error}</ErrorText>

      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[3_1_640px]">
          {mode === 'month' && <MonthGrid days={range.days} anchor={anchor} today={today} byDay={byDay} onOpen={open} onCreate={startCreate} onMore={showDayList} />}
          {mode === 'week' && <WeekGrid days={range.days} today={today} byDay={byDay} onOpen={open} onCreate={startCreate} />}
          {mode === 'list' && <DayList days={range.days} today={today} focusDay={focusDay} byDay={byDay} onOpen={open} onCreate={startCreate} />}
        </div>
        <SidePanel today={today} entries={side.data?.entries ?? []} ongoing={monthOngoing} onOpen={open} />
      </div>

      {createOn && (
        <Dialog open onClose={() => setCreateOn(null)} title={pl.calendar.createOn(longDate(createOn))}>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="justify-start"
              autoFocus
              onClick={() => {
                create('task', { date: createOn })
                setCreateOn(null)
              }}
            >
              {pl.calendar.createTask}
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                create('action', { date: createOn })
                setCreateOn(null)
              }}
            >
              {pl.calendar.createAction}
            </Button>
          </div>
        </Dialog>
      )}
      {exporting && <ExportDialog today={today} onClose={() => setExporting(false)} />}
      {task && <TaskDialog taskId={task} onClose={() => setTask(null)} onSaved={reloadAll} />}
    </div>
  )
}

interface GridProps {
  days: string[]
  today: string
  byDay: Map<string, CalendarEntry[]>
  onOpen: (e: CalendarEntry) => void
  onCreate: (date: string) => void
}

function EntryChip({ e, onOpen, className }: { e: CalendarEntry; onOpen: (e: CalendarEntry) => void; className?: string }) {
  const label = entryLabel(e)
  return (
    <button
      type="button"
      title={label}
      onClick={(ev) => {
        ev.stopPropagation()
        onOpen(e)
      }}
      className={cn('block w-full cursor-pointer truncate rounded-md px-1.5 py-0.75 text-left text-[11px] font-semibold hover:brightness-95', entryTone(e).chip, className)}
    >
      {label}
    </button>
  )
}

function CreateButton({ date, onCreate }: { date: string; onCreate: (d: string) => void }) {
  return (
    <button
      type="button"
      aria-label={pl.calendar.createOn(longDate(date))}
      title={pl.calendar.createOn(longDate(date))}
      onClick={(ev) => {
        ev.stopPropagation()
        onCreate(date)
      }}
      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100"
    >
      <Plus size={14} />
    </button>
  )
}

function MonthGrid({ days, anchor, onMore, ...p }: GridProps & { anchor: string; onMore: (d: string) => void }) {
  const month = anchor.slice(0, 7)
  return (
    <section className="overflow-hidden rounded-card border border-border bg-background shadow-card">
      <div className="grid grid-cols-7 border-b border-border bg-subtle">
        {pl.time.weekdaysHeader.map((w) => (
          <div key={w} className="px-3 py-2.5 text-xs font-bold tracking-[0.05em] text-muted-foreground uppercase">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const all = p.byDay.get(d) ?? []
          const inMonth = d.startsWith(month)
          const holiday = holidayOn(d)
          const isToday = d === p.today
          return (
            <div
              key={d}
              onClick={() => p.onCreate(d)}
              className={cn(
                'group flex min-h-28 cursor-pointer flex-col border-r border-b border-line p-2 [&:nth-child(7n)]:border-r-0',
                !inMonth ? 'bg-[#F7F8FB]' : weekday(d) >= 5 ? 'bg-[#FAFBFD]' : 'bg-background'
              )}
            >
              <div className="flex items-start justify-between gap-1">
                <span
                  className={cn(
                    'flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
                    isToday ? 'bg-primary text-white' : inMonth ? 'text-foreground' : 'text-faint'
                  )}
                  aria-label={longDate(d)}
                >
                  {Number(d.slice(8))}
                </span>
                <CreateButton date={d} onCreate={p.onCreate} />
              </div>
              {holiday && inMonth && <div className="mt-0.5 text-[11px] leading-tight font-semibold text-destructive">{pl.calendar.holidays[holiday]}</div>}
              <div className="mt-1 flex flex-col gap-0.75">
                {all.slice(0, MAX_IN_CELL).map((e) => (
                  <EntryChip key={e.key} e={e} onOpen={p.onOpen} />
                ))}
                {all.length > MAX_IN_CELL && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onMore(d)
                    }}
                    className="cursor-pointer pl-1 text-left text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {pl.calendar.more(all.length - MAX_IN_CELL)}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function WeekGrid(p: GridProps) {
  return (
    <section className="overflow-x-auto rounded-card border border-border bg-background shadow-card">
      <div className="grid min-w-[640px] grid-cols-7">
        {p.days.map((d) => {
          const holiday = holidayOn(d)
          const isToday = d === p.today
          const entries = p.byDay.get(d) ?? []
          return (
            <div key={d} onClick={() => p.onCreate(d)} className="group flex min-h-[420px] cursor-pointer flex-col border-r border-line last:border-r-0">
              <div className={cn('flex items-start justify-between gap-1 border-b border-border px-2.5 py-2', weekday(d) >= 5 ? 'bg-[#FAFBFD]' : 'bg-subtle')}>
                <div>
                  <div className="text-xs font-bold tracking-[0.05em] text-muted-foreground uppercase">{pl.time.weekdaysHeader[weekday(d)]}</div>
                  <div className={cn('mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold', isToday && 'bg-primary text-white')}>{Number(d.slice(8))}</div>
                </div>
                <CreateButton date={d} onCreate={p.onCreate} />
              </div>
              {holiday && <div className="px-2.5 pt-1.5 text-[11px] font-semibold text-destructive">{pl.calendar.holidays[holiday]}</div>}
              <div className="flex flex-col gap-1.5 p-2">
                {entries.map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      p.onOpen(e)
                    }}
                    className={cn('cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs hover:brightness-95', entryTone(e).chip)}
                  >
                    {e.startTime && <div className="font-bold">{timeRange(e.startTime, e.endTime)}</div>}
                    <div className="font-semibold">{e.kind === 'session' ? pl.today.sessionOf(e.title, e.sessionNo!, e.sessionTotal!) : entryLabel(e)}</div>
                    {e.place && <div className="opacity-80">{e.place}</div>}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function entrySub(e: CalendarEntry): string {
  if (e.kind === 'task') return e.taskDone ? pl.calendar.taskDone : pl.calendar.taskSub(e.assigneeName, e.itemsDone, e.itemsTotal)
  return [
    entryKindLabel(e),
    timeRange(e.startTime, e.endTime),
    e.place,
    e.participantCount ? pl.today.participants(e.participantCount) : null
  ]
    .filter(Boolean)
    .join(' · ')
}

function DayList({ days, today, focusDay, byDay, onOpen, onCreate }: GridProps & { focusDay: string | null }) {
  const shown = days.filter((d) => byDay.has(d) || holidayOn(d) || d === focusDay)
  useEffect(() => {
    if (focusDay) document.getElementById(`day-${focusDay}`)?.scrollIntoView({ block: 'start' })
  }, [focusDay])
  if (shown.length === 0) return <Card>{<p className="py-6 text-center text-sm text-muted-foreground">{pl.calendar.listEmpty}</p>}</Card>
  return (
    <div className="flex flex-col gap-3">
      {shown.map((d) => {
        const holiday = holidayOn(d)
        const entries = byDay.get(d) ?? []
        return (
          <section
            key={d}
            id={`day-${d}`}
            className={cn('scroll-mt-4 rounded-card border bg-background shadow-card', d === focusDay ? 'border-primary ring-2 ring-primary/20' : 'border-border')}
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2.5">
              <h2 className={cn('text-sm font-bold', d === today && 'text-primary-soft-foreground')}>
                {capitalize(longDate(d))}
                {holiday && <span className="ml-2 text-xs font-semibold text-destructive">{pl.calendar.holidays[holiday]}</span>}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => onCreate(d)} aria-label={pl.calendar.createOn(longDate(d))}>
                <Plus size={14} />
              </Button>
            </header>
            <ul className="px-5 py-1">
              {entries.length === 0 && <li className="py-2.5 text-sm text-muted-foreground">{pl.calendar.dayEmpty}</li>}
              {entries.map((e) => (
                <li key={e.key} className="border-b border-line last:border-0">
                  <button type="button" onClick={() => onOpen(e)} className="flex w-full cursor-pointer items-start gap-3 py-2.5 text-left hover:bg-subtle">
                    <span aria-hidden="true" className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', entryTone(e).dot)} />
                    <span className="w-12 shrink-0 text-sm font-semibold text-muted-foreground">{e.startTime ?? ''}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm font-semibold', e.taskDone && 'text-faint line-through', e.overdue && 'text-destructive')}>
                        {e.kind === 'session' ? pl.today.sessionOf(e.title, e.sessionNo!, e.sessionTotal!) : entryLabel(e)}
                      </span>
                      <span className="block text-xs text-muted-foreground">{entrySub(e)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function SidePanel({ today, entries, ongoing, onOpen }: { today: string; entries: CalendarEntry[]; ongoing: OngoingAction[]; onOpen: (e: CalendarEntry) => void }) {
  const { go } = useApp()
  const todays = entries.filter((e) => e.date === today)
  const upcoming = entries.filter((e) => e.date > today && e.kind !== 'task' && e.kind !== 'actionEnd').slice(0, 4)
  return (
    <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-5">
      <section className="rounded-card border border-border bg-background shadow-card">
        <header className="border-b border-line px-4.5 py-3.5">
          <div className="text-xs font-bold tracking-[0.05em] text-primary-soft-foreground uppercase">{pl.calendar.today}</div>
          <h2 className="mt-0.5 text-base font-bold">{capitalize(longDate(today, false))}</h2>
        </header>
        <ul className="px-4.5 pt-2 pb-3.5">
          {todays.length === 0 && <li className="py-2 text-sm text-muted-foreground">{pl.calendar.nothingToday}</li>}
          {todays.map((e) => (
            <li key={e.key} className="border-b border-line last:border-0">
              <button type="button" onClick={() => onOpen(e)} className="flex w-full cursor-pointer items-start gap-2.5 py-2.25 text-left hover:text-primary">
                <span aria-hidden="true" className={cn('mt-1.25 h-2 w-2 shrink-0 rounded-full', entryTone(e).dot)} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[13px] font-semibold', e.taskDone && 'text-faint line-through')}>{entryLabel(e)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{entrySub(e)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-card border border-border bg-background px-4.5 py-3.5 shadow-card">
        <h2 className="mb-2.5 text-[15px] font-bold">{pl.calendar.ongoing}</h2>
        {ongoing.length === 0 && <p className="text-sm text-muted-foreground">{pl.calendar.noOngoing}</p>}
        <div className="flex flex-col gap-2">
          {ongoing.map((o) => (
            <button
              key={o.actionId}
              type="button"
              onClick={() => go({ name: 'action', id: o.actionId })}
              className={cn('cursor-pointer rounded-[10px] border px-3 py-2.5 text-left hover:brightness-[0.98]', o.type === 'fundraiser' ? 'border-warning-border bg-warning-bg' : 'border-line bg-subtle')}
            >
              <div className="text-[13px] font-semibold">{o.title}</div>
              <div className={cn('mt-0.5 text-xs', o.type === 'fundraiser' ? 'text-orange' : 'text-muted-foreground')}>
                {formatDate(o.startDate).slice(0, 5)} – {formatDate(o.endDate)} · {pl.actionTypes[o.type]}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-card border border-border bg-background px-4.5 py-3.5 shadow-card">
        <h2 className="mb-1.5 text-[15px] font-bold">{pl.calendar.upcoming}</h2>
        {upcoming.length === 0 && <p className="text-sm text-muted-foreground">{pl.calendar.noUpcoming}</p>}
        <ul>
          {upcoming.map((e) => (
            <li key={e.key} className="border-b border-line last:border-0">
              <button type="button" onClick={() => onOpen(e)} className="flex w-full cursor-pointer items-center gap-2.5 py-2 text-left hover:text-primary">
                <span className={cn('rounded-lg px-2 py-1 text-xs font-bold whitespace-nowrap', entryTone(e).chip)}>{shortDay(e.date)}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{entryLabel(e)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function ExportDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const { session, moduleOn } = useApp()
  const [months, setMonths] = useState<1 | 3>(1)
  const [withTasks, setWithTasks] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    setMsg('')
    try {
      const from = startOfMonth(today)
      const to = endOfMonth(addMonths(today, months - 1))
      const { entries } = await call('calendar.entries', { from, to })
      const events = toIcsEvents(entries, withTasks)
      const content = buildIcs(events, { calendarName: session.settings.orgName, now: new Date() })
      downloadText(pl.calendar.exportName(from.slice(0, 7)), content, 'text/calendar;charset=utf-8')
      setMsg(`${pl.calendar.exportDone} · ${pl.calendar.exportCount(events.length)}`)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={pl.calendar.exportTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {pl.common.close}
          </Button>
          <Button onClick={() => void save()}>
            <Download size={15} /> {pl.calendar.exportSave}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 font-medium text-secondary-foreground">{pl.calendar.exportRange}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="range" className="accent-primary" checked={months === 1} onChange={() => setMonths(1)} /> {pl.calendar.exportMonth}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="range" className="accent-primary" checked={months === 3} onChange={() => setMonths(3)} /> {pl.calendar.export3}
          </label>
        </fieldset>
        {moduleOn('tasks') && (
          <label className="flex items-center gap-2">
            <Checkbox checked={withTasks} onChange={(e) => setWithTasks(e.target.checked)} /> {pl.calendar.exportTasks}
          </label>
        )}
        <p className="text-xs text-muted-foreground">{pl.calendar.exportHint}</p>
        {msg && (
          <p className="text-sm text-success" role="status">
            {msg}
          </p>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </Dialog>
  )
}
