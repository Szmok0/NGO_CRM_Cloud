// Panel „Stan bezpieczeństwa” (ZADANIE_04, D8, D9; tylko administrator): jedna lista spraw, każda z kolorem,
// zdaniem „co to znaczy” i, gdy trzeba, „co zrobić” z przyciskiem do właściwego miejsca w Ustawieniach.
// Serwer zwraca same fakty (`security.status`), zdania składa ten plik z pl.ts.
import { useState } from 'react'
import type { SecurityItem, SecurityStatus, SecurityTone } from '@shared/api'
import { Badge, Button, Card, ErrorText } from '../components/ui'
import { pl } from '../i18n/pl'
import { call, errorMessage, useLoad } from '../lib/api'
import { formatDate } from '../lib/format'

/** Miejsca w Ustawieniach (id sekcji w SettingsScreen), do których prowadzą przyciski „co zrobić”. */
export const SECTION = { backups: 'sekcja-kopie', users: 'sekcja-uzytkownicy', rotate: 'sekcja-klucz' } as const

export const scrollToSection = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

const TONE_BADGE: Record<SecurityTone, 'success' | 'warning' | 'danger' | 'muted'> = { green: 'success', yellow: 'warning', red: 'danger', grey: 'muted' }
const DOT: Record<SecurityTone, string> = { green: 'bg-success', yellow: 'bg-warning', red: 'bg-destructive', grey: 'bg-muted-foreground' }

interface Described {
  text: string
  todo?: string
  go?: { label: string; section: string }
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : '')

/** Zdanie i „co zrobić” dla sprawy: wszystko z pl.security.text, bez własnych słów w kodzie. */
function describe(item: SecurityItem, s: SecurityStatus): Described {
  const t = pl.security.text
  const d = item.data
  const days = (n: number) => pl.security.days(n)
  const go = pl.security.go
  switch (item.id) {
    case 'version': {
      const date = formatDate(s.releasedAt)
      const u = s.update
      if (u.state === 'available') return { text: u.security ? t.versionSecurity(u.latest ?? '', s.version) : t.versionAvailable(u.latest ?? '', s.version, date) }
      if (u.state === 'current') return { text: t.versionCurrent(s.version, date) }
      if (u.state === 'failed') return { text: `${t.versionFailed(s.version, date)} ${pl.security.update.failed}` }
      if (u.state === 'pending') return { text: t.versionPending(s.version, date) }
      return { text: t.versionDisabled(s.version, date) }
    }
    case 'https':
      return item.tone === 'green' ? { text: t.httpsOk } : { text: t.httpsNo, todo: t.httpsTodo }
    case 'storage':
      return item.tone === 'green' ? { text: t.storageOk } : { text: t.storageNo, todo: t.storageTodo }
    case 'backup': {
      const agoDays = d.ageDays === null ? null : num(d.ageDays)
      const ago = agoDays === null ? null : pl.security.ago(agoDays)
      const goBackups = { label: go.backups, section: SECTION.backups }
      if (d.noStorage) return { text: t.backupNoStorage, todo: t.storageTodo }
      if (d.lastFailed) return { text: t.backupFailed(ago), todo: t.backupTodo, go: goBackups }
      if (d.lastAt === null) return { text: t.backupNone, go: goBackups }
      if (item.tone === 'red') return { text: t.backupOld(days(agoDays ?? 0)), todo: t.backupTodo, go: goBackups }
      return { text: t.backupOk(ago ?? '') }
    }
    case 'download': {
      const goBackups = { label: go.backups, section: SECTION.backups }
      if (d.ageDays === null) return { text: t.downloadNone }
      if (item.tone === 'green') return { text: t.downloadOk(formatDate(str(d.lastAt)), pl.security.ago(num(d.ageDays))) }
      if (item.tone === 'yellow') return { text: t.downloadOld(days(num(d.ageDays)), d.lastAt === null), todo: t.downloadTodo, go: goBackups }
      return { text: t.downloadNew, go: goBackups }
    }
    case 'verify': {
      const goBackups = { label: go.backups, section: SECTION.backups }
      if (d.ageDays === null) return { text: t.verifyNone }
      if (item.tone === 'green') return { text: t.verifyOk(formatDate(str(d.lastAt))) }
      if (item.tone === 'yellow') return { text: t.verifyOld(days(num(d.ageDays)), d.lastAt === null), todo: t.verifyTodo, go: goBackups }
      return { text: t.verifyNew, go: goBackups }
    }
    case 'twofa':
      return item.tone === 'green' ? { text: t.twofaOk } : { text: t.twofaNo(list(d.names)), todo: t.twofaTodo, go: { label: go.users, section: SECTION.users } }
    case 'access': {
      if (d.configured === false) return { text: t.accessNone }
      const users = { label: go.users, section: SECTION.users }
      if (item.tone === 'red') return { text: t.accessEmpty, todo: t.accessTodo, go: users }
      if (item.tone === 'yellow') return { text: t.accessNoRecovery(list(d.names)), todo: t.accessTodo, go: users }
      return { text: t.accessOk(list(d.names)) }
    }
    case 'rotation':
      if (item.tone === 'grey') return { text: t.rotationNone }
      return item.tone === 'green' ? { text: t.rotationOk } : { text: t.rotationNo(num(d.sensitive), num(d.attachments)), todo: t.rotationTodo, go: { label: go.rotate, section: SECTION.rotate } }
    case 'retention':
      return { text: t.retention }
  }
}

function Row({ item, status }: { item: SecurityItem; status: SecurityStatus }) {
  const x = describe(item, status)
  const u = status.update
  return (
    <li className="flex gap-3 px-5 py-3.5" data-tone={item.tone} data-item={item.id}>
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[item.tone]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold">{pl.security.titles[item.id]}</h3>
          <Badge tone={TONE_BADGE[item.tone]}>{pl.security.tones[item.tone]}</Badge>
        </div>
        <p className="mt-1 text-sm">{x.text}</p>
        {x.todo && (
          <p className="mt-1 text-sm text-muted-foreground">
            <strong>{pl.security.todo}</strong> {x.todo}
          </p>
        )}
        {item.id === 'version' && u.state === 'available' && (
          <div className="mt-2 text-sm">
            <p className="font-semibold">{pl.security.update.stepsTitle}</p>
            <ol className="ml-5 list-decimal space-y-0.5">
              {pl.security.update.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}
        {item.id === 'version' && u.state === 'available' && u.url && (
          <a className="mt-2 inline-block text-sm font-semibold text-primary underline" href={u.url} target="_blank" rel="noopener noreferrer">
            {pl.security.go.changes}
          </a>
        )}
        {x.go && (
          <div className="mt-2">
            <Button variant="outline" size="sm" onClick={() => scrollToSection(x.go!.section)}>
              {x.go.label}
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

export function SecurityCard() {
  const { data, error, reload } = useLoad('security.status', {})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  async function toggle(enabled: boolean) {
    setBusy(true)
    setFailure('')
    try {
      await call('security.setUpdateCheck', { enabled })
      reload()
      // Po włączeniu serwer pyta o wersję w tle: wynik jest po chwili.
      if (enabled) setTimeout(reload, 2500)
    } catch (e) {
      setFailure(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={pl.security.title} sub={pl.security.sub} flush>
      {error && (
        <div className="px-5 py-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {data && (
        <>
          <ul className="divide-y divide-line">
            {data.items.map((i) => (
              <Row key={i.id} item={i} status={data} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
            <p className="max-w-xl text-xs text-muted-foreground">{pl.security.update.toggleHint}</p>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void toggle(!data.updateCheckEnabled)}>
              {data.updateCheckEnabled ? pl.security.update.toggleOff : pl.security.update.toggleOn}
            </Button>
          </div>
          {failure && (
            <div className="px-5 pb-3">
              <ErrorText>{failure}</ErrorText>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
