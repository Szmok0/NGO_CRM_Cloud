// Eksport danych osoby (D13, art. 15 RODO): JSON i wersja do druku. Serwer daje to, co zna (`contacts.exportData`, wpis `export`);
// dane wrażliwe i nazwy dokumentów dokłada przeglądarka kluczem z pamięci karty. Bez klucza eksport jest oznaczony jako niepełny.
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Download, Printer } from 'lucide-react'
import type { ContactDetail } from '@shared/types'
import { decryptMeta } from '../crypto/files'
import { decryptSensitive, type SensitiveFields } from '../crypto/sensitive'
import { pl } from '../i18n/pl'
import { call, errorMessage } from '../lib/api'
import { downloadText } from '../lib/download'
import { formatDate, formatDateTime } from '../lib/format'
import { orgKeyFor, useKeyring } from '../lib/keyring'
import { Alert, Button, Dialog, ErrorText } from './ui'

type SensitiveStatus = 'included' | 'none' | 'locked' | 'noAccess' | 'failed'
interface FileRow {
  name: string | null
  type: string | null
  sizeBytes: number
}
interface Result {
  exportedAt: string
  detail: ContactDetail
  sensitive: SensitiveFields | null
  sensitiveStatus: SensitiveStatus
  attachments: FileRow[]
  complete: boolean
}

async function collect(contactId: string, unlocked: boolean, hasOrgAccess: boolean): Promise<Result> {
  const base = await call('contacts.exportData', { id: contactId })
  const { detail } = base
  const canDecrypt = unlocked && hasOrgAccess

  let sensitive: SensitiveFields | null = null
  let sensitiveStatus: SensitiveStatus = 'none'
  if (detail.hasSensitive) {
    if (!unlocked) sensitiveStatus = 'locked'
    else if (!hasOrgAccess) sensitiveStatus = 'noAccess'
    else {
      try {
        // Odsłonięcie trafia do dziennika dostępu jak każde inne.
        const c = await call('sensitive.reveal', { contactId })
        const key = orgKeyFor(c.keyVersion)
        if (!key) throw new Error('KEY_MISSING')
        sensitive = await decryptSensitive(c, key, contactId, c.keyVersion)
        sensitiveStatus = 'included'
      } catch {
        sensitiveStatus = 'failed'
      }
    }
  }

  const attachments: FileRow[] = []
  for (const att of base.attachments) {
    const key = canDecrypt ? orgKeyFor(att.keyVersion) : null
    const meta = key ? await decryptMeta(att.metaEnc, key, { targetType: att.targetType, targetId: att.targetId }, att.keyVersion).catch(() => null) : null
    attachments.push({ name: meta?.name ?? null, type: meta?.type ?? null, sizeBytes: att.sizeBytes })
  }

  const complete = (sensitiveStatus === 'included' || sensitiveStatus === 'none') && attachments.every((a) => a.name !== null)
  return { exportedAt: base.exportedAt, detail, sensitive, sensitiveStatus, attachments, complete }
}

const sensitiveText: Record<SensitiveStatus, string> = {
  included: pl.personExport.sensitiveIncluded,
  none: pl.personExport.sensitiveNone,
  locked: pl.personExport.sensitiveLocked,
  noAccess: pl.personExport.sensitiveNoAccess,
  failed: pl.personExport.sensitiveFailed
}

/** Treść pliku JSON: bez zaszyfrowanych metadanych, z jawną informacją, czy eksport jest pełny. */
function toJson(r: Result): string {
  const { detail } = r
  return JSON.stringify(
    {
      exportedAt: r.exportedAt,
      complete: r.complete,
      sensitiveStatus: r.sensitiveStatus,
      contact: detail.contact,
      roles: detail.roles,
      consents: detail.consents,
      relationships: detail.relationships,
      participations: detail.participations,
      tasks: detail.tasks,
      activities: detail.activities,
      sensitive: r.sensitive,
      attachments: r.attachments
    },
    null,
    2
  )
}

export function PersonExportDialog({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const { unlocked, hasOrgAccess } = useKeyring()
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    collect(contactId, unlocked, hasOrgAccess)
      .then((r) => alive && setResult(r))
      .catch((e: unknown) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
    }
    // Eksport wykonuje się raz, przy otwarciu okna (każdy zapis trafia do dziennika dostępu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId])

  const fileName = result ? `dane-osoby-${contactId.slice(0, 8)}-${result.exportedAt.slice(0, 10)}.json` : ''
  /** Drukuje tylko blok z danymi: reszta aplikacji jest w druku ukryta (styles.css, klasa na body). */
  const print = () => {
    document.body.classList.add('print-export')
    window.print()
    document.body.classList.remove('print-export')
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={pl.personExport.title}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {pl.common.close}
          </Button>
          <Button variant="outline" disabled={!result} onClick={print}>
            <Printer size={14} /> {pl.personExport.print}
          </Button>
          <Button disabled={!result} onClick={() => result && downloadText(fileName, toJson(result), 'application/json;charset=utf-8')}>
            <Download size={14} /> {pl.personExport.json}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>{pl.personExport.intro}</p>
        <ErrorText>{error}</ErrorText>
        {!result && !error && <p className="text-muted-foreground">{pl.personExport.working}</p>}
        {result && (
          <>
            <Alert tone={result.complete ? 'info' : 'warning'}>{result.complete ? pl.personExport.complete : pl.personExport.incomplete}</Alert>
            <p>{sensitiveText[result.sensitiveStatus]}</p>
            {result.attachments.length > 0 && <p className="text-muted-foreground">{pl.personExport.filesNote}</p>}
            {createPortal(<PrintView r={result} />, document.body)}
          </>
        )}
      </div>
    </Dialog>
  )
}

function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="border-b border-border pb-1 text-base font-bold">{title}</h2>
      <div className="mt-1.5 text-sm">{children}</div>
    </section>
  )
}

function PrintRow({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null
  return (
    <p>
      <span className="text-muted-foreground">{label}:</span> <span className="whitespace-pre-wrap">{children}</span>
    </p>
  )
}

/** Wersja do druku (widoczna tylko w druku, gdy body ma klasę `print-export`). */
function PrintView({ r }: { r: Result }) {
  const { detail: d } = r
  const c = d.contact
  const s = pl.personExport.sections
  const sensitive = r.sensitive
  return (
    <div className="hidden print:block">
      <h1 className="text-xl font-bold">
        {pl.personExport.printTitle}: {d.label}
      </h1>
      <p className="text-xs">
        {pl.personExport.exportedAt}: {formatDateTime(r.exportedAt)}
      </p>
      {!r.complete && <p className="mt-1 font-bold">{pl.personExport.incompleteMark}</p>}
      <p className="text-xs">{sensitiveText[r.sensitiveStatus]}</p>

      <PrintSection title={s.data}>
        <PrintRow label={pl.contacts.email}>{c.email}</PrintRow>
        <PrintRow label={pl.contacts.phone}>{c.phone}</PrintRow>
        <PrintRow label={pl.contacts.address}>{c.address}</PrintRow>
        <PrintRow label={pl.contacts.city}>{c.city}</PrintRow>
        <PrintRow label={pl.contacts.tag}>{c.tags.join(', ')}</PrintRow>
        <PrintRow label={pl.common.notes}>{c.notes}</PrintRow>
      </PrintSection>

      {sensitive && (
        <PrintSection title={s.sensitive}>
          <PrintRow label={pl.sensitive.pesel}>{sensitive.pesel}</PrintRow>
          <PrintRow label={pl.sensitive.disability}>{sensitive.disability}</PrintRow>
          <PrintRow label={pl.sensitive.disabilityValidUntil}>{sensitive.disabilityValidUntil && formatDate(sensitive.disabilityValidUntil)}</PrintRow>
          <PrintRow label={pl.sensitive.health}>{sensitive.health}</PrintRow>
          <PrintRow label={pl.sensitive.family}>{sensitive.family}</PrintRow>
          <PrintRow label={pl.sensitive.notes}>{sensitive.notes}</PrintRow>
        </PrintSection>
      )}

      {d.roles.length > 0 && (
        <PrintSection title={s.roles}>
          {d.roles.map((x) => (
            <p key={x.id}>
              {pl.roles[x.role]}
              {x.since && `, od ${formatDate(x.since)}`}
              {x.until && `, do ${formatDate(x.until)}`}
              {x.note && ` (${x.note})`}
            </p>
          ))}
        </PrintSection>
      )}

      {d.consents.length > 0 && (
        <PrintSection title={s.consents}>
          {d.consents.map((x) => (
            <p key={x.id}>
              {pl.consentTypes[x.type]}: {pl.personExport.given} {formatDate(x.givenAt)}
              {x.validUntil && `, ważna do ${formatDate(x.validUntil)}`}
              {x.withdrawnAt && `, ${pl.personExport.withdrawn} ${formatDate(x.withdrawnAt)}`}
              {x.basis && ` (${x.basis})`}
            </p>
          ))}
        </PrintSection>
      )}

      {d.relationships.length > 0 && (
        <PrintSection title={s.relationships}>
          {d.relationships.map((x) => (
            <p key={x.id}>
              {x.isA ? pl.relationshipTypes[x.type] : pl.relationshipTypesReverse[x.type]}: {x.other.label || pl.contacts.anonymized}
              {x.note && ` (${x.note})`}
            </p>
          ))}
        </PrintSection>
      )}

      {d.participations.length > 0 && (
        <PrintSection title={s.participations}>
          {d.participations.map((x) => (
            <p key={x.participantId}>
              {x.action.title}
              {x.action.startDate && `, ${formatDate(x.action.startDate)}`}
            </p>
          ))}
        </PrintSection>
      )}

      {d.tasks.length > 0 && (
        <PrintSection title={s.tasks}>
          {d.tasks.map((x) => (
            <p key={x.id}>{x.title || pl.anonymize.contentRemoved}</p>
          ))}
        </PrintSection>
      )}

      {d.activities.length > 0 && (
        <PrintSection title={s.activities}>
          {d.activities.map((a) => (
            <p key={a.id} className="mb-1">
              <span className="text-muted-foreground">
                {formatDateTime(a.occurredAt)} · {pl.activityTypes[a.type]}:
              </span>{' '}
              <span className="whitespace-pre-wrap">{a.type === 'system' ? pl.personExport.systemEvent : a.content || pl.anonymize.contentRemoved}</span>
            </p>
          ))}
        </PrintSection>
      )}

      {r.attachments.length > 0 && (
        <PrintSection title={s.attachments}>
          {r.attachments.map((a, i) => (
            <p key={i}>
              {a.name ?? pl.personExport.unreadableName} ({Math.max(1, Math.round(a.sizeBytes / 1024))} kB)
            </p>
          ))}
        </PrintSection>
      )}
    </div>
  )
}
