// Ekran „Dziś” (przeniesiony z desktopu): powitanie, kafelki, „Mój dzień”, najbliższe dni, mini-kalendarz,
// „Wymaga uwagi”, „Ostatnio w organizacji”. Bez karty kopii zapasowej (ZADANIE_04) i alertów przygotowania (ZADANIE_05).
import { useCallback, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarDays, Check, CheckSquare, HandHeart, ListChecks, NotebookPen, UserPlus, Users } from 'lucide-react'
import type { CalendarEntry } from '@shared/calendar'
import { daysBetween, weekday } from '@shared/dates'
import type { TaskStatus } from '@shared/domain'
import type { TaskListItem, TodayData } from '@shared/types'
import { useApp } from '../app/context'
import { MiniCalendar } from '../components/MiniCalendar'
import { TaskDialog } from '../components/TaskDialog'
import { Avatar, Badge, Button, Card, EmptyState, ErrorText, InfoNote } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, errorMessage, useDataChanged, useLoad } from '../lib/api'
import { entryKindLabel, typeTone } from '../lib/calendarUi'
import { cn } from '../lib/cn'
import { feedText } from '../lib/feedText'
import { capitalize, formatDate, longDate, relativeTime, shortDay, timeRange, todayYmd } from '../lib/format'

export function TodayView({ notice }: { notice?: string }) {
  const { go, moduleOn, session, create, canWrite } = useApp()
  const { data, error, reload } = useLoad('today.get', {})
  useDataChanged(useCallback(() => reload(), [reload]))
  const [task, setTask] = useState<string | null>(null)

  if (error) return <ErrorText>{error}</ErrorText>
  if (!data) return null

  const t = todayYmd()
  const tasksOn = moduleOn('tasks')
  const actionsOn = moduleOn('actions')
  const next = data.week.next
  const nextLabel = next ? `${shortDay(next.date)}${next.startTime ? `, ${next.startTime}` : ''}` : null
  const summary = [
    tasksOn && (data.tasksOverdue.length ? pl.today.summaryOverdue(data.tasksOverdue.length) : pl.today.summaryNoOverdue),
    actionsOn && nextLabel && pl.today.summaryNext(nextLabel)
  ].filter(Boolean)
  const oldest = data.tasksOverdue.reduce<string | null>((min, x) => (!min || x.dueDate! < min ? x.dueDate! : min), null)

  return (
    <div className="flex flex-col gap-6">
      <InfoNote>{notice}</InfoNote>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{pl.today.hello(session.account.name.split(' ')[0]!)}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{[capitalize(longDate(t)), ...summary].join(' · ')}</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => create('person')}>
              <UserPlus size={16} /> {pl.today.quick.person}
            </Button>
            <Button variant="outline" onClick={() => create('note')}>
              <NotebookPen size={16} /> {pl.today.quick.note}
            </Button>
            {tasksOn && (
              <Button variant="outline" onClick={() => create('task')}>
                <CheckSquare size={16} /> {pl.today.quick.task}
              </Button>
            )}
            {actionsOn && (
              <Button variant="outline" onClick={() => create('action')}>
                <HandHeart size={16} /> {pl.today.quick.action}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4">
        {tasksOn && (
          <Tile
            value={data.tasksOverdue.length}
            label={pl.today.tiles.overdue}
            sub={oldest ? pl.today.tiles.overdueSub(daysBetween(oldest, t)) : pl.today.tiles.overdueNone}
            icon={<AlertTriangle size={22} />}
            tone="bg-destructive-soft text-destructive"
            onClick={() => go({ name: 'tasks' })}
          />
        )}
        {tasksOn && (
          <Tile
            value={data.tasksToday.length}
            label={pl.today.tiles.today}
            sub={data.tasksToday.length ? pl.today.tiles.todaySub(data.tasksToday.filter((x) => x.itemsTotal > 0).length) : pl.today.tiles.todayNone}
            icon={<CheckSquare size={22} />}
            tone="bg-primary-soft text-primary-soft-foreground"
            onClick={() => go({ name: 'tasks' })}
          />
        )}
        {actionsOn && (
          <Tile
            value={data.week.sessions}
            label={pl.today.tiles.week}
            sub={nextLabel ? pl.today.tiles.weekSub(nextLabel) : pl.today.tiles.weekNone}
            icon={<CalendarDays size={22} />}
            tone="bg-info-soft text-info"
            onClick={() => go({ name: 'calendar', mode: 'week' })}
          />
        )}
        {actionsOn && (
          <Tile
            value={data.stale.length}
            label={pl.today.tiles.attention}
            sub={pl.today.tiles.attentionSub}
            icon={<Users size={22} />}
            tone="bg-warning-soft text-warning"
            onClick={() => document.getElementById('attention')?.focus()}
          />
        )}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {(tasksOn || actionsOn) && (
          <Card className="min-w-0 flex-[2_1_560px]" title={pl.today.myDay} actions={tasksOn && canWrite && <span className="text-xs text-muted-foreground">{pl.today.myDayHint}</span>} flush>
            <div className="px-5 pt-1 pb-5">
              {tasksOn && <MyTasks data={data} today={t} onOpen={setTask} onCreate={() => create('task')} reload={reload} />}
              {actionsOn && <Upcoming entries={data.upcoming} onCreate={() => create('action')} />}
            </div>
          </Card>
        )}

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
          <MiniCalendar />
          {actionsOn && <Attention data={data} />}
          <Recent data={data} onOpenTask={setTask} />
        </div>
      </div>

      {task && <TaskDialog taskId={task} onClose={() => setTask(null)} onSaved={reload} />}
    </div>
  )
}

function Tile({ value, label, sub, icon, tone, onClick }: { value: number; label: string; sub: string; icon: ReactNode; tone: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex cursor-pointer items-center gap-3.5 rounded-card border border-border bg-background p-4.5 text-left shadow-card hover:border-input hover:bg-subtle">
      <span aria-hidden="true" className={cn('flex h-11.5 w-11.5 shrink-0 items-center justify-center rounded-xl', tone)}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[28px] leading-none font-bold">{value}</span>
        <span className="mt-1.5 block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  )
}

const groupTitle = 'mt-4.5 mb-0.5 text-xs font-bold tracking-[0.06em] uppercase'

function MyTasks({ data, today, onOpen, onCreate, reload }: { data: TodayData; today: string; onOpen: (id: string) => void; onCreate: () => void; reload: () => void }) {
  const { canWrite } = useApp()
  // poprzedni status odhaczonego zadania, żeby ponowne kliknięcie go przywróciło
  const [prev, setPrev] = useState<Record<string, TaskStatus>>({})
  const [error, setError] = useState('')
  const toggle = async (x: TaskListItem) => {
    setError('')
    try {
      if (x.status === 'done') {
        await call('tasks.move', { id: x.id, version: x.version, status: prev[x.id] ?? 'todo' })
      } else {
        setPrev((p) => ({ ...p, [x.id]: x.status }))
        await call('tasks.move', { id: x.id, version: x.version, status: 'done' })
      }
      reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const byDue = (a: TaskListItem, b: TaskListItem) => a.dueDate!.localeCompare(b.dueDate!) || a.title.localeCompare(b.title, 'pl')
  const overdue = [...data.tasksOverdue, ...data.tasksDoneToday.filter((x) => x.dueDate! < today)].sort(byDue)
  const todays = [...data.tasksToday, ...data.tasksDoneToday.filter((x) => x.dueDate === today)].sort(byDue)

  if (overdue.length + todays.length === 0)
    return (
      <EmptyState
        icon={<CheckSquare size={20} />}
        text={pl.today.noTasks}
        action={
          canWrite && (
            <Button variant="outline" size="sm" onClick={onCreate}>
              {pl.today.addTask}
            </Button>
          )
        }
      />
    )

  return (
    <>
      <ErrorText>{error}</ErrorText>
      {overdue.length > 0 && <TaskGroup title={pl.today.overdue} color="text-destructive" tasks={overdue} today={today} onToggle={toggle} onOpen={onOpen} />}
      {todays.length > 0 && <TaskGroup title={pl.today.dueToday} color="text-primary-soft-foreground" tasks={todays} today={today} onToggle={toggle} onOpen={onOpen} />}
    </>
  )
}

function TaskGroup({
  title,
  color,
  tasks,
  today,
  onToggle,
  onOpen
}: {
  title: string
  color: string
  tasks: TaskListItem[]
  today: string
  onToggle: (t: TaskListItem) => void
  onOpen: (id: string) => void
}) {
  const { go, canWrite } = useApp()
  return (
    <section>
      <h3 className={cn(groupTitle, color)}>{title}</h3>
      <ul>
        {tasks.map((x) => {
          const done = x.status === 'done'
          const late = !done && x.dueDate! < today
          return (
            <li key={x.id} className="flex items-center gap-3 border-b border-line py-2.75">
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => onToggle(x)}
                aria-label={done ? pl.today.markUndone(x.title) : pl.today.markDone(x.title)}
                aria-pressed={done}
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-white enabled:cursor-pointer',
                  done ? 'border-primary bg-primary' : late ? 'border-[#D9480F] bg-background enabled:hover:bg-destructive-soft' : 'border-[#8A93A6] bg-background enabled:hover:bg-primary-soft'
                )}
              >
                {done && <Check size={14} strokeWidth={3} />}
              </button>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onOpen(x.id)} className={cn('cursor-pointer text-left font-semibold hover:text-primary', done && 'text-faint line-through')}>
                  {x.title}
                </button>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {x.targetId && x.targetLabel && (
                    <button
                      type="button"
                      onClick={() => go(x.targetType === 'action' ? { name: 'action', id: x.targetId! } : { name: 'contact', id: x.targetId! })}
                      className={cn(
                        'cursor-pointer rounded-full px-2 py-0.5 text-xs font-semibold hover:underline',
                        x.targetType === 'action' ? 'bg-primary-soft text-primary-soft-foreground' : 'bg-info-soft text-info'
                      )}
                    >
                      {x.targetLabel}
                    </button>
                  )}
                  {x.itemsTotal > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ListChecks size={13} aria-hidden="true" /> {pl.today.checklist(x.itemsDone, x.itemsTotal)}
                    </span>
                  )}
                  {x.priority === 'high' && !done && <span className="text-xs font-semibold text-destructive">{pl.today.highPriority}</span>}
                </div>
              </div>
              <Badge tone={done ? 'success' : late ? 'danger' : 'default'}>{x.dueDate === today ? pl.today.dueTodayChip : pl.today.dueOn(formatDate(x.dueDate).slice(0, 5))}</Badge>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Upcoming({ entries, onCreate }: { entries: CalendarEntry[]; onCreate: () => void }) {
  const { go, canWrite } = useApp()
  return (
    <section>
      <h3 className={cn(groupTitle, 'mt-5.5 text-muted-foreground')}>{pl.today.upcoming}</h3>
      {entries.length === 0 && (
        <EmptyState
          icon={<CalendarDays size={20} />}
          text={pl.today.noUpcoming}
          action={
            canWrite && (
              <Button variant="outline" size="sm" onClick={onCreate}>
                {pl.today.addAction}
              </Button>
            )
          }
        />
      )}
      <ul className="flex flex-col gap-2 pt-2">
        {entries.map((e) => {
          const tone = typeTone(e.actionType ?? 'other')
          const month = Number(e.date.slice(5, 7)) - 1
          return (
            <li key={e.key}>
              <button type="button" onClick={() => go({ name: 'action', id: e.actionId! })} className="flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-line p-3 text-left hover:bg-subtle">
                <span className={cn('w-14 shrink-0 rounded-[10px] py-1.5 text-center', tone.chip)}>
                  <span className="block text-[11px] font-bold tracking-[0.06em] uppercase">{pl.time.weekdaysShort[weekday(e.date)]}</span>
                  <span className="block text-xl leading-tight font-bold">{Number(e.date.slice(8))}</span>
                  <span className="block text-[11px]">{pl.time.monthsShort[month]}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{e.kind === 'session' ? pl.today.sessionOf(e.title, e.sessionNo!, e.sessionTotal!) : e.title}</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {[timeRange(e.startTime, e.endTime), e.place, e.participantCount ? pl.today.participants(e.participantCount) : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={cn('rounded-full px-2.5 py-0.75 text-xs font-semibold whitespace-nowrap', tone.chip)}>{entryKindLabel(e)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Attention({ data }: { data: TodayData }) {
  const { go, create, session, canWrite } = useApp()
  return (
    <section id="attention" tabIndex={-1} className="rounded-card outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <Card title={pl.today.attention} sub={pl.today.staleHint(session.settings.staleDays)} flush>
        <ul className="px-4.5 pt-1.5 pb-3.5">
          {data.stale.length === 0 && <li className="py-3 text-sm text-muted-foreground">{pl.today.noStale}</li>}
          {data.stale.map((s) => (
            <li key={s.contact.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <Avatar id={s.contact.id} name={s.contact.label} size={36} />
              <div className="min-w-0 flex-1">
                <button type="button" className="cursor-pointer text-left font-semibold hover:text-primary" onClick={() => go({ name: 'contact', id: s.contact.id })}>
                  {s.contact.label}
                </button>
                <div className="text-xs text-muted-foreground">{[s.actionTitle, pl.today.staleDays(s.days)].filter(Boolean).join(' · ')}</div>
              </div>
              {canWrite && (
                <Button variant="outline" size="sm" onClick={() => create('contactEntry', { contact: { id: s.contact.id, label: s.contact.label } })}>
                  {pl.today.addContact}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

function Recent({ data, onOpenTask }: { data: TodayData; onOpenTask: (id: string) => void }) {
  const { go } = useApp()
  const open = (target: NonNullable<TodayData['feed'][number]['target']>) => {
    if (target.type === 'task') return onOpenTask(target.id)
    if (target.type === 'action') return go({ name: 'action', id: target.id })
    if (target.type === 'topic') return go({ name: 'topic', id: target.id })
    go({ name: 'contact', id: target.id })
  }
  return (
    <Card title={pl.today.recent} flush>
      <ul className="px-4.5 pt-1.5 pb-3.5">
        {data.feed.length === 0 && <li className="py-3 text-sm text-muted-foreground">{pl.today.noRecent}</li>}
        {data.feed.map((f, i) => (
          <li key={i} className="flex gap-2.5 border-b border-line py-2.5 last:border-0">
            <Avatar id={f.userId} name={f.userName} size={30} />
            <div className="min-w-0 flex-1 text-[13px] leading-[1.45]">
              <span className="font-semibold">{f.userName}</span>
              {' · '}
              {f.target ? (
                <button type="button" className="cursor-pointer text-left hover:text-primary hover:underline" onClick={() => open(f.target!)}>
                  {feedText(f)}
                </button>
              ) : (
                feedText(f)
              )}
              <div className="mt-0.5 text-xs text-muted-foreground">{relativeTime(f.at)}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
