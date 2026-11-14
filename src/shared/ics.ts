// Eksport kalendarza do pliku .ics (RFC 5545) — import w Google Calendar i Outlooku.
import { addDays } from './dates'

export interface IcsEvent {
  /** Id rekordu; UID = `{id}@ngo-crm`, więc ponowny import aktualizuje zamiast dublować. */
  id: string
  summary: string
  location?: string | null
  description?: string | null
  /** RRRR-MM-DD */
  date: string
  /** Ostatni dzień (włącznie) dla wpisów całodniowych wielodniowych. */
  endDate?: string | null
  /** HH:mm; brak = wpis całodniowy. */
  startTime?: string | null
  endTime?: string | null
}

const TZ = 'Europe/Warsaw'

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZ}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
]

/** Escapowanie tekstu (RFC 5545, 3.3.11). */
export const escapeText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Zawijanie linii do 75 oktetów (UTF-8), bez dzielenia znaków; kontynuacja zaczyna się spacją. */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > limit) {
      parts.push(current)
      current = ''
      bytes = 0
      limit = 74 // spacja na początku linii kontynuacji też się liczy
    }
    current += ch
    bytes += n
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const compactDate = (d: string) => d.replace(/-/g, '')
const localDateTime = (d: string, t: string) => `${compactDate(d)}T${t.replace(':', '')}00`

function addHour(t: string): { time: string; nextDay: boolean } {
  const [h, m] = t.split(':').map(Number) as [number, number]
  const nh = h + 1
  return { time: `${String(nh % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`, nextDay: nh >= 24 }
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function buildIcs(events: IcsEvent[], opts: { calendarName: string; now: Date }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NGO CRM//Kalendarz//PL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
    `X-WR-TIMEZONE:${TZ}`,
    ...VTIMEZONE
  ]
  const stamp = utcStamp(opts.now)
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@ngo-crm`, `DTSTAMP:${stamp}`)
    if (e.startTime) {
      const end = e.endTime && e.endTime > e.startTime ? { time: e.endTime, nextDay: false } : addHour(e.startTime)
      lines.push(`DTSTART;TZID=${TZ}:${localDateTime(e.date, e.startTime)}`)
      lines.push(`DTEND;TZID=${TZ}:${localDateTime(end.nextDay ? addDays(e.date, 1) : e.date, end.time)}`)
    } else {
      // wpis całodniowy: DTEND to dzień po ostatnim dniu
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`)
      lines.push(`DTEND;VALUE=DATE:${compactDate(addDays(e.endDate && e.endDate > e.date ? e.endDate : e.date, 1))}`)
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`)
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
