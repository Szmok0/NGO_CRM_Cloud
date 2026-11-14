// Polskie święta ustawowo wolne od pracy (stałe i ruchome). Nazwy po polsku są w pl.ts.
import { addDays, ymd } from './dates'

export type HolidayId =
  | 'newYear'
  | 'epiphany'
  | 'easter'
  | 'easterMonday'
  | 'labourDay'
  | 'constitutionDay'
  | 'pentecost'
  | 'corpusChristi'
  | 'assumption'
  | 'allSaints'
  | 'independenceDay'
  | 'christmasEve'
  | 'christmas'
  | 'christmasSecond'

/** Niedziela Wielkanocna (algorytm Meeusa/Jonesa/Butchera, kalendarz gregoriański). */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return ymd(year, month, day)
}

/** Święta w roku: data RRRR-MM-DD → id. Wigilia jest dniem wolnym od 2025 r. */
export function polishHolidays(year: number): Map<string, HolidayId> {
  const easter = easterSunday(year)
  const list: [string, HolidayId][] = [
    [ymd(year, 1, 1), 'newYear'],
    [ymd(year, 1, 6), 'epiphany'],
    [easter, 'easter'],
    [addDays(easter, 1), 'easterMonday'],
    [ymd(year, 5, 1), 'labourDay'],
    [ymd(year, 5, 3), 'constitutionDay'],
    [addDays(easter, 49), 'pentecost'],
    [addDays(easter, 60), 'corpusChristi'],
    [ymd(year, 8, 15), 'assumption'],
    [ymd(year, 11, 1), 'allSaints'],
    [ymd(year, 11, 11), 'independenceDay'],
    ...(year >= 2025 ? ([[ymd(year, 12, 24), 'christmasEve']] as [string, HolidayId][]) : []),
    [ymd(year, 12, 25), 'christmas'],
    [ymd(year, 12, 26), 'christmasSecond']
  ]
  return new Map(list)
}

/** Święto w danym dniu albo null. */
export const holidayOn = (date: string): HolidayId | null => polishHolidays(Number(date.slice(0, 4))).get(date) ?? null
