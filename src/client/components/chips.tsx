// Kolorowe chipy typów, statusów i ról (kolory wg makiety).
import { pl } from '../i18n/pl'
import { useApp } from '../app/context'
import { Badge, type Tone } from './ui'
import type { ActionStatus, ActionType, Role, TaskStatus } from '@shared/domain'

export const ACTION_TYPE_TONE: Record<ActionType, Tone> = {
  training: 'primary',
  workshop: 'primary',
  event: 'violet',
  meeting: 'info',
  fundraiser: 'orange',
  other: 'default'
}

export const ACTION_STATUS_TONE: Record<ActionStatus, Tone> = {
  planned: 'info',
  ongoing: 'primary',
  done: 'success',
  cancelled: 'muted'
}

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = { todo: 'default', doing: 'info', done: 'success' }

const ROLE_TONE: Record<Role, Tone> = {
  participant: 'primary',
  volunteer: 'violet',
  donor: 'orange',
  member: 'info',
  partner: 'success',
  trainer: 'warning',
  staff: 'default',
  other: 'muted'
}

export const ActionTypeChip = ({ type }: { type: ActionType }) => <Badge tone={ACTION_TYPE_TONE[type]}>{pl.actionTypes[type]}</Badge>
export const ActionStatusChip = ({ status }: { status: ActionStatus }) => <Badge tone={ACTION_STATUS_TONE[status]}>{pl.actionStatuses[status]}</Badge>
export const TaskStatusChip = ({ status }: { status: TaskStatus }) => <Badge tone={TASK_STATUS_TONE[status]}>{pl.taskStatuses[status]}</Badge>

export function RoleChip({ role }: { role: Role }) {
  const { roleLabel } = useApp()
  return <Badge tone={ROLE_TONE[role]}>{roleLabel(role)}</Badge>
}
