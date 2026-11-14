import { describe, expect, it } from 'vitest'
import { parsePasteList } from './pasteList'
import { computeAttendanceStats } from './attendanceStats'
import { findStale } from './stale'
import { toCsv } from './csv'
import { isPossibleDuplicate, matchesQuery } from './text'

describe('parsePasteList', () => {
  it('rozpoznaje „Imię Nazwisko” i wersję z e-mailem i telefonem', () => {
    const rows = parsePasteList('Anna Kowalska\n\n  Jan Maria Nowak-Wiśniewski ; jan@example.org ; 600 100 200\r\nOla Zięba;500100200')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ line: 1, firstName: 'Anna', lastName: 'Kowalska', email: null, phone: null, error: null })
    expect(rows[1]).toMatchObject({ line: 3, firstName: 'Jan', lastName: 'Maria Nowak-Wiśniewski', email: 'jan@example.org', phone: '600 100 200' })
    expect(rows[2]).toMatchObject({ firstName: 'Ola', lastName: 'Zięba', email: null, phone: '500100200' })
  })

  it('kolejność telefonu i e-maila nie ma znaczenia, tabulator z Excela działa', () => {
    const [row] = parsePasteList('Ewa Lis\t500 600 700\tewa@example.org')
    expect(row).toMatchObject({ firstName: 'Ewa', lastName: 'Lis', email: 'ewa@example.org', phone: '500 600 700' })
  })

  it('samo imię to błąd linii', () => {
    expect(parsePasteList('Anna')[0]!.error).toBe('NAME_INCOMPLETE')
  })
})

describe('computeAttendanceStats', () => {
  const sessions = [
    { id: 's1', date: '2026-11-01' },
    { id: 's2', date: '2026-11-05' },
    { id: 's3', date: '2026-12-01' } // przyszłe
  ]
  it('liczy procent względem odbytych zajęć i obecnych na każdych zajęciach', () => {
    const marks = [
      { sessionId: 's1', contactId: 'a', status: 'present' as const },
      { sessionId: 's2', contactId: 'a', status: 'present' as const },
      { sessionId: 's1', contactId: 'b', status: 'present' as const },
      { sessionId: 's2', contactId: 'b', status: 'excused' as const },
      { sessionId: 's1', contactId: 'c', status: 'absent' as const }
    ]
    const s = computeAttendanceStats(sessions, ['a', 'b', 'c', 'd'], marks, '2026-11-10')
    expect(s.heldCount).toBe(2)
    expect(s.byContact).toEqual({ a: 100, b: 50, c: 0, d: 0 })
    expect(s.presentBySession).toEqual({ s1: 2, s2: 1, s3: 0 })
  })

  it('bez odbytych zajęć procent jest pusty', () => {
    expect(computeAttendanceStats(sessions, ['a'], [], '2026-10-01').byContact).toEqual({ a: null })
  })
})

describe('findStale (staleDays = 30)', () => {
  const now = new Date('2026-11-10T12:00:00.000Z')
  const daysAgo = (d: number, extraMs = 0) => new Date(now.getTime() - d * 86_400_000 - extraMs).toISOString()

  it('dokładnie 30 dni temu: jeszcze nie zamarły; 31 dni: zamarły', () => {
    const res = findStale(
      [
        { contactId: 'exact', joinedAt: daysAgo(100), touches: [daysAgo(30)] },
        { contactId: 'over', joinedAt: daysAgo(100), touches: [daysAgo(31)] }
      ],
      30,
      now
    )
    expect(res.map((r) => r.contactId)).toEqual(['over'])
  })

  it('brak aktywności w ogóle: liczy się od dodania do działania', () => {
    const res = findStale(
      [
        { contactId: 'new', joinedAt: daysAgo(3), touches: [] },
        { contactId: 'old', joinedAt: daysAgo(45), touches: [] }
      ],
      30,
      now
    )
    expect(res).toEqual([{ contactId: 'old', lastTouch: null, days: 45 }])
  })

  it('obecność liczy się jak aktywność (data zajęć RRRR-MM-DD)', () => {
    const res = findStale([{ contactId: 'a', joinedAt: daysAgo(90), touches: [daysAgo(60), '2026-11-02'] }], 30, now)
    expect(res).toEqual([])
  })
})

describe('toCsv', () => {
  it('separator ;, cudzysłowy przy znakach specjalnych, polskie znaki bez zmian', () => {
    expect(toCsv(['Imię', 'Uwagi'], [['Zażółć', 'a;b'], ['Jan', 'cytat "x"'], ['Ola', null]])).toBe(
      'Imię;Uwagi\r\nZażółć;"a;b"\r\nJan;"cytat ""x"""\r\nOla;'
    )
  })
})

describe('duplikaty i wyszukiwanie', () => {
  it('to samo imię i nazwisko (bez względu na wielkość liter), e-mail lub telefon', () => {
    expect(isPossibleDuplicate({ firstName: 'Anna', lastName: 'Kowalska' }, { firstName: 'anna ', lastName: 'KOWALSKA' })).toBe(true)
    expect(isPossibleDuplicate({ email: 'A@x.pl' }, { email: 'a@x.pl' })).toBe(true)
    expect(isPossibleDuplicate({ phone: '+48 600-100-200' }, { phone: '600100200' })).toBe(true)
    expect(isPossibleDuplicate({ firstName: 'Anna', lastName: 'Kowalska' }, { firstName: 'Anna', lastName: 'Nowak' })).toBe(false)
  })

  it('wyszukiwanie po polsku, wszystkie słowa', () => {
    expect(matchesQuery('żaneta kow', 'Żaneta', 'Kowal')).toBe(true)
    expect(matchesQuery('żaneta nowak', 'Żaneta', 'Kowal')).toBe(false)
  })
})
