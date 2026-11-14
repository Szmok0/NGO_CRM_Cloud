// Operacje na datach kalendarzowych RRRR-MM-DD (bez stref czasowych: liczone w UTC).

const pad = (n: number) => String(n).padStart(2, '0')

export const ymd = (y: number, m: number, d: number): string => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(date: string, days: number): string {
  const dt = parse(date)
  dt.setUTCDate(dt.getUTCDate() + days)
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** Dzień tygodnia: 0 = poniedziałek … 6 = niedziela. */
export const weekday = (date: string): number => (parse(date).getUTCDay() + 6) % 7

/** Poniedziałek tygodnia, w którym jest data. */
export const startOfWeek = (date: string): string => addDays(date, -weekday(date))

export const startOfMonth = (date: string): string => date.slice(0, 8) + '01'

export function addMonths(date: string, months: number): string {
  const dt = parse(startOfMonth(date))
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1 + months, 1)
}

export const endOfMonth = (date: string): string => addDays(addMonths(date, 1), -1)

/** Liczba dni między datami (b − a). */
export const daysBetween = (a: string, b: string): number => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000)

/** Siatka miesiąca od poniedziałku: pełne tygodnie (5 lub 6) obejmujące miesiąc. */
export function monthGrid(date: string): string[] {
  const first = startOfWeek(startOfMonth(date))
  const last = addDays(startOfWeek(endOfMonth(date)), 6)
  const days: string[] = []
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d)
  return days
}

/** Daty od `from` do `to` włącznie. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}
