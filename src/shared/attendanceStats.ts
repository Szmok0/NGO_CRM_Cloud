import type { AttendanceStatus } from './domain'

export interface StatSession {
  id: string
  date: string // RRRR-MM-DD
}
export interface StatMark {
  sessionId: string
  contactId: string
  status: AttendanceStatus
}

export interface AttendanceStats {
  /** Obecność % na osobę (0–100, zaokrąglone) albo null, gdy nie było jeszcze zajęć. */
  byContact: Record<string, number | null>
  /** Liczba osób obecnych na każdych zajęciach. */
  presentBySession: Record<string, number>
  /** Liczba zajęć, które się już odbyły (data ≤ dziś) — mianownik procentu. */
  heldCount: number
}

/** Procent liczony względem zajęć, które już się odbyły (data ≤ today). */
export function computeAttendanceStats(
  sessions: StatSession[],
  contactIds: string[],
  marks: StatMark[],
  today: string
): AttendanceStats {
  const held = new Set(sessions.filter((s) => s.date <= today).map((s) => s.id))
  const presentBySession: Record<string, number> = Object.fromEntries(sessions.map((s) => [s.id, 0]))
  const presentByContact: Record<string, number> = {}
  for (const m of marks) {
    if (m.status !== 'present' || !(m.sessionId in presentBySession)) continue
    presentBySession[m.sessionId]!++
    if (held.has(m.sessionId)) presentByContact[m.contactId] = (presentByContact[m.contactId] ?? 0) + 1
  }
  const byContact: Record<string, number | null> = {}
  for (const id of contactIds) {
    byContact[id] = held.size === 0 ? null : Math.round(((presentByContact[id] ?? 0) / held.size) * 100)
  }
  return { byContact, presentBySession, heldCount: held.size }
}
