// Odczyt pliku kopii zapasowej w przeglądarce (ZADANIE_04, D3, D4; format: src/shared/backupFormat.ts).
// WebCrypto + DecompressionStream, bez bibliotek; działa też w Node (testy). Plik czytany kawałkami (segment po segmencie),
// więc duża kopia nie trafia do pamięci w całości. Serwer przy tym nic nie dostaje: ani hasła, ani klucza kopii.
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_IV_BYTES,
  BACKUP_KEY_LABEL,
  BACKUP_MAGIC,
  BACKUP_TAG_BYTES,
  FRAME_FILE_DATA,
  FRAME_FILE_START,
  FRAME_MANIFEST,
  FRAME_TABLE,
  segmentAad,
  type BackupHeader,
  type BackupManifest
} from '@shared/backupFormat'
import { fromBase64, utf8 } from './encoding'
import { deriveKeys } from './kdf'
import { unwrapPrivateKey } from './keys'

/** Co poszło nie tak (UI zamienia kod na zdanie po polsku). */
export type BackupProblem =
  | 'not_backup' // to nie jest plik kopii
  | 'newer_format' // kopia z nowszej wersji programu
  | 'no_account' // w kopii nie ma takiego administratora (zły e-mail)
  | 'wrong_password' // hasło nie otwiera klucza (także hasło sprzed zmiany, jeśli kopia jest nowsza)
  | 'corrupt' // plik uszkodzony, obcięty albo zmieniony

export class BackupError extends Error {
  constructor(readonly code: BackupProblem) {
    super(code)
  }
}

const MAX_HEADER_BYTES = 1024 * 1024
const MAX_FRAME_BYTES = 64 * 1024 * 1024

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (data: Uint8Array<ArrayBuffer>) => hex(await crypto.subtle.digest('SHA-256', data))
const bytesOf = async (blob: Blob, from: number, to: number) => new Uint8Array(await blob.slice(from, to).arrayBuffer())

export interface OpenedBackup {
  header: BackupHeader
  headerHash: string
  /** Klucz kopii (AES-GCM); wyeksportowalny tylko na żądanie (odtwarzanie wysyła go serwerowi). */
  key: CryptoKey
  /** Początek segmentów w pliku. */
  bodyStart: number
}

/** Czyta nagłówek i otwiera klucz kopii e-mailem i hasłem administratora z dnia kopii. */
export async function openBackup(file: Blob, email: string, password: string, extractableKey = false): Promise<OpenedBackup> {
  if (file.size < 12) throw new BackupError('not_backup')
  const prefix = await bytesOf(file, 0, 12)
  if (new TextDecoder().decode(prefix.subarray(0, 8)) !== BACKUP_MAGIC) throw new BackupError('not_backup')
  const headerLen = new DataView(prefix.buffer).getUint32(8)
  if (headerLen === 0 || headerLen > MAX_HEADER_BYTES || 12 + headerLen > file.size) throw new BackupError('corrupt')
  const headerBytes = await bytesOf(file, 12, 12 + headerLen)
  let header: BackupHeader
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes)) as BackupHeader
    if (typeof header.format !== 'number' || !Array.isArray(header.admins)) throw new Error('bad header')
  } catch {
    throw new BackupError('corrupt')
  }
  if (header.format > BACKUP_FORMAT_VERSION) throw new BackupError('newer_format')

  const emailHash = await sha256Hex(utf8(email.trim().toLowerCase()))
  const admin = header.admins.find((a) => a.emailHash === emailHash)
  if (!admin) throw new BackupError('no_account')

  let privateKey: CryptoKey
  try {
    const { wrapKey } = await deriveKeys(password, fromBase64(admin.kdfSalt), admin.kdfIterations)
    privateKey = await unwrapPrivateKey(admin.privateKeyEnc, wrapKey, admin.userId)
  } catch {
    throw new BackupError('wrong_password')
  }
  try {
    const key = await crypto.subtle.unwrapKey(
      'raw',
      fromBase64(admin.wrappedKey),
      privateKey,
      { name: 'RSA-OAEP', label: utf8(BACKUP_KEY_LABEL) },
      { name: 'AES-GCM', length: 256 },
      extractableKey,
      ['decrypt']
    )
    return { header, headerHash: await sha256Hex(headerBytes), key, bodyStart: 12 + headerLen }
  } catch {
    throw new BackupError('corrupt')
  }
}

/** Składa ramki ze strumienia po rozpakowaniu (rodzaj 1 B | długość u32 BE | dane). */
class FrameParser {
  private pending: Uint8Array = new Uint8Array(0)
  constructor(private readonly onFrame: (kind: number, data: Uint8Array) => void | Promise<void>) {}

  async push(chunk: Uint8Array) {
    if (this.pending.length === 0) this.pending = chunk
    else {
      const joined = new Uint8Array(this.pending.length + chunk.length)
      joined.set(this.pending)
      joined.set(chunk, this.pending.length)
      this.pending = joined
    }
    for (;;) {
      if (this.pending.length < 5) return
      const view = new DataView(this.pending.buffer, this.pending.byteOffset, this.pending.byteLength)
      const len = view.getUint32(1)
      if (len > MAX_FRAME_BYTES) throw new BackupError('corrupt')
      if (this.pending.length < 5 + len) return
      const kind = this.pending[0]!
      const data = this.pending.subarray(5, 5 + len)
      this.pending = this.pending.subarray(5 + len)
      await this.onFrame(kind, data)
    }
  }

  /** Po końcu strumienia nie może zostać niedokończona ramka. */
  end() {
    if (this.pending.length !== 0) throw new BackupError('corrupt')
  }
}

/**
 * Odszyfrowuje i rozpakowuje treść kopii segment po segmencie, wołając `onFrame` dla każdej ramki.
 * Tag GCM każdego segmentu (z numerem i flagą „ostatni” w AAD) wykrywa zmianę, obcięcie i przestawienie.
 */
export async function readBackup(file: Blob, opened: OpenedBackup, onFrame: (kind: number, data: Uint8Array) => void | Promise<void>): Promise<void> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  const parser = new FrameParser(onFrame)
  const consume = (async () => {
    const reader = ds.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await parser.push(value)
    }
    parser.end()
  })()
  consume.catch(() => undefined) // błąd zobaczy `await consume` poniżej; tu tylko bez „unhandled rejection”

  try {
    let off = opened.bodyStart
    let index = 0
    if (off >= file.size) throw new BackupError('corrupt')
    while (off < file.size) {
      if (off + 4 > file.size) throw new BackupError('corrupt')
      const len = new DataView((await bytesOf(file, off, off + 4)).buffer).getUint32(0)
      if (len < BACKUP_IV_BYTES + BACKUP_TAG_BYTES || off + 4 + len > file.size) throw new BackupError('corrupt')
      const body = await bytesOf(file, off + 4, off + 4 + len)
      const last = off + 4 + len === file.size
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: body.subarray(0, BACKUP_IV_BYTES), additionalData: utf8(segmentAad(opened.headerHash, index, last)) },
        opened.key,
        body.subarray(BACKUP_IV_BYTES)
      )
      await writer.write(new Uint8Array(plain))
      off += 4 + len
      index++
    }
    await writer.close()
    await consume
  } catch (e) {
    writer.abort().catch(() => undefined)
    throw e instanceof BackupError ? e : new BackupError('corrupt')
  }
}

export interface BackupSummary {
  createdAt: string
  programVersion: string
  /** Osoby i instytucje bez usuniętych (kosz). */
  persons: number
  institutions: number
  actions: number
  /** Załączniki bez usuniętych. */
  documents: number
  /** Pliki załączników zapisane w kopii i ich łączny rozmiar. */
  files: number
  fileBytes: number
  /** Załączniki z wpisem w bazie, ale bez pliku na dysku w chwili kopii. */
  filesMissing: number
}

type Row = Record<string, unknown>

/**
 * „Sprawdź kopię” (D4): otwiera, odszyfrowuje całość, sprawdza zgodność z zestawieniem na końcu pliku
 * (liczby wierszy w tabelach, liczba i rozmiar plików). Nic nie zapisuje. Błąd: `BackupError`.
 */
export async function verifyBackup(file: Blob, email: string, password: string): Promise<BackupSummary> {
  const opened = await openBackup(file, email, password)
  const rows: Record<string, number> = {}
  let persons = 0
  let institutions = 0
  let actions = 0
  let documents = 0
  let files = 0
  let fileBytes = 0
  let declared = -1 // rozmiar pliku z ostatniej ramki „początek pliku”
  let received = 0
  let manifest: BackupManifest | null = null

  const closeFile = () => {
    if (declared < 0) return
    if (received !== declared) throw new BackupError('corrupt')
    files++
    fileBytes += received
    declared = -1
  }

  await readBackup(file, opened, (kind, data) => {
    if (manifest) throw new BackupError('corrupt') // zestawienie ma być ostatnie
    if (kind === FRAME_TABLE) {
      closeFile()
      const frame = JSON.parse(new TextDecoder().decode(data)) as { t: string; rows: Row[] }
      rows[frame.t] = (rows[frame.t] ?? 0) + frame.rows.length
      for (const r of frame.rows) {
        if (r.deleted_at) continue
        if (frame.t === 'contacts') (r.kind === 'institution' ? institutions++ : persons++)
        else if (frame.t === 'actions') actions++
        else if (frame.t === 'attachments') documents++
      }
    } else if (kind === FRAME_FILE_START) {
      closeFile()
      declared = (JSON.parse(new TextDecoder().decode(data)) as { bytes: number }).bytes
      received = 0
    } else if (kind === FRAME_FILE_DATA) {
      if (declared < 0) throw new BackupError('corrupt')
      received += data.length
    } else if (kind === FRAME_MANIFEST) {
      closeFile()
      manifest = JSON.parse(new TextDecoder().decode(data)) as BackupManifest
    } else throw new BackupError('corrupt')
  })

  const m = manifest as BackupManifest | null
  if (!m) throw new BackupError('corrupt')
  const names = Object.keys(m.tables)
  if (names.some((t) => (rows[t] ?? 0) !== m.tables[t]) || Object.keys(rows).some((t) => !(t in m.tables))) throw new BackupError('corrupt')
  if (files !== m.files || fileBytes !== m.fileBytes) throw new BackupError('corrupt')
  return { createdAt: opened.header.createdAt, programVersion: opened.header.programVersion, persons, institutions, actions, documents, files, fileBytes, filesMissing: m.filesMissing }
}
