import { describe, expect, it } from 'vitest'
import { buildIcs, escapeText, foldLine } from './ics'

const now = new Date('2026-11-10T09:30:00.000Z')

describe('eksport .ics', () => {
  it('escapowanie przecinka, średnika, ukośnika i nowej linii', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })

  it('zawijanie linii do 75 oktetów bez dzielenia polskich znaków', () => {
    const line = 'SUMMARY:' + 'Zażółć gęślą jaźń '.repeat(10)
    const folded = foldLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true)
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line)
    expect(foldLine('KRÓTKA')).toBe('KRÓTKA')
  })

  const ics = buildIcs(
    [
      { id: 'sesja-1', summary: 'Pierwsza pomoc, zajęcia 3 z 3', location: 'Świetlica; sala 2', description: 'Uczestnicy: 8', date: '2026-11-13', startTime: '17:00', endTime: '20:00' },
      { id: 'sesja-2', summary: 'Bez końca', date: '2026-11-14', startTime: '23:30' },
      { id: 'zadanie-1', summary: 'Plakat festynu', date: '2026-11-12' },
      { id: 'festyn', summary: 'Festyn', date: '2026-11-28', endDate: '2026-11-29' }
    ],
    { calendarName: 'Stowarzyszenie Przykładowe', now }
  )
  const lines = ics.split('\r\n')

  it('CRLF, nagłówki i strefa czasu', () => {
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/)
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('TZID:Europe/Warsaw')
    expect(lines).toContain('DTSTAMP:20261110T093000Z')
  })

  it('stałe UID z id rekordu', () => {
    expect(lines).toContain('UID:sesja-1@ngo-crm')
    expect(lines).toContain('UID:zadanie-1@ngo-crm')
    // ten sam wynik przy ponownym eksporcie
    expect(buildIcs([{ id: 'sesja-1', summary: 'x', date: '2026-11-13' }], { calendarName: 'x', now })).toContain('UID:sesja-1@ngo-crm')
  })

  it('godziny w strefie Europe/Warsaw; brak końca = +1 godz.', () => {
    expect(lines).toContain('DTSTART;TZID=Europe/Warsaw:20261113T170000')
    expect(lines).toContain('DTEND;TZID=Europe/Warsaw:20261113T200000')
    expect(lines).toContain('DTEND;TZID=Europe/Warsaw:20261115T003000')
    expect(lines).toContain('LOCATION:Świetlica\\; sala 2')
  })

  it('zadania i wpisy bez godziny jako całodniowe', () => {
    expect(lines).toContain('DTSTART;VALUE=DATE:20261112')
    expect(lines).toContain('DTEND;VALUE=DATE:20261113')
    // wielodniowy: koniec to dzień po ostatnim dniu
    expect(lines).toContain('DTSTART;VALUE=DATE:20261128')
    expect(lines).toContain('DTEND;VALUE=DATE:20261130')
  })
})
