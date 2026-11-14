// Szczegóły działania (przeniesione z desktopu): nagłówek, pasek podsumowań, zakładki Informacje / Uczestnicy /
// Zajęcia i obecność / Historia. Bez zakładek działań v2 (przygotowanie, budżet, ewaluacja, pliki — ZADANIE_05, D1).
// Każdy zapis odsyła `version`; lista obecności drukuje się z przeglądarki.
import { useState, type ReactNode } from 'react'
import { BookOpen, CalendarDays, ClipboardPaste, MapPin, Pencil, Plus, Printer, Trash2, UserPlus, X } from 'lucide-react'
import { PARTICIPANT_STATUSES, type AttendanceStatus, type ParticipantStatus } from '@shared/domain'
import type { ActionDetail, ContactListItem } from '@shared/types'
import { useApp } from '../../app/context'
import { ActionStatusChip, ActionTypeChip } from '../../components/chips'
import { ContactPicker } from '../../components/ContactPicker'
import { Timeline } from '../../components/Timeline'
import { Alert, Avatar, Badge, Button, Card, Dialog, Empty, ErrorText, Field, Input, Select, Table, Tabs } from '../../components/ui'
import { pl } from '../../i18n/pl'
import { call, errorMessage, useLoad } from '../../lib/api'
import { cn } from '../../lib/cn'
import { dateRange, formatDate, timeRange } from '../../lib/format'
import { ActionForm } from './ActionForm'
import { AttendanceSheet } from './AttendanceSheet'
import { PasteDialog } from './PasteDialog'

type Tab = 'info' | 'participants' | 'sessions' | 'history'

/** Szerokość paska postępu jako klasa (CSP blokuje atrybut style), w krokach co 10%. */
const BAR_WIDTH = ['w-0', 'w-[10%]', 'w-[20%]', 'w-[30%]', 'w-[40%]', 'w-[50%]', 'w-[60%]', 'w-[70%]', 'w-[80%]', 'w-[90%]', 'w-full'] as const
const barWidth = (pct: number | null) => BAR_WIDTH[Math.round(Math.min(100, Math.max(0, pct ?? 0)) / 10)]!

function Stat({ label, value, sub, pct, bar, onClick }: { label: string; value: string; sub: string; pct: number | null; bar: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="cursor-pointer rounded-xl border border-border bg-background px-4 py-3.5 text-left shadow-card hover:bg-subtle">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <span className="mt-1 block text-xl font-bold">{value}</span>
      <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <span className={cn('block h-full', bar, barWidth(pct))} />
      </span>
      <span className="mt-1.5 block text-xs text-muted-foreground">{sub}</span>
    </button>
  )
}

/** Pasek podsumowań: uczestnicy, frekwencja, liczba zajęć. */
function ActionStats({ data, onTab }: { data: ActionDetail; onTab: (t: Tab) => void }) {
  const a = data.action
  const active = data.participants.filter((p) => p.status !== 'resigned')
  const pcts = active.map((p) => p.attendancePct).filter((x): x is number => x !== null)
  const attendance = pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length) : null
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
      <Stat
        label={pl.actions.participantsCount}
        value={a.expectedParticipants ? `${active.length} / ${a.expectedParticipants}` : String(active.length)}
        sub={a.expectedParticipants ? pl.actions.statPlanned : pl.actions.statRegistered}
        pct={a.expectedParticipants ? (active.length / a.expectedParticipants) * 100 : null}
        bar="bg-info"
        onClick={() => onTab('participants')}
      />
      <Stat
        label={pl.actions.attendancePct}
        value={attendance === null ? pl.common.none : `${attendance}%`}
        sub={pl.actions.statHeld(data.heldCount)}
        pct={attendance}
        bar="bg-primary"
        onClick={() => onTab('sessions')}
      />
      <Stat
        label={pl.actions.sessionsCount}
        value={String(data.sessions.length)}
        sub={pl.actions.statSessions}
        pct={data.sessions.length ? (data.heldCount / data.sessions.length) * 100 : null}
        bar="bg-violet-strong"
        onClick={() => onTab('sessions')}
      />
    </div>
  )
}

export function ActionDetailView({ id }: { id: string }) {
  const { back, go, canWrite, session } = useApp()
  const { data, error, reload } = useLoad('actions.get', { id })
  const [tab, setTab] = useState<Tab>('info')
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')

  if (error) return <ErrorText>{error}</ErrorText>
  if (!data) return null
  const a = data.action
  const editable = canWrite && !a.deletedAt

  const remove = async () => {
    if (!confirm(pl.common.confirmDelete)) return
    try {
      await call('actions.delete', { id, version: a.version })
      back()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  const active = data.participants.filter((p) => p.status !== 'resigned')
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'info', label: pl.actions.tabs.info },
    { id: 'participants', label: pl.actions.tabs.participants, badge: active.length },
    { id: 'sessions', label: pl.actions.tabs.sessions, badge: data.sessions.length },
    { id: 'history', label: pl.actions.tabs.history }
  ]

  return (
    <>
      <div className="flex flex-col gap-5 print:hidden">
        <nav aria-label={pl.actions.breadcrumb} className="text-[13px] text-muted-foreground">
          <button type="button" className="cursor-pointer font-medium text-primary hover:text-primary-hover hover:underline" onClick={() => go({ name: 'actions' })}>
            {pl.actions.title}
          </button>
          {' / '}
          {a.title}
        </nav>

        <section className="flex flex-col gap-4 rounded-card border border-border bg-background px-6 py-5.5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2.5 flex flex-wrap gap-2">
                <ActionTypeChip type={a.type} />
                <ActionStatusChip status={a.status} />
                <Badge>{pl.frameworks[a.framework]}</Badge>
                {a.deletedAt && <Badge tone="danger">{pl.common.deletedSuffix}</Badge>}
              </div>
              <h1 className="text-2xl font-bold tracking-tight">{a.title}</h1>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer size={15} /> {pl.actions.printAttendance}
                </Button>
                {editable && (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Pencil size={15} /> {pl.common.edit}
                  </Button>
                )}
              </div>
              {editable && (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove()}>
                  <Trash2 size={14} /> {pl.actions.deleteAction}
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5.5 gap-y-2 text-[13px] text-secondary-foreground">
            {a.startDate && (
              <span className="flex items-center gap-1.5">
                <CalendarDays size={16} className="text-muted-foreground" aria-hidden="true" /> {dateRange(a.startDate, a.endDate)}
              </span>
            )}
            {a.place && (
              <span className="flex items-center gap-1.5">
                <MapPin size={16} className="text-muted-foreground" aria-hidden="true" /> {a.place}
              </span>
            )}
            {data.topic && (
              <span className="flex items-center gap-1.5">
                <BookOpen size={16} className="text-muted-foreground" aria-hidden="true" /> {pl.actions.topicLine(data.topic.name, data.topic.durationHours)}
              </span>
            )}
          </div>
        </section>
        <ErrorText>{actionError}</ErrorText>

        <ActionStats data={data} onTab={setTab} />

        <Tabs tabs={tabs} value={tab} onChange={setTab} label={pl.actions.sections} />
        {message && <Alert tone="info">{message}</Alert>}

        {tab === 'info' && (
          <Card>
            <dl className="grid grid-cols-[14rem_1fr] gap-x-3 gap-y-2 text-sm">
              <Info label={pl.actions.type}>{pl.actionTypes[a.type]}</Info>
              <Info label={pl.actions.framework}>{pl.frameworks[a.framework]}</Info>
              <Info label={pl.actions.status}>{pl.actionStatuses[a.status]}</Info>
              {a.type === 'training' && <Info label={pl.actions.topic}>{data.topic?.name}</Info>}
              <Info label={pl.common.date}>{dateRange(a.startDate, a.endDate)}</Info>
              <Info label={pl.actions.place}>{a.place}</Info>
              <Info label={pl.actions.expected}>{a.expectedParticipants?.toString()}</Info>
              <Info label={pl.actions.description}>{a.description && <span className="whitespace-pre-wrap">{a.description}</span>}</Info>
            </dl>
          </Card>
        )}
        {tab === 'participants' && <ParticipantsTab data={data} editable={editable} onChange={reload} onMessage={setMessage} />}
        {tab === 'sessions' && <SessionsTab data={data} editable={editable} onChange={reload} />}
        {tab === 'history' && <Timeline activities={data.activities} contactIds={[]} actionId={id} editable={editable} onChange={reload} showContacts />}

        {editing && <ActionForm action={a} onClose={() => setEditing(false)} onSaved={reload} />}
      </div>
      <AttendanceSheet detail={data} orgName={session.settings.orgName} />
    </>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children || pl.common.none}</dd>
    </>
  )
}

function ParticipantsTab({ data, editable, onChange, onMessage }: { data: ActionDetail; editable: boolean; onChange: () => void; onMessage: (m: string) => void }) {
  const { go } = useApp()
  const [adding, setAdding] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [error, setError] = useState('')
  const actionId = data.action.id

  const run = (fn: () => Promise<unknown>) => {
    setError('')
    fn()
      .then(onChange)
      .catch((e: unknown) => setError(errorMessage(e)))
  }
  const add = (c: ContactListItem) => run(() => call('participants.add', { actionId, contactId: c.id }))

  return (
    <Card
      title={pl.actions.tabs.participants}
      actions={
        editable && (
          <>
            <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
              <UserPlus size={13} /> {pl.actions.addFromBase}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPasting(true)}>
              <ClipboardPaste size={13} /> {pl.actions.pasteList}
            </Button>
          </>
        )
      }
    >
      {adding && (
        <div className="mb-3">
          <ContactPicker kind="person" exclude={data.participants.map((p) => p.contactId)} onPick={add} />
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {data.participants.length === 0 ? (
        <Empty>{pl.actions.noParticipants}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className="w-10">{pl.print.lp}</th>
              <th>{pl.print.name}</th>
              <th>{pl.actions.participantStatus}</th>
              <th className="text-right">{pl.actions.attendancePct}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {data.participants.map((p, i) => (
              <tr key={p.id} className="group">
                <td className="text-muted-foreground">{i + 1}</td>
                <td>
                  <button
                    type="button"
                    className={cn('inline-flex cursor-pointer items-center gap-2.5 font-semibold hover:text-primary', p.contact.deleted && 'text-muted-foreground')}
                    onClick={() => go({ name: 'contact', id: p.contactId })}
                  >
                    <Avatar id={p.contactId} name={p.contact.label || pl.contacts.anonymized} size={28} />
                    {p.contact.label || pl.contacts.anonymized}
                  </button>
                  {p.contact.deleted && <span className="ml-1 text-xs text-muted-foreground">{pl.common.deletedSuffix}</span>}
                </td>
                <td>
                  <Select
                    className="h-8 w-40"
                    aria-label={pl.actions.participantStatus}
                    disabled={!editable}
                    value={p.status}
                    onChange={(e) => run(() => call('participants.setStatus', { id: p.id, version: p.version, status: e.target.value as ParticipantStatus }))}
                  >
                    {PARTICIPANT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {pl.participantStatuses[s]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="text-right">{p.attendancePct === null ? pl.common.none : `${p.attendancePct}%`}</td>
                <td>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      title={pl.actions.removeParticipant}
                      aria-label={pl.actions.removeParticipant}
                      onClick={() => confirm(pl.common.confirmDelete) && run(() => call('participants.remove', { id: p.id, version: p.version }))}
                    >
                      <X size={12} />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {pasting && (
        <PasteDialog
          actionId={actionId}
          onClose={() => setPasting(false)}
          onDone={(msg) => {
            onMessage(msg)
            onChange()
          }}
        />
      )}
    </Card>
  )
}

const NEXT: Record<AttendanceStatus | 'none', AttendanceStatus | null> = { none: 'present', present: 'absent', absent: 'excused', excused: null }
// kolory z makiety (Szkolenie, zakładka Obecność)
const CELL: Record<AttendanceStatus, string> = {
  present: 'bg-att-present text-white',
  absent: 'bg-att-absent text-white',
  excused: 'bg-att-excused text-[#2B1B00]'
}

function SessionsTab({ data, editable, onChange }: { data: ActionDetail; editable: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ date: '', startTime: '', endTime: '', leaderContactId: '', leaderLabel: '' })
  const marks = new Map(data.attendance.map((m) => [`${m.sessionId}|${m.contactId}`, m]))
  const people = data.participants.filter((p) => p.status !== 'resigned')

  const run = (fn: () => Promise<unknown>) => {
    setError('')
    fn()
      .then(onChange)
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const saveSession = async () => {
    setFormError('')
    try {
      await call('sessions.add', {
        actionId: data.action.id,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        leaderContactId: form.leaderContactId || null,
        note: null
      })
      setAdding(false)
      setForm({ date: '', startTime: '', endTime: '', leaderContactId: '', leaderLabel: '' })
      onChange()
    } catch (e) {
      setFormError(errorMessage(e))
    }
  }

  const toggle = (sessionId: string, contactId: string) => {
    const mark = marks.get(`${sessionId}|${contactId}`)
    run(() => call('attendance.set', { sessionId, contactId, status: NEXT[mark?.status ?? 'none'], version: mark?.version ?? null }))
  }

  return (
    <Card
      title={pl.actions.tabs.sessions}
      actions={
        editable && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={13} /> {pl.actions.addSession}
          </Button>
        )
      }
    >
      <ErrorText>{error}</ErrorText>
      {data.sessions.length === 0 ? (
        <Empty>{pl.actions.noSessions}</Empty>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {editable && pl.actions.gridHint} {pl.actions.heldInfo(data.heldCount)}
            </p>
            <div className="flex gap-3 text-xs text-secondary-foreground">
              {(['present', 'absent', 'excused'] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={cn('h-3 w-3 rounded', CELL[s])} />
                  {pl.attendanceStatuses[s]}
                </span>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table className="w-auto">
              <thead>
                <tr>
                  <th className="min-w-56">{pl.print.name}</th>
                  {data.sessions.map((s) => (
                    <th key={s.id} className="group min-w-28 text-center">
                      <div className="font-semibold text-foreground">{formatDate(s.date)}</div>
                      <div className="text-xs font-normal">{timeRange(s.startTime, s.endTime)}</div>
                      {s.leader && <div className="text-xs font-normal">{s.leader.label}</div>}
                      <div className="text-xs font-normal text-primary">{pl.actions.presentCount(s.presentCount)}</div>
                      {editable && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          title={pl.actions.deleteSession}
                          aria-label={pl.actions.deleteSession}
                          onClick={() => confirm(pl.common.confirmDelete) && run(() => call('sessions.delete', { id: s.id, version: s.version }))}
                        >
                          <X size={11} />
                        </Button>
                      )}
                    </th>
                  ))}
                  <th className="text-right">{pl.actions.attendancePct}</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td className="font-semibold">
                      <span className="flex items-center gap-2.5">
                        <Avatar id={p.contactId} name={p.contact.label || pl.contacts.anonymized} size={28} />
                        {p.contact.label || pl.contacts.anonymized}
                        {p.contact.deleted && <span className="text-xs font-normal text-muted-foreground">{pl.common.deletedSuffix}</span>}
                      </span>
                    </td>
                    {data.sessions.map((s) => {
                      const st = marks.get(`${s.id}|${p.contactId}`)?.status
                      return (
                        <td key={s.id} className="text-center">
                          <button
                            type="button"
                            disabled={!editable}
                            title={st ? pl.attendanceStatuses[st] : pl.actions.notMarked}
                            aria-label={`${p.contact.label}, ${formatDate(s.date)}: ${st ? pl.attendanceStatuses[st] : pl.actions.notMarked}`}
                            onClick={() => toggle(s.id, p.contactId)}
                            className={cn('h-7 w-8.5 rounded-lg text-xs font-bold enabled:cursor-pointer', st ? CELL[st] : 'border border-dashed border-[#C9D1DE] enabled:hover:bg-muted')}
                          >
                            {st ? pl.attendanceShort[st] : ''}
                          </button>
                        </td>
                      )
                    })}
                    <td className="text-right font-semibold">{p.attendancePct === null ? pl.common.none : `${p.attendancePct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={pl.actions.addSession}
        footer={
          <Button disabled={!form.date} onClick={() => void saveSession()}>
            {pl.common.save}
          </Button>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label={pl.actions.sessionDate}>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label={pl.actions.startTime}>
            <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          </Field>
          <Field label={pl.actions.endTime}>
            <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          </Field>
          <Field label={pl.actions.leader} className="col-span-3">
            {form.leaderContactId ? (
              <div className="flex items-center gap-2 text-sm font-medium">
                {form.leaderLabel}
                <Button variant="link" size="sm" onClick={() => setForm({ ...form, leaderContactId: '', leaderLabel: '' })}>
                  {pl.common.clear}
                </Button>
              </div>
            ) : (
              <ContactPicker kind="person" onPick={(c) => setForm({ ...form, leaderContactId: c.id, leaderLabel: c.label })} />
            )}
          </Field>
          <div className="col-span-3">
            <ErrorText>{formError}</ErrorText>
          </div>
        </div>
      </Dialog>
    </Card>
  )
}
