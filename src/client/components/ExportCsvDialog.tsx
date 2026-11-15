// Okno eksportu CSV listy (D14): ostrzeżenie, wybór kolumn (e-mail, telefon, adres i miejscowość domyślnie odznaczone), zapis pliku w przeglądarce.
import { useState } from 'react'
import type { ApiInput } from '@shared/api'
import { ACTION_COLUMNS, COLUMN_HEADERS, CONTACT_COLUMNS, CONTACT_COLUMNS_OPT_IN, PARTICIPANT_COLUMNS } from '@shared/exportLabels'
import { pl } from '../i18n/pl'
import { call, errorMessage } from '../lib/api'
import { downloadText } from '../lib/download'
import { Alert, Button, Checkbox, Dialog, ErrorText } from './ui'

type CsvInput = ApiInput<'exports.csv'>
/** Co eksportujemy: rodzaj listy i jej filtry (te same, co w widoku). */
export type CsvSource =
  | { list: 'contacts'; filter: Omit<Extract<CsvInput, { list: 'contacts' }>, 'list' | 'columns'> }
  | { list: 'actions'; filter: Omit<Extract<CsvInput, { list: 'actions' }>, 'list' | 'columns'> }
  | { list: 'participants'; actionId: string }

const allColumns = (list: CsvSource['list']): readonly string[] => (list === 'contacts' ? CONTACT_COLUMNS : list === 'actions' ? ACTION_COLUMNS : PARTICIPANT_COLUMNS)
const isOptIn = (c: string) => (CONTACT_COLUMNS_OPT_IN as readonly string[]).includes(c)

export function ExportCsvDialog({ source, onClose }: { source: CsvSource; onClose: () => void }) {
  const columns = allColumns(source.list)
  const [selected, setSelected] = useState<string[]>(() => columns.filter((c) => !isOptIn(c)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const toggle = (c: string) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))

  const submit = async () => {
    if (selected.length === 0) return setError(pl.exportCsv.noColumns)
    setBusy(true)
    setError('')
    setDone('')
    try {
      // Kolejność kolumn w pliku ustala serwer (kolejność kontraktu); tu tylko zbiór.
      const ordered = columns.filter((c) => selected.includes(c))
      const input = (source.list === 'participants' ? { list: 'participants', actionId: source.actionId, columns: ordered } : { list: source.list, ...source.filter, columns: ordered }) as CsvInput
      const r = await call('exports.csv', input)
      // BOM, żeby Excel rozpoznał UTF-8 (serwer go nie dokleja).
      downloadText(r.filename, '﻿' + r.csv, 'text/csv;charset=utf-8')
      setDone(pl.exportCsv.done(r.rows))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={pl.exportCsv.title[source.list]}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {pl.common.close}
          </Button>
          <Button disabled={busy || selected.length === 0} onClick={() => void submit()}>
            {busy ? pl.exportCsv.working : pl.exportCsv.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone="warning">{pl.exportCsv.warning}</Alert>
        {source.list !== 'participants' && <p className="text-sm text-muted-foreground">{pl.exportCsv.scope}</p>}
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">{pl.exportCsv.columns}</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {columns.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.includes(c)} onChange={() => toggle(c)} />
                {COLUMN_HEADERS[c as keyof typeof COLUMN_HEADERS]}
              </label>
            ))}
          </div>
          {columns.some(isOptIn) && <p className="mt-2 text-xs text-muted-foreground">{pl.exportCsv.optInHint}</p>}
        </fieldset>
        <ErrorText>{error}</ErrorText>
        {done && <Alert tone="info">{done}</Alert>}
      </div>
    </Dialog>
  )
}
