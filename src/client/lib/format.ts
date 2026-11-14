// Formaty polskie: daty dd.mm.rrrr, godziny HH:mm.
import { pl } from '../i18n/pl'
import { weekday } from '@shared/dates'

const pad = (n: number) => String(n).padStart(2, '0')

const localYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** „wtorek, 10 listopada 2026” (data RRRR-MM-DD). */
export function longDate(date: string, withYear = true): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${pl.time.weekdays[weekday(date)]}, ${d} ${pl.time.monthsGenitive[m - 1]}${withYear ? ` ${y}` : ''}`
}

/** „pt 13.11” (data RRRR-MM-DD). */
export const shortDay = (date: string): string => `${pl.time.weekdaysShort[weekday(date)]} ${date.slice(8, 10)}.${date.slice(5, 7)}`

/** „Listopad 2026”. */
export function monthTitle(date: string): string {
  const name = pl.time.months[Number(date.slice(5, 7)) - 1]!
  return `${name[0]!.toUpperCase()}${name.slice(1)} ${date.slice(0, 4)}`
}

export const capitalize =(s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/** Czas względny: „przed chwilą”, „2 godz. temu”, „wczoraj, 20:15”, „8 listopada”. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const dt = new Date(iso)
  const mins = Math.floor((now.getTime() - dt.getTime()) / 60_000)
  const time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  if (mins < 1) return pl.time.justNow
  if (mins < 60) return pl.time.minutesAgo(mins)
  if (localYmd(dt) === localYmd(now)) return pl.time.hoursAgo(Math.floor(mins / 60))
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (localYmd(dt) === localYmd(yesterday)) return pl.time.yesterday(time)
  if (dt.getFullYear() === now.getFullYear()) return `${dt.getDate()} ${pl.time.monthsGenitive[dt.getMonth()]}`
  return formatDate(iso)
}

/** Data z ISO (UTC) lub RRRR-MM-DD → dd.mm.rrrr (czas lokalny). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-')
    return `${d}.${m}.${y}`
  }
  const dt = new Date(value)
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const dt = new Date(iso)
  return `${formatDate(iso)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

/** Dzisiejsza data lokalna jako RRRR-MM-DD. */
export function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Wartość dla <input type="datetime-local"> z bieżącej chwili. */
export function nowLocalInput(): string {
  const d = new Date()
  return `${todayYmd()}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const timeRange = (a: string | null, b: string | null): string => (a ? (b ? `${a}–${b}` : a) : '')

export const dateRange = (a: string | null, b: string | null): string =>
  a ? (b && b !== a ? `${formatDate(a)} – ${formatDate(b)}` : formatDate(a)) : ''
