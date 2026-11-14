// Wklejenie listy uczestników: podgląd dopasowań, potwierdzenie wątpliwych, import (przeniesione z desktopu).
import { useState } from 'react'
import type { PastePreviewRow } from '@shared/types'
import { Alert, Badge, Button, Dialog, ErrorText, Select, Table, Textarea } from '../../components/ui'
import { pl } from '../../i18n/pl'
import { call, errorMessage } from '../../lib/api'

export function PasteDialog({ actionId, onClose, onDone }: { actionId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<PastePreviewRow[] | null>(null)
  // wybór dla każdej linii: id istniejącej osoby albo 'new'
  const [choice, setChoice] = useState<Record<number, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const preview = async () => {
    setError('')
    try {
      const r = await call('participants.previewPaste', { actionId, text })
      setRows(r)
      setChoice(Object.fromEntries(r.map((x) => [x.line, x.suggestedContactId ?? (x.matches.length === 0 ? 'new' : '')])))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const valid = rows?.filter((r) => !r.error) ?? []
  const undecided = valid.some((r) => !choice[r.line])

  const apply = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await call('participants.applyPaste', {
        actionId,
        rows: valid.map((r) => ({ firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, contactId: choice[r.line] === 'new' ? null : choice[r.line]! }))
      })
      onDone(pl.actions.pasteResult(res.added, res.created))
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={pl.actions.pasteTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {pl.common.cancel}
          </Button>
          {rows ? (
            <Button disabled={undecided || valid.length === 0 || busy} onClick={() => void apply()}>
              {pl.actions.pasteApply}
            </Button>
          ) : (
            <Button disabled={!text.trim()} onClick={() => void preview()}>
              {pl.actions.pastePreview}
            </Button>
          )}
        </>
      }
    >
      {!rows && (
        <>
          <p className="mb-2 text-sm text-muted-foreground">{pl.actions.pasteHint}</p>
          <Textarea autoFocus aria-label={pl.actions.pasteTitle} className="min-h-64 font-mono" value={text} onChange={(e) => setText(e.target.value)} />
        </>
      )}
      {rows && (
        <>
          {undecided && (
            <div className="mb-3">
              <Alert>{pl.actions.pasteDoubt}</Alert>
            </div>
          )}
          <Table>
            <thead>
              <tr>
                <th>{pl.print.name}</th>
                <th>{pl.contacts.email}</th>
                <th>{pl.contacts.phone}</th>
                <th className="w-[45%]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} className={!r.error && !choice[r.line] ? 'bg-warning-bg' : ''}>
                  <td className="font-medium">{r.error ? r.raw : `${r.firstName} ${r.lastName}`}</td>
                  <td>{r.email}</td>
                  <td>{r.phone}</td>
                  <td>
                    {r.error ? (
                      <Badge tone="danger">{pl.actions.pasteLineError}</Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Select aria-label={`${r.firstName} ${r.lastName}`} value={choice[r.line] ?? ''} onChange={(e) => setChoice((c) => ({ ...c, [r.line]: e.target.value }))}>
                          {!choice[r.line] && <option value="">— {pl.actions.pasteDoubt} —</option>}
                          {r.matches.map((m) => (
                            <option key={m.id} value={m.id}>
                              {pl.actions.pasteMatch(m.label, [m.email, m.phone, m.city].filter(Boolean).join(', '))}
                            </option>
                          ))}
                          <option value="new">{pl.actions.pasteNew}</option>
                        </Select>
                        {r.alreadyInAction && choice[r.line] === r.suggestedContactId && <Badge>{pl.actions.pasteAlready}</Badge>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </Dialog>
  )
}
