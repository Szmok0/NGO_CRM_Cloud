// Sekcja „Dane wrażliwe” na karcie osoby (ZADANIE_03, D1, D5, D6). Szyfrogram daje `sensitive.reveal` (wpis w dzienniku
// na serwerze), odszyfrowuje i szyfruje tylko przeglądarka. Jawne dane żyją wyłącznie w stanie tego komponentu:
// znikają po „Ukryj”, wyjściu z karty i blokadzie kluczy.
import { useEffect, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Lock, Pencil, Plus } from 'lucide-react'
import { useApp } from '../../app/context'
import { UnlockDialog } from '../../components/UnlockDialog'
import { Button, Card, Dialog, Empty, ErrorText, Field, Input, Textarea } from '../../components/ui'
import { decryptSensitive, emptySensitive, encryptSensitive, type SensitiveFields } from '../../crypto/sensitive'
import { pl } from '../../i18n/pl'
import { call, errorMessage, isApiError } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { currentOrgKeyVersion, orgKeyFor, useKeyring } from '../../lib/keyring'
import { isValidPesel } from '../../lib/pesel'

const TEXT_MAX = 4000

interface Revealed {
  /** Wersja rekordu do zapisu; null: osoba nie ma jeszcze danych wrażliwych. */
  version: number | null
  fields: SensitiveFields
}

class KeyMissingError extends Error {}

/** Odsłonięcie: szyfrogram z serwera (wpis `reveal_sensitive`) odszyfrowany kluczem z pamięci karty. */
async function reveal(contactId: string): Promise<Revealed> {
  const c = await call('sensitive.reveal', { contactId })
  const key = orgKeyFor(c.keyVersion)
  if (!key) throw new KeyMissingError()
  return { version: c.version, fields: await decryptSensitive(c, key, contactId, c.keyVersion) }
}

function revealError(e: unknown) {
  if (e instanceof KeyMissingError) return pl.sensitive.noKeyForVersion
  if (e instanceof DOMException || e instanceof SyntaxError) return pl.sensitive.decryptFailed
  return errorMessage(e)
}

export function SensitiveCard({ contactId, hasSensitive, editable, onChange }: { contactId: string; hasSensitive: boolean; editable: boolean; onChange: () => void }) {
  const { session } = useApp()
  const { unlocked, hasOrgAccess } = useKeyring()
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const [editing, setEditing] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Blokada kluczy (bezczynność) zakrywa odsłonięte dane i przerywa edycję.
  useEffect(() => {
    if (!hasOrgAccess) {
      setRevealed(null)
      setEditing(false)
    }
  }, [hasOrgAccess])

  if (!session.settings.sensitiveFieldsEnabled) {
    // Wyłączenie ukrywa pola (D2); informacja tylko tam, gdzie zapisane dane zostały.
    return hasSensitive ? (
      <Card title={pl.sensitive.title}>
        <Empty>{pl.sensitive.disabled}</Empty>
      </Card>
    ) : null
  }

  const doReveal = async () => {
    setError('')
    setBusy(true)
    try {
      setRevealed(await reveal(contactId))
    } catch (e) {
      setError(revealError(e))
    } finally {
      setBusy(false)
    }
  }

  const onSaved = (next: Revealed) => {
    setRevealed(next)
    setEditing(false)
    onChange()
  }

  /** Konflikt wersji: pokazujemy aktualne dane (ponowne odsłonięcie, też w dzienniku) i komunikat. */
  const onConflict = async () => {
    setEditing(false)
    onChange()
    try {
      setRevealed(await reveal(contactId))
      setError(pl.errors.VERSION_CONFLICT)
    } catch (e) {
      setRevealed(null)
      setError(revealError(e))
    }
  }

  let actions: ReactNode = null
  let body: ReactNode
  if (!unlocked) {
    body = <Empty>{pl.sensitive.locked}</Empty>
    actions = (
      <Button size="sm" variant="outline" onClick={() => setUnlocking(true)}>
        <Lock size={13} /> {pl.unlock.open}
      </Button>
    )
  } else if (!hasOrgAccess) {
    body = <Empty>{pl.sensitive.noAccess}</Empty>
  } else if (revealed) {
    body = <Values fields={revealed.fields} />
    actions = (
      <>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil size={13} /> {pl.common.edit}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setRevealed(null)}>
          <EyeOff size={13} /> {pl.sensitive.hide}
        </Button>
      </>
    )
  } else if (hasSensitive) {
    body = (
      <>
        <Values fields={null} />
        <p className="mt-3 text-xs text-muted-foreground">{pl.sensitive.revealHint}</p>
      </>
    )
    actions = (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void doReveal()}>
        <Eye size={13} /> {busy ? pl.sensitive.working : pl.sensitive.reveal}
      </Button>
    )
  } else {
    body = <Empty>{pl.sensitive.empty}</Empty>
    actions = editable && (
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <Plus size={13} /> {pl.sensitive.add}
      </Button>
    )
  }

  return (
    <Card title={pl.sensitive.title} actions={actions}>
      {body}
      <ErrorText>{error}</ErrorText>
      {unlocking && <UnlockDialog userId={session.me.userId} onClose={() => setUnlocking(false)} />}
      {editing && (
        <SensitiveForm
          contactId={contactId}
          initial={revealed ?? { version: null, fields: emptySensitive() }}
          onClose={() => setEditing(false)}
          onSaved={onSaved}
          onConflict={() => void onConflict()}
        />
      )}
    </Card>
  )
}

/** Wartości po odsłonięciu albo maska (`fields` = null). */
function Values({ fields }: { fields: SensitiveFields | null }) {
  const show = (v: string) => (fields ? v || pl.common.none : pl.sensitive.mask)
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      <Row label={pl.sensitive.pesel}>{show(fields?.pesel ?? '')}</Row>
      <Row label={pl.sensitive.disability}>{show(fields?.disability ?? '')}</Row>
      <Row label={pl.sensitive.disabilityValidUntil}>{show(fields?.disabilityValidUntil ? formatDate(fields.disabilityValidUntil) : '')}</Row>
      <Row label={pl.sensitive.health}>{show(fields?.health ?? '')}</Row>
      <Row label={pl.sensitive.family}>{show(fields?.family ?? '')}</Row>
      <Row label={pl.sensitive.notes}>{show(fields?.notes ?? '')}</Row>
    </dl>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{children}</dd>
    </>
  )
}

function SensitiveForm({
  contactId,
  initial,
  onClose,
  onSaved,
  onConflict
}: {
  contactId: string
  initial: Revealed
  onClose: () => void
  onSaved: (r: Revealed) => void
  onConflict: () => void
}) {
  const [f, setF] = useState<SensitiveFields>(initial.fields)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof SensitiveFields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const pesel = f.pesel.trim()
  const peselError = pesel !== '' && !isValidPesel(pesel)

  const save = async () => {
    setError('')
    const keyVersion = currentOrgKeyVersion()
    const key = keyVersion === null ? null : orgKeyFor(keyVersion)
    if (keyVersion === null || !key) return setError(pl.sensitive.noAccess)
    setBusy(true)
    try {
      const fields = { ...f, pesel }
      const enc = await encryptSensitive(fields, key, contactId, keyVersion)
      const { version } = await call('sensitive.save', { contactId, version: initial.version, keyVersion, ...enc })
      onSaved({ version, fields })
    } catch (e) {
      if (isApiError(e, 'VERSION_CONFLICT')) return onConflict()
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={busy ? () => undefined : onClose}
      title={pl.sensitive.editTitle}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {pl.common.cancel}
          </Button>
          <Button disabled={busy || peselError} onClick={() => void save()}>
            {pl.common.save}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={pl.sensitive.pesel} hint={peselError ? pl.sensitive.peselInvalid : undefined}>
          <Input inputMode="numeric" maxLength={11} autoComplete="off" aria-invalid={peselError} value={f.pesel} onChange={set('pesel')} />
        </Field>
        <div />
        <Field label={pl.sensitive.disability}>
          <Input maxLength={200} value={f.disability} onChange={set('disability')} />
        </Field>
        <Field label={pl.sensitive.disabilityValidUntil}>
          <Input type="date" value={f.disabilityValidUntil} onChange={set('disabilityValidUntil')} />
        </Field>
        <Field label={pl.sensitive.health} className="col-span-2">
          <Textarea maxLength={TEXT_MAX} value={f.health} onChange={set('health')} />
        </Field>
        <Field label={pl.sensitive.family} className="col-span-2">
          <Textarea maxLength={TEXT_MAX} value={f.family} onChange={set('family')} />
        </Field>
        <Field label={pl.sensitive.notes} className="col-span-2">
          <Textarea maxLength={TEXT_MAX} value={f.notes} onChange={set('notes')} />
        </Field>
        <p className="col-span-2 text-xs text-muted-foreground">{pl.sensitive.encryptedHint}</p>
        <div className="col-span-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
    </Dialog>
  )
}
