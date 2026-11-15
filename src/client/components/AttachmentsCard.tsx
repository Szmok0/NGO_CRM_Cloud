// Sekcja „Dokumenty” na karcie osoby i w szczegółach działania (ZADANIE_03, D11). Plik i jego nazwa są szyfrowane
// w przeglądarce; nazwa i klucz pliku są w `metaEnc`, który otwiera klucz organizacji z pamięci karty.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, Lock, Plus, Trash2 } from 'lucide-react'
import { ATTACHMENT_MAX_PLAIN_BYTES } from '@shared/api'
import type { Attachment } from '@shared/types'
import { useApp } from '../app/context'
import { decryptFile, decryptMeta, encryptFile, type FileMeta } from '../crypto/files'
import { pl } from '../i18n/pl'
import { attachmentApi, call, errorMessage, useDataChanged } from '../lib/api'
import { downloadBlob } from '../lib/download'
import { formatDate } from '../lib/format'
import { currentOrgKeyVersion, orgKeyFor, useKeyring } from '../lib/keyring'
import { UnlockDialog } from './UnlockDialog'
import { Button, Card, Empty, ErrorText } from './ui'

type Target = { targetType: 'contact' | 'action'; targetId: string }
interface Row {
  att: Attachment
  meta: FileMeta | null
}

class KeyMissingError extends Error {}

function readableError(e: unknown) {
  if (e instanceof KeyMissingError) return pl.attachments.noKeyForVersion
  if (e instanceof DOMException || e instanceof SyntaxError) return pl.attachments.decryptFailed
  return errorMessage(e)
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

export function AttachmentsCard({ targetType, targetId, editable }: Target & { editable: boolean }) {
  const { session } = useApp()
  const { unlocked, hasOrgAccess } = useKeyring()
  const storage = session.me.storageConfigured
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const target: Target = { targetType, targetId }

  const load = useCallback(async () => {
    try {
      const list = await call('attachments.list', { targetType, targetId })
      const out: Row[] = []
      for (const att of list) {
        const key = orgKeyFor(att.keyVersion)
        let meta: FileMeta | null = null
        if (key) meta = await decryptMeta(att.metaEnc, key, { targetType, targetId }, att.keyVersion).catch(() => null)
        out.push({ att, meta })
      }
      setRows(out)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [targetType, targetId])

  // Lista wczytuje się po odblokowaniu (nazwy wymagają klucza) i znika z ekranu po blokadzie kluczy.
  useEffect(() => {
    if (unlocked && hasOrgAccess) void load()
    else setRows(null)
  }, [unlocked, hasOrgAccess, load])
  useDataChanged(
    useCallback(() => {
      if (unlocked && hasOrgAccess) void load()
    }, [unlocked, hasOrgAccess, load])
  )

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = ''
    if (!file) return
    setError('')
    if (file.size === 0) return setError(pl.attachments.emptyFile)
    if (file.size > ATTACHMENT_MAX_PLAIN_BYTES) return setError(pl.attachments.tooBig(ATTACHMENT_MAX_PLAIN_BYTES / 1024 / 1024))
    const keyVersion = currentOrgKeyVersion()
    const key = keyVersion === null ? null : orgKeyFor(keyVersion)
    if (keyVersion === null || !key) return setError(pl.attachments.noAccess)
    setBusy(true)
    try {
      const enc = await encryptFile(await file.arrayBuffer(), { name: file.name, type: file.type }, key, target, keyVersion)
      await attachmentApi.upload(target, keyVersion, enc.metaEnc, enc.body)
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  const download = async (r: Row) => {
    setError('')
    setBusy(true)
    try {
      if (!r.meta) throw new KeyMissingError()
      const plain = await decryptFile(await attachmentApi.download(r.att.id), r.meta.fileKey, r.meta.fileVersion ?? r.att.keyVersion)
      downloadBlob(r.meta.name, new Blob([plain], { type: r.meta.type || 'application/octet-stream' }))
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (r: Row) => {
    if (!confirm(pl.attachments.confirmRemove(r.meta?.name ?? pl.attachments.unreadable))) return
    setError('')
    try {
      await call('attachments.delete', { id: r.att.id, version: r.att.version })
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  let actions: ReactNode = null
  let body: ReactNode
  if (!storage) {
    body = <Empty>{pl.attachments.noStorage}</Empty>
    actions = editable && (
      <Button size="sm" variant="outline" disabled title={pl.attachments.noStorage}>
        <Plus size={13} /> {pl.attachments.add}
      </Button>
    )
  } else if (!unlocked) {
    body = <Empty>{pl.attachments.locked}</Empty>
    actions = (
      <Button size="sm" variant="outline" onClick={() => setUnlocking(true)}>
        <Lock size={13} /> {pl.unlock.open}
      </Button>
    )
  } else if (!hasOrgAccess) {
    body = <Empty>{pl.attachments.noAccess}</Empty>
  } else {
    actions = editable && (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        <Plus size={13} /> {busy ? pl.attachments.working : pl.attachments.add}
      </Button>
    )
    body = !rows ? null : rows.length === 0 ? (
      <Empty>{pl.attachments.empty}</Empty>
    ) : (
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((r) => (
          <li key={r.att.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{r.meta?.name ?? pl.attachments.unreadable}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatSize(r.att.sizeBytes - 28)} · {formatDate(r.att.createdAt.slice(0, 10))}
            </span>
            <Button size="sm" variant="ghost" disabled={busy || !r.meta} onClick={() => void download(r)}>
              <Download size={13} /> {pl.attachments.download}
            </Button>
            {editable && (
              <Button size="sm" variant="ghost" className="text-destructive" aria-label={pl.attachments.remove} onClick={() => void remove(r)}>
                <Trash2 size={13} />
              </Button>
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Card title={pl.attachments.title} actions={actions}>
      {body}
      {storage && unlocked && hasOrgAccess && <p className="mt-2 text-xs text-muted-foreground">{pl.attachments.encryptedHint}</p>}
      <ErrorText>{error}</ErrorText>
      <input ref={input} type="file" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {unlocking && <UnlockDialog userId={session.me.userId} onClose={() => setUnlocking(false)} />}
    </Card>
  )
}
