// Tabela zadań i karta „Zadania” przy osobie lub działaniu (przeniesione z desktopu).
import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { TargetType } from '@shared/domain'
import type { TaskListItem } from '@shared/types'
import { useApp } from '../app/context'
import { pl } from '../i18n/pl'
import { cn } from '../lib/cn'
import { formatDate, todayYmd } from '../lib/format'
import { TaskStatusChip } from './chips'
import { TaskDialog } from './TaskDialog'
import { Avatar, Badge, Button, Card, Empty, Table } from './ui'

export function TaskTable({ tasks, onOpen, showTarget = true, showAssignee = true }: { tasks: TaskListItem[]; onOpen: (id: string) => void; showTarget?: boolean; showAssignee?: boolean }) {
  const today = todayYmd()
  if (tasks.length === 0) return <Empty>{pl.tasks.noTasks}</Empty>
  return (
    <div className="overflow-x-auto">
      <Table>
        <thead>
          <tr>
            <th>{pl.tasks.titleField}</th>
            <th>{pl.tasks.due}</th>
            {showAssignee && <th>{pl.tasks.assignee}</th>}
            <th>{pl.tasks.status}</th>
            {showTarget && <th>{pl.tasks.target}</th>}
            <th>{pl.tasks.checklist}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const overdue = t.status !== 'done' && !!t.dueDate && t.dueDate < today
            return (
              <tr key={t.id} className="cursor-pointer" onClick={() => onOpen(t.id)}>
                <td>
                  <button
                    type="button"
                    className={cn('cursor-pointer text-left hover:text-primary', t.status === 'done' ? 'text-faint line-through' : 'font-semibold')}
                    onClick={(e) => (e.stopPropagation(), onOpen(t.id))}
                  >
                    {t.title}
                  </button>{' '}
                  {t.priority === 'high' && t.status !== 'done' && <Badge tone="danger">{pl.priorities.high}</Badge>}
                </td>
                <td className="whitespace-nowrap">{t.dueDate && <Badge tone={overdue ? 'danger' : t.status === 'done' ? 'success' : 'default'}>{formatDate(t.dueDate)}</Badge>}</td>
                {showAssignee && (
                  <td>
                    {t.assigneeName ? (
                      <span className="flex items-center gap-2">
                        <Avatar id={t.assigneeUserId!} name={t.assigneeName} size={24} />
                        {t.assigneeName}
                      </span>
                    ) : (
                      pl.common.none
                    )}
                  </td>
                )}
                <td>
                  <TaskStatusChip status={t.status} />
                </td>
                {showTarget && <td className="text-muted-foreground">{t.targetLabel ?? ''}</td>}
                <td className="text-muted-foreground">{t.itemsTotal > 0 ? pl.tasks.progress(t.itemsDone, t.itemsTotal) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}

/** Karta „Zadania” przy osobie lub działaniu. */
export function TargetTasks({
  tasks,
  target,
  editable,
  onChange
}: {
  tasks: TaskListItem[]
  target: { targetType: TargetType; targetId: string; targetLabel: string }
  editable: boolean
  onChange: () => void
}) {
  const { canWrite } = useApp()
  const [open, setOpen] = useState<string | null | 'new'>(null)
  return (
    <Card
      title={pl.tasks.title}
      actions={
        editable &&
        canWrite && (
          <Button size="sm" variant="outline" onClick={() => setOpen('new')}>
            <Plus size={13} /> {pl.tasks.add}
          </Button>
        )
      }
    >
      <TaskTable tasks={tasks} onOpen={setOpen} showTarget={false} />
      {open && <TaskDialog taskId={open === 'new' ? null : open} defaults={target} onClose={() => setOpen(null)} onSaved={onChange} />}
    </Card>
  )
}
