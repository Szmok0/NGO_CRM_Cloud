// Zadania: kanban z przeciąganiem (natywne HTML5 drag & drop, D7) i strzałkami oraz lista (przeniesione z desktopu).
import { useState } from 'react'
import { ChevronLeft, ChevronRight, ListChecks, Plus } from 'lucide-react'
import { TASK_STATUSES, type TaskStatus } from '@shared/domain'
import type { TaskListItem } from '@shared/types'
import { useApp } from '../../app/context'
import { TaskDialog } from '../../components/TaskDialog'
import { TaskTable } from '../../components/TaskRows'
import { Avatar, Badge, Button, Card, Checkbox, ErrorText, PageHeader, Tabs } from '../../components/ui'
import { pl } from '../../i18n/pl'
import { call, errorMessage, useLoad } from '../../lib/api'
import { barWidth } from '../../lib/bar'
import { cn } from '../../lib/cn'
import { capitalize, formatDate, todayYmd } from '../../lib/format'

export function TasksView() {
  const { canWrite } = useApp()
  const [view, setView] = useState<'list' | 'kanban'>('kanban')
  const [mine, setMine] = useState(false)
  const [open, setOpen] = useState<string | 'new' | null>(null)
  const { data, error, reload } = useLoad('tasks.list', { mine })

  return (
    <div>
      <PageHeader
        title={pl.tasks.title}
        actions={
          canWrite && (
            <Button onClick={() => setOpen('new')}>
              <Plus size={14} /> {pl.tasks.add}
            </Button>
          )
        }
      >
        <div className="flex items-end justify-between">
          <Tabs
            value={view}
            onChange={setView}
            tabs={[
              { id: 'kanban', label: pl.tasks.kanban },
              { id: 'list', label: pl.tasks.list }
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} /> {pl.tasks.mine}
          </label>
        </div>
      </PageHeader>
      <ErrorText>{error}</ErrorText>
      {data && view === 'list' && (
        <Card>
          <TaskTable tasks={data} onOpen={setOpen} />
        </Card>
      )}
      {data && view === 'kanban' && <Kanban tasks={data} editable={canWrite} onOpen={setOpen} onChange={reload} />}
      {open && <TaskDialog taskId={open === 'new' ? null : open} onClose={() => setOpen(null)} onSaved={reload} />}
    </div>
  )
}

const COLUMN_DOT: Record<TaskStatus, string> = { todo: 'bg-faint', doing: 'bg-info', done: 'bg-success' }

function Kanban({ tasks, editable, onOpen, onChange }: { tasks: TaskListItem[]; editable: boolean; onOpen: (id: string) => void; onChange: () => void }) {
  const today = todayYmd()
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const [error, setError] = useState('')

  const setStatus = async (t: TaskListItem, status: TaskStatus) => {
    setError('')
    try {
      await call('tasks.move', { id: t.id, version: t.version, status })
      onChange()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const move = (t: TaskListItem, dir: -1 | 1) => {
    const status = TASK_STATUSES[TASK_STATUSES.indexOf(t.status) + dir]
    if (status) void setStatus(t, status)
  }
  const drop = (status: TaskStatus) => {
    const t = tasks.find((x) => x.id === dragId)
    setDragId(null)
    setOver(null)
    if (t && t.status !== status) void setStatus(t, status)
  }

  return (
    <>
      <ErrorText>{error}</ErrorText>
      {editable && <p className="mb-3 text-xs text-muted-foreground">{pl.tasks.dragHint}</p>}
      <div className="grid grid-cols-3 gap-4">
        {TASK_STATUSES.map((status, col) => {
          const items = tasks.filter((t) => t.status === status)
          return (
            <section
              key={status}
              aria-label={pl.taskStatuses[status]}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOver(status)
              }}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
              onDrop={(e) => {
                e.preventDefault()
                drop(status)
              }}
              className={cn('min-w-0 rounded-card border bg-muted/60 p-3 transition-colors', over === status ? 'border-primary bg-primary-soft/60' : 'border-transparent')}
            >
              <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-bold">
                <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', COLUMN_DOT[status])} />
                {capitalize(pl.taskStatuses[status])}
                <span className="rounded-full bg-background px-2 text-xs font-semibold text-muted-foreground">{items.length}</span>
              </h2>
              <ul className="flex min-h-16 flex-col gap-2.5">
                {items.map((t) => {
                  const overdue = status !== 'done' && !!t.dueDate && t.dueDate < today
                  const done = status === 'done'
                  return (
                    <li
                      key={t.id}
                      draggable={editable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', t.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(t.id)
                      }}
                      onDragEnd={() => {
                        setDragId(null)
                        setOver(null)
                      }}
                      className={cn('rounded-xl border border-border bg-background p-3 shadow-card', editable && 'cursor-grab active:cursor-grabbing', dragId === t.id && 'opacity-50')}
                    >
                      <button type="button" className={cn('w-full cursor-pointer text-left text-sm font-semibold hover:text-primary', done && 'text-faint line-through')} onClick={() => onOpen(t.id)}>
                        {t.title}
                      </button>
                      {t.targetLabel && <div className="mt-1 text-xs font-medium text-primary-soft-foreground">{t.targetLabel}</div>}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {t.dueDate && <Badge tone={overdue ? 'danger' : done ? 'success' : 'default'}>{formatDate(t.dueDate)}</Badge>}
                        {t.priority === 'high' && !done && <Badge tone="danger">{pl.priorities.high}</Badge>}
                      </div>
                      {t.itemsTotal > 0 && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <ListChecks size={13} aria-hidden="true" />
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                            <span className={cn('block h-full bg-primary', barWidth((t.itemsDone / t.itemsTotal) * 100))} />
                          </span>
                          {pl.tasks.progress(t.itemsDone, t.itemsTotal)}
                        </div>
                      )}
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        {t.assigneeName ? (
                          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={t.assigneeName}>
                            <Avatar id={t.assigneeUserId!} name={t.assigneeName} size={24} />
                            <span className="truncate">{t.assigneeName}</span>
                          </span>
                        ) : (
                          <span />
                        )}
                        {editable && (
                          <span className="flex shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={col === 0} aria-label={`${pl.tasks.moveLeft}: ${t.title}`} title={pl.tasks.moveLeft} onClick={() => move(t, -1)}>
                              <ChevronLeft size={15} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={col === TASK_STATUSES.length - 1}
                              aria-label={`${pl.tasks.moveRight}: ${t.title}`}
                              title={pl.tasks.moveRight}
                              onClick={() => move(t, 1)}
                            >
                              <ChevronRight size={15} />
                            </Button>
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}
