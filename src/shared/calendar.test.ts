import { describe, expect, it } from 'vitest'
import { easterSunday, holidayOn, polishHolidays } from './holidays'
import { addDays, monthGrid, startOfWeek, weekday } from './dates'
import { buildCalendar, type CalActionRow, type CalSessionRow, type CalTaskRow, type CalendarInput } from './calendar'

describe('święta ustawowe', () => {
  it('Wielkanoc 2025–2027', () => {
    expect(easterSunday(2025)).toBe('2025-04-20')
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
  })

  it('święta ruchome 2025–2027', () => {
    const expected: Record<number, Record<string, string>> = {
      2025: { easterMonday: '2025-04-21', pentecost: '2025-06-08', corpusChristi: '2025-06-19' },
      2026: { easterMonday: '2026-04-06', pentecost: '2026-05-24', corpusChristi: '2026-06-04' },
      2027: { easterMonday: '2027-03-29', pentecost: '2027-05-16', corpusChristi: '2027-05-27' }
    }
    for (const [year, days] of Object.entries(expected)) {
      const h = polishHolidays(Number(year))
      for (const [id, date] of Object.entries(days)) expect(h.get(date)).toBe(id)
    }
  })

  it('święta stałe i liczba dni wolnych', () => {
    expect(holidayOn('2026-11-11')).toBe('independenceDay')
    expect(holidayOn('2026-05-03')).toBe('constitutionDay')
    expect(holidayOn('2026-11-12')).toBeNull()
    expect(polishHolidays(2026).size).toBe(14)
  })

  it('Wigilia wolna od 2025', () => {
    expect(holidayOn('2024-12-24')).toBeNull()
    expect(holidayOn('2025-12-24')).toBe('christmasEve')
    expect(holidayOn('2027-12-24')).toBe('christmasEve')
    expect(polishHolidays(2024).size).toBe(13)
  })
})

describe('daty: tydzień od poniedziałku', () => {
  it('granice tygodnia', () => {
    expect(weekday('2026-11-09')).toBe(0) // poniedziałek
    expect(weekday('2026-11-15')).toBe(6) // niedziela
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09')
    expect(startOfWeek('2026-11-16')).toBe('2026-11-16')
    expect(startOfWeek('2026-01-01')).toBe('2025-12-29') // przez granicę roku
  })

  it('siatka miesiąca: pełne tygodnie od poniedziałku', () => {
    const nov = monthGrid('2026-11-10') // 1.11.2026 to niedziela → 6 tygodni
    expect(nov).toHaveLength(42)
    expect(nov[0]).toBe('2026-10-26')
    expect(nov[41]).toBe('2026-12-06')
    const feb = monthGrid('2027-02-01') // luty 2027 zaczyna się w poniedziałek → 4 tygodnie
    expect(feb).toHaveLength(28)
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30') // zmiana czasu nie przesuwa dat
  })
})

const action = (p: Partial<CalActionRow> & { id: string }): CalActionRow => ({
  title: p.id,
  type: 'training',
  status: 'planned',
  startDate: null,
  endDate: null,
  place: null,
  deletedAt: null,
  ...p
})
const session = (p: Partial<CalSessionRow> & { id: string; actionId: string; date: string }): CalSessionRow => ({
  startTime: null,
  endTime: null,
  deletedAt: null,
  ...p
})
const task = (p: Partial<CalTaskRow> & { id: string }): CalTaskRow => ({
  title: p.id,
  dueDate: null,
  status: 'todo',
  priority: 'normal',
  deletedAt: null,
  assigneeName: null,
  itemsDone: 0,
  itemsTotal: 0,
  ...p
})

describe('wpisy kalendarza', () => {
  const input: CalendarInput = {
    today: '2026-11-10',
    participantCounts: new Map([['kurs', 8]]),
    actions: [
      action({ id: 'kurs', title: 'Pierwsza pomoc', place: 'Świetlica', startDate: '2026-10-27', endDate: '2026-11-13' }),
      action({ id: 'zebranie', type: 'meeting', startDate: '2026-11-17' }),
      action({ id: 'festyn', type: 'event', startDate: '2026-11-28', endDate: '2026-11-29' }),
      action({ id: 'zbiorka', type: 'fundraiser', startDate: '2026-10-16', endDate: '2026-11-25' }),
      action({ id: 'odwolane', type: 'event', status: 'cancelled', startDate: '2026-11-20' }),
      action({ id: 'usuniete', type: 'event', startDate: '2026-11-21', deletedAt: '2026-11-01T10:00:00.000Z' })
    ],
    sessions: [
      session({ id: 's3', actionId: 'kurs', date: '2026-11-13', startTime: '17:00', endTime: '20:00' }),
      session({ id: 's1', actionId: 'kurs', date: '2026-10-27', startTime: '17:00' }),
      session({ id: 's2', actionId: 'kurs', date: '2026-11-03', startTime: '17:00' }),
      session({ id: 'sx', actionId: 'kurs', date: '2026-11-05', deletedAt: '2026-11-02T10:00:00.000Z' }),
      session({ id: 'so', actionId: 'odwolane', date: '2026-11-20' })
    ],
    tasks: [
      task({ id: 'zalegle', dueDate: '2026-11-05' }),
      task({ id: 'zrobione', dueDate: '2026-11-06', status: 'done' }),
      task({ id: 'dzis', dueDate: '2026-11-10', itemsDone: 1, itemsTotal: 3 }),
      task({ id: 'bez-terminu' }),
      task({ id: 'usuniete-zad', dueDate: '2026-11-11', deletedAt: '2026-11-02T10:00:00.000Z' })
    ]
  }
  const { entries, ongoing } = buildCalendar(input, '2026-11-01', '2026-11-30')
  const keys = entries.map((e) => e.key)

  it('zajęcia z numerem „n z m”, bez usuniętych zajęć', () => {
    const s3 = entries.find((e) => e.key === 'session:s3')!
    expect(s3).toMatchObject({ sessionNo: 3, sessionTotal: 3, startTime: '17:00', endTime: '20:00', place: 'Świetlica', participantCount: 8, category: 'sessions' })
    expect(entries.find((e) => e.key === 'session:s2')!.sessionNo).toBe(2)
    expect(keys).not.toContain('session:s1') // poza zakresem
    expect(keys).not.toContain('session:sx')
    // działanie z zajęciami nie ma osobnego wpisu rozpoczęcia
    expect(keys).not.toContain('action:kurs:start')
  })

  it('działania bez zajęć: dzień rozpoczęcia i zakończenia', () => {
    expect(entries.find((e) => e.key === 'action:zebranie:start')).toMatchObject({ date: '2026-11-17', category: 'meetings' })
    expect(entries.find((e) => e.key === 'action:festyn:start')).toMatchObject({ date: '2026-11-28', category: 'events' })
    expect(entries.find((e) => e.key === 'action:festyn:end')).toMatchObject({ date: '2026-11-29' })
  })

  it('koniec zbiórki i działania wielodniowe w panelu „trwa”', () => {
    expect(entries.find((e) => e.key === 'action:zbiorka:fundraiserEnd')).toMatchObject({ date: '2026-11-25', category: 'fundraisers' })
    expect(keys).not.toContain('action:zbiorka:end')
    expect(ongoing.map((o) => o.actionId)).toEqual(['zbiorka', 'kurs', 'festyn'])
  })

  it('pomija odwołane i usunięte', () => {
    expect(keys.some((k) => k.includes('odwolane') || k === 'session:so')).toBe(false)
    expect(keys.some((k) => k.includes('usuniete'))).toBe(false)
  })

  it('terminy zadań: zaległe, zrobione, na dziś', () => {
    expect(entries.find((e) => e.key === 'task:zalegle')).toMatchObject({ overdue: true, category: 'overdue' })
    expect(entries.find((e) => e.key === 'task:zrobione')).toMatchObject({ overdue: false, taskDone: true, category: 'tasks' })
    expect(entries.find((e) => e.key === 'task:dzis')).toMatchObject({ overdue: false, itemsDone: 1, itemsTotal: 3 })
    expect(keys).not.toContain('task:bez-terminu')
  })

  it('posortowane po dacie i godzinie', () => {
    const dates = entries.map((e) => e.date)
    expect(dates).toEqual([...dates].sort())
  })
})
