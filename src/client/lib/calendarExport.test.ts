import { describe, expect, it } from 'vitest'
import { buildCalendar } from '@shared/calendar'
import { buildIcs } from '@shared/ics'
import { toIcsEvents } from './calendarExport'

// Dane fikcyjne.
const { entries } = buildCalendar(
  {
    today: '2026-11-10',
    participantCounts: new Map([['kurs', 8]]),
    actions: [
      { id: 'kurs', title: 'Pierwsza pomoc', type: 'training', status: 'ongoing', startDate: '2026-11-03', endDate: '2026-11-13', place: 'Świetlica', deletedAt: null },
      { id: 'zbiorka', title: 'Zbiórka na wyprawki', type: 'fundraiser', status: 'ongoing', startDate: '2026-10-16', endDate: '2026-11-25', place: null, deletedAt: null }
    ],
    sessions: [
      { id: 'sesja-2', actionId: 'kurs', date: '2026-10-30', startTime: '17:00', endTime: '20:00', deletedAt: null },
      { id: 'sesja-3', actionId: 'kurs', date: '2026-11-13', startTime: '17:00', endTime: '20:00', deletedAt: null }
    ],
    tasks: [{ id: 'zad-1', title: 'Plakat festynu', dueDate: '2026-11-12', status: 'todo', priority: 'normal', deletedAt: null, assigneeName: 'Tomasz Pomocny', itemsDone: 0, itemsTotal: 0 }]
  },
  '2026-11-01',
  '2026-11-30'
)

describe('eksport kalendarza', () => {
  it('zajęcia, działania i zadania (opcjonalnie)', () => {
    const withTasks = toIcsEvents(entries, true)
    expect(withTasks.map((e) => e.id).sort()).toEqual(['sesja-3', 'zad-1', 'zbiorka'])
    expect(toIcsEvents(entries, false).map((e) => e.id)).not.toContain('zad-1')
    expect(withTasks.find((e) => e.id === 'sesja-3')).toMatchObject({ summary: 'Pierwsza pomoc — zajęcia 2 z 2', description: 'Uczestnicy: 8', startTime: '17:00' })
    // zbiórka: jeden wpis na cały czas trwania
    expect(withTasks.find((e) => e.id === 'zbiorka')).toMatchObject({ date: '2026-10-16', endDate: '2026-11-25' })
  })

  it('bez danych osobowych w pliku', () => {
    const ics = buildIcs(toIcsEvents(entries, true), { calendarName: 'Test', now: new Date() })
    expect(ics).not.toContain('Tomasz')
    expect(ics).toContain('SUMMARY:Zadanie: Plakat festynu')
  })
})
