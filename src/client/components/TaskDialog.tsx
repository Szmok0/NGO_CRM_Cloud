// Nowe zadanie (taskId = null) albo edycja istniejącego, z checklistą (przeniesione z desktopu).
// Zapisy odsyłają `version` zadania i pozycji checklisty; osoba odpowiedzialna z listy aktywnych użytkowników.
import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { PRIORITIES, TASK_STATUSES, type Priority, type TargetType, type TaskStatus } from '@shared/domain'
import type { ActionListItem, TaskDetail, UserOption } from '@shared/types'
import { useApp } from '../app/context'
import { pl } from '../i18n/pl'
import { call, errorMessage } from '../lib/api'
import { ContactPicker } from './ContactPicker'
import { Button, Checkbox, Dialog, ErrorText, Field, Input, Select, Textarea } from './ui'

interface Form {
  title: string
  dueDate: string
  assigneeUserId: string
  status: TaskStatus
  priority: Priority
  targetType: TargetType | ''
  targetId: string
  targetLabel: string
  description: string
  newItems: string
}

export function TaskDialog({
  taskId,
  defaults,
  onClose,
  onSaved
}: {
  taskId: string | null
  defaults?: { targetType?: TargetType; targetId?: string; targetLabel?: string; dueDate?: string }
  onClose: () => void
  onSaved: () => void
}) {
  const { session, moduleOn, canWrite } = useApp()
  const [users, setUsers] = useState<UserOption[]>([])
  const [actions, setActions] = useState<ActionListItem[]>([])
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [newItem, setNewItem] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState<Form>({
    title: '',
    dueDate: defaults?.dueDate ?? '',
    assigneeUserId: session.me.userId,
    status: 'todo',
    priority: 'normal',
    targetType: defaults?.targetType ?? '',
    targetId: defaults?.targetId ?? '',
    targetLabel: defaults?.targetLabel ?? '',
    description: '',
    newItems: ''
  })
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const editable = canWrite && !detail?.task.deletedAt

  const loadDetail = useCallback(async () => {
    if (!taskId) return
    const d = await call('tasks.get', { id: taskId })
    setDetail(d)
    return d
  }, [taskId])

  useEffect(() => {
    void call('users.options', {}).then(setUsers)
    if (moduleOn('actions')) void call('actions.list', {}).then(setActions)
    void loadDetail()
      .then((d) => {
        if (!d) return
        setF({
          title: d.task.title,
          dueDate: d.task.dueDate ?? '',
          assigneeUserId: d.task.assigneeUserId ?? '',
          status: d.task.status,
          priority: d.task.priority,
          targetType: d.task.targetType ?? '',
          targetId: d.task.targetId ?? '',
          targetLabel: d.targetLabel ?? '',
          description: d.task.description ?? '',
          newItems: ''
        })
      })
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [loadDetail, moduleOn])

  /** Zmiana w checkliście: od razu zapis, odświeżenie okna i widoku pod spodem. */
  const runItem = (fn: () => Promise<unknown>) => {
    setError('')
    fn()
      .then(() => loadDetail())
      .then(onSaved)
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const save = async () => {
    const fields = {
      title: f.title,
      dueDate: f.dueDate || null,
      assigneeUserId: f.assigneeUserId || null,
      status: f.status,
      priority: f.priority,
      targetType: f.targetType && f.targetId ? f.targetType : null,
      targetId: f.targetType && f.targetId ? f.targetId : null,
      description: f.description
    }
    setBusy(true)
    setError('')
    try {
      if (detail) await call('tasks.update', { id: detail.task.id, version: detail.task.version, ...fields })
      else
        await call('tasks.create', {
          ...fields,
          items: f.newItems
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        })
      onSaved()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!detail || !confirm(pl.common.confirmDelete)) return
    try {
      await call('tasks.delete', { id: detail.task.id, version: detail.task.version })
      onSaved()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={taskId ? pl.tasks.edit : pl.tasks.add}
      wide
      footer={
        editable ? (
          <>
            {detail && (
              <Button variant="ghost" className="mr-auto text-destructive" onClick={() => void remove()}>
                <Trash2 size={14} /> {pl.common.delete}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              {pl.common.cancel}
            </Button>
            <Button disabled={!f.title.trim() || busy || (!!taskId && !detail)} onClick={() => void save()}>
              {pl.common.save}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {pl.common.close}
          </Button>
        )
      }
    >
      <fieldset disabled={!editable} className="grid grid-cols-2 gap-3">
        <Field label={pl.tasks.titleField} className="col-span-2">
          <Input autoFocus maxLength={255} value={f.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label={pl.tasks.due}>
          <Input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
        <Field label={pl.tasks.assignee}>
          <Select value={f.assigneeUserId} onChange={(e) => set('assigneeUserId', e.target.value)}>
            <option value="">{pl.tasks.nobody}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={pl.tasks.status}>
          <Select value={f.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {pl.taskStatuses[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={pl.tasks.priority}>
          <Select value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {pl.priorities[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={pl.tasks.target}>
          <Select value={f.targetType} onChange={(e) => setF((x) => ({ ...x, targetType: e.target.value as TargetType | '', targetId: '', targetLabel: '' }))}>
            <option value="">{pl.tasks.targetNone}</option>
            <option value="contact">{pl.tasks.targetContact}</option>
            {moduleOn('actions') && <option value="action">{pl.tasks.targetAction}</option>}
          </Select>
        </Field>
        <div className="flex flex-col justify-end">
          {f.targetType === 'action' && (
            <Select aria-label={pl.tasks.targetAction} value={f.targetId} onChange={(e) => set('targetId', e.target.value)}>
              <option value="">—</option>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </Select>
          )}
          {f.targetType === 'contact' &&
            (f.targetId ? (
              <div className="flex h-9 items-center gap-2 text-sm">
                <span className="font-medium">{f.targetLabel}</span>
                <Button variant="link" size="sm" onClick={() => setF((x) => ({ ...x, targetId: '', targetLabel: '' }))}>
                  {pl.common.clear}
                </Button>
              </div>
            ) : (
              <ContactPicker onPick={(c) => setF((x) => ({ ...x, targetId: c.id, targetLabel: c.label }))} />
            ))}
        </div>
        <Field label={pl.tasks.description} className="col-span-2">
          <Textarea value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        {!taskId && (
          <Field label={pl.tasks.itemsOnCreate} className="col-span-2">
            <Textarea value={f.newItems} onChange={(e) => set('newItems', e.target.value)} />
          </Field>
        )}
      </fieldset>
      {detail && (
        <div className="mt-3">
          <h4 className="mb-1 text-sm font-medium">{pl.tasks.checklist}</h4>
          <ul className="flex flex-col gap-1">
            {detail.items.map((i) => (
              <li key={i.id} className="group flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label={i.label}
                  disabled={!editable}
                  checked={i.done}
                  onChange={(e) => runItem(() => call('taskItems.toggle', { id: i.id, version: i.version, done: e.target.checked }))}
                />
                <span className={i.done ? 'text-muted-foreground line-through' : ''}>{i.label}</span>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={pl.tasks.removeItem}
                    title={pl.tasks.removeItem}
                    onClick={() => runItem(() => call('taskItems.delete', { id: i.id, version: i.version }))}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {editable && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!newItem.trim() || !taskId) return
                runItem(async () => {
                  await call('taskItems.add', { taskId, label: newItem })
                  setNewItem('')
                })
              }}
            >
              <Input placeholder={pl.tasks.newItem} aria-label={pl.tasks.newItem} maxLength={500} value={newItem} onChange={(e) => setNewItem(e.target.value)} />
              <Button type="submit" variant="outline">
                {pl.tasks.addItem}
              </Button>
            </form>
          )}
        </div>
      )}
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </Dialog>
  )
}
