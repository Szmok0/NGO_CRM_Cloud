// Zadania i checklisty (wzór: desktopowe src/main/services/tasks.ts i loadTasks z common.ts).
// Różnice wobec desktopu: `version` przy każdym zapisie; przypisać można tylko aktywnego użytkownika;
// „dotyczy” musi wskazywać istniejącą, nieusuniętą osobę albo działanie.
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { ApiParsed } from '@shared/api'
import type { Priority, TargetType, TaskStatus } from '@shared/domain'
import { AppError } from '@shared/errors'
import { displayName } from '@shared/text'
import type { Task, TaskDetail, TaskItem, TaskListItem, UserOption } from '@shared/types'
import type { Db } from '../db/connection'
import { actions, contacts, taskItems, tasks, users } from '../db/schema'
import { contactsById, meta, repoFor, type Actor } from './common'

type TaskRow = typeof tasks.$inferSelect

const toTask = (t: TaskRow): Task => ({
  ...meta(t),
  title: t.title,
  dueDate: t.dueDate,
  assigneeUserId: t.assigneeUserId,
  status: t.status as TaskStatus,
  priority: t.priority as Priority,
  targetType: t.targetType as TargetType | null,
  targetId: t.targetId,
  description: t.description
})

export async function listUserOptions(db: Db): Promise<UserOption[]> {
  return (await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.status, 'active'), isNull(users.deletedAt)))).sort((a, b) =>
    a.name.localeCompare(b.name, 'pl')
  )
}

async function userNames(db: Db): Promise<Map<string, string>> {
  return new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]))
}

/** Nazwy obiektów, z którymi można powiązać zadanie (osoby, instytucje, działania). */
async function targetLabels(db: Db): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const c of (await contactsById(db)).values()) map.set(c.id, displayName(c))
  for (const a of await db.select({ id: actions.id, title: actions.title }).from(actions)) map.set(a.id, a.title)
  return map
}

export async function loadTasks(db: Db, filter: { assigneeUserId?: string; targetType?: TargetType | null; targetId?: string | null } = {}): Promise<TaskListItem[]> {
  const conds = [isNull(tasks.deletedAt)]
  if (filter.assigneeUserId) conds.push(eq(tasks.assigneeUserId, filter.assigneeUserId))
  if (filter.targetType) conds.push(eq(tasks.targetType, filter.targetType))
  if (filter.targetId) conds.push(eq(tasks.targetId, filter.targetId))
  let rows = await db.select().from(tasks).where(and(...conds))
  // zadania działania przeniesionego do Kosza znikają z list zbiorczych (wracają po przywróceniu działania)
  if (!filter.targetId) {
    const deleted = new Set((await db.select({ id: actions.id }).from(actions).where(isNotNull(actions.deletedAt))).map((a) => a.id))
    rows = rows.filter((t) => !(t.targetType === 'action' && t.targetId && deleted.has(t.targetId)))
  }
  if (rows.length === 0) return []
  const items = await db
    .select({ taskId: taskItems.taskId, done: taskItems.done })
    .from(taskItems)
    .where(and(inArray(taskItems.taskId, rows.map((r) => r.id)), isNull(taskItems.deletedAt)))
  const [names, labels] = await Promise.all([userNames(db), targetLabels(db)])
  return rows
    .map((t) => {
      const own = items.filter((i) => i.taskId === t.id)
      return {
        ...toTask(t),
        assigneeName: t.assigneeUserId ? (names.get(t.assigneeUserId) ?? null) : null,
        targetLabel: t.targetId ? (labels.get(t.targetId) ?? null) : null,
        itemsDone: own.filter((i) => i.done).length,
        itemsTotal: own.length
      }
    })
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title, 'pl'))
}

export const listTasks = (db: Db, f: ApiParsed<'tasks.list'>, actor: Actor) =>
  loadTasks(db, { assigneeUserId: f.mine ? actor.userId : undefined, targetType: f.targetType, targetId: f.targetId })

export async function getTask(db: Db, id: string): Promise<TaskDetail> {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id))
  if (!t) throw new AppError('NOT_FOUND')
  const items = (
    await db
      .select()
      .from(taskItems)
      .where(and(eq(taskItems.taskId, id), isNull(taskItems.deletedAt)))
  )
    .map((i): TaskItem => ({ ...meta(i), taskId: i.taskId, label: i.label, done: i.done, position: i.position }))
    .sort((a, b) => a.position - b.position)
  const [names, labels] = await Promise.all([userNames(db), targetLabels(db)])
  return {
    task: toTask(t),
    items,
    assigneeName: t.assigneeUserId ? (names.get(t.assigneeUserId) ?? null) : null,
    targetLabel: t.targetId ? (labels.get(t.targetId) ?? null) : null
  }
}

/** Sprawdza przypisanie i „dotyczy”; niepełne „dotyczy” (sam typ albo samo id) jest czyszczone, jak w desktopie. */
async function checked<T extends { assigneeUserId: string | null; targetType: TargetType | null; targetId: string | null }>(db: Db, f: T): Promise<T> {
  if (f.assigneeUserId) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, f.assigneeUserId), eq(users.status, 'active'), isNull(users.deletedAt)))
    if (!u) throw new AppError('VALIDATION', 'ASSIGNEE_INACTIVE')
  }
  if (!f.targetType || !f.targetId) return { ...f, targetType: null, targetId: null }
  const table = f.targetType === 'contact' ? contacts : actions
  const [target] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, f.targetId), isNull(table.deletedAt)))
  if (!target) throw new AppError('NOT_FOUND')
  return f
}

export async function createTask(db: Db, input: ApiParsed<'tasks.create'>, actor: Actor): Promise<{ id: string }> {
  const { items, ...fields } = input
  const values = await checked(db, fields)
  return db.transaction(async (tx) => {
    const repo = repoFor(tx, actor)
    const t = await repo.insert(tasks, values)
    for (const [position, label] of items.entries()) await repo.insert(taskItems, { taskId: t.id, label, done: false, position })
    return { id: t.id }
  })
}

export async function updateTask(db: Db, input: ApiParsed<'tasks.update'>, actor: Actor): Promise<void> {
  const { id, version, ...patch } = input
  await repoFor(db, actor).update(tasks, id, version, await checked(db, patch))
}

export const moveTask = async (db: Db, i: ApiParsed<'tasks.move'>, actor: Actor) => void (await repoFor(db, actor).update(tasks, i.id, i.version, { status: i.status }))
export const deleteTask = async (db: Db, i: ApiParsed<'tasks.delete'>, actor: Actor) => void (await repoFor(db, actor).softDelete(tasks, i.id, i.version))

export async function addTaskItem(db: Db, i: ApiParsed<'taskItems.add'>, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, i.taskId), isNull(tasks.deletedAt)))
      .for('update')
    if (!t) throw new AppError('NOT_FOUND')
    const max = (await tx.select({ p: taskItems.position }).from(taskItems).where(eq(taskItems.taskId, i.taskId))).reduce((m, r) => Math.max(m, r.p), -1)
    await repoFor(tx, actor).insert(taskItems, { taskId: i.taskId, label: i.label, done: false, position: max + 1 })
  })
}
export const toggleTaskItem = async (db: Db, i: ApiParsed<'taskItems.toggle'>, actor: Actor) =>
  void (await repoFor(db, actor).update(taskItems, i.id, i.version, { done: i.done }))
export const deleteTaskItem = async (db: Db, i: ApiParsed<'taskItems.delete'>, actor: Actor) => void (await repoFor(db, actor).softDelete(taskItems, i.id, i.version))
