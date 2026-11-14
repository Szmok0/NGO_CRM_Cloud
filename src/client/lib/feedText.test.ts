import { describe, expect, it } from 'vitest'
import { buildFeed, type ChangeLogRow, type FeedLookup } from '@shared/feed'
import { feedText } from './feedText'
import { relativeTime } from './format'
import { plural } from '../i18n/pl'

// Dane fikcyjne.
const lookup: FeedLookup = {
  userName: (id) => ({ u1: 'Anna Koordynatorka', u2: 'Tomasz Pomocny' })[id],
  contact: (id) => ({ c1: { label: 'Barbara Testowska', kind: 'person' as const }, c2: { label: 'Gminny Ośrodek', kind: 'institution' as const } })[id],
  action: (id) => ({ a1: { title: 'Pierwsza pomoc' }, a2: { title: 'Warsztaty rękodzieła' } })[id],
  task: (id) => ({ t1: { title: 'Plakat festynu' } })[id],
  session: (id) => ({ s2: { actionId: 'a1', no: 2 } })[id],
  attendanceSession: (id) => (id.startsWith('att') ? 's2' : undefined),
  participantAction: (id) => (id.startsWith('p') ? 'a2' : undefined),
  activity: (id) => ({ ac1: { type: 'note' as const, contactId: 'c1' }, sys: { type: 'system' as const, contactId: 'c1' } })[id],
  consent: (id) => ({ cs1: { contactId: 'c1', type: 'image' as const } })[id],
  topic: () => undefined
}

let minute = 0
const row = (entity: string, entityId: string, op: ChangeLogRow['op'], userId = 'u1', changedFields: Record<string, unknown> = {}): ChangeLogRow => ({
  entity,
  entityId,
  op,
  changedFields,
  userId,
  at: new Date(Date.UTC(2026, 10, 10, 8, minute++)).toISOString()
})

describe('„Ostatnio w organizacji”', () => {
  it('zamienia wpisy change_log na zdania', () => {
    const log = [
      row('consents', 'cs1', 'insert'),
      row('tasks', 't1', 'insert', 'u2'),
      row('activities', 'ac1', 'insert'),
      row('contacts', 'c2', 'insert')
    ]
    const feed = buildFeed(log, lookup)
    expect(feed.map((f) => [f.userName, feedText(f)])).toEqual([
      ['Anna Koordynatorka', 'nowa instytucja w bazie: Gminny Ośrodek'],
      ['Anna Koordynatorka', 'notatka: Barbara Testowska'],
      ['Tomasz Pomocny', 'nowe zadanie „Plakat festynu”'],
      ['Anna Koordynatorka', 'zgoda (wizerunek): Barbara Testowska']
    ])
    expect(feed[2]!.target).toEqual({ type: 'task', id: 't1' })
  })

  it('łączy serię zmian tego samego rodzaju w jeden wpis', () => {
    const log = [
      ...Array.from({ length: 8 }, (_, i) => row('attendance', `att${i}`, i % 2 ? 'update' : 'insert')),
      row('action_participants', 'p1', 'insert', 'u2'),
      row('action_participants', 'p2', 'insert', 'u2'),
      row('action_participants', 'p3', 'insert', 'u2')
    ]
    const feed = buildFeed(log, lookup)
    expect(feed).toHaveLength(2)
    expect(feedText(feed[0]!)).toBe('nowi uczestnicy (3) w „Warsztaty rękodzieła”')
    expect(feed[1]!.count).toBe(8)
    expect(feedText(feed[1]!)).toBe('obecność: Pierwsza pomoc, zajęcia 2')
  })

  it('nie łączy zmian różnych osób; status zadania „zrobione”', () => {
    const feed = buildFeed([row('tasks', 't1', 'update', 'u1', { status: 'done' }), row('tasks', 't1', 'update', 'u2', { status: 'done' })], lookup)
    expect(feed.map((f) => f.userName)).toEqual(['Tomasz Pomocny', 'Anna Koordynatorka'])
    expect(feedText(feed[0]!)).toBe('zadanie zrobione: „Plakat festynu”')
  })

  it('zmiana tożsamości (contact_identity) to „zmiana danych” osoby; seria łączy się ze zmianą kontaktu', () => {
    const l = { ...lookup, identityContact: (id: string) => (id === 'i1' ? 'c1' : undefined) }
    const feed = buildFeed([row('contact_identity', 'i1', 'insert'), row('contacts', 'c1', 'update'), row('contact_identity', 'i1', 'update')], l)
    expect(feed.map((f) => [feedText(f), f.count])).toEqual([['zmiana danych: Barbara Testowska', 2]])
  })

  it('pomija ustawienia, użytkowników i wpisy techniczne', () => {
    const log = [
      row('settings', 'x', 'update'),
      row('users', 'u1', 'insert'),
      row('task_items', 'i1', 'insert'),
      row('activity_contacts', 'l1', 'insert'),
      row('contact_roles', 'r1', 'insert'),
      row('activities', 'sys', 'insert')
    ]
    expect(buildFeed(log, lookup)).toEqual([])
  })

  it('najwyżej 8 wpisów', () => {
    const log = Array.from({ length: 12 }, (_, i) => row('contacts', i % 2 ? 'c1' : 'c2', 'update', i % 3 ? 'u1' : 'u2'))
    expect(buildFeed(log, lookup)).toHaveLength(8)
  })
})

describe('czas względny i odmiana', () => {
  const now = new Date(2026, 10, 10, 14, 0)
  it('czas względny', () => {
    expect(relativeTime(new Date(2026, 10, 10, 13, 59, 40).toISOString(), now)).toBe('przed chwilą')
    expect(relativeTime(new Date(2026, 10, 10, 13, 15).toISOString(), now)).toBe('45 min temu')
    expect(relativeTime(new Date(2026, 10, 10, 12, 0).toISOString(), now)).toBe('2 godz. temu')
    expect(relativeTime(new Date(2026, 10, 9, 20, 15).toISOString(), now)).toBe('wczoraj, 20:15')
    expect(relativeTime(new Date(2026, 10, 8, 9, 0).toISOString(), now)).toBe('8 listopada')
    expect(relativeTime(new Date(2025, 0, 8, 9, 0).toISOString(), now)).toBe('08.01.2025')
  })
  it('liczebniki', () => {
    expect([1, 2, 5, 12, 22, 25].map((n) => plural(n, 'zadanie', 'zadania', 'zadań'))).toEqual(['zadanie', 'zadania', 'zadań', 'zadań', 'zadania', 'zadań'])
  })
})
