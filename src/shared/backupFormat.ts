// Format pliku kopii zapasowej (ZADANIE_04, D2/D3). Wspólny dla serwera (zapis) i przeglądarki (sprawdzanie, odtwarzanie).
//
// Plik: MAGIC (8 B) | długość nagłówka (u32 BE) | nagłówek JSON (jawny) | segmenty.
// Segment: długość (u32 BE) | IV (12 B) | szyfrogram AES-256-GCM | tag (16 B). Treść segmentów po odszyfrowaniu i złożeniu
// to strumień gzip, a w nim ramki: rodzaj (1 B) | długość (u32 BE) | dane.
// Integralność: tag GCM każdego segmentu, w AAD nagłówek (skrót), numer segmentu i flaga „ostatni” (wykrywa obcięcie,
// podmianę i przestawienie segmentów). Skrót SHA-256 całego pliku liczy serwer (`backups.sha256`).

export const BACKUP_MAGIC = 'NGOCRMB1'
export const BACKUP_FORMAT_VERSION = 1
/** Rozmiar segmentu przed szyfrowaniem: przeglądarka czyta duży plik po kawałku. */
export const BACKUP_SEGMENT_BYTES = 4 * 1024 * 1024
export const BACKUP_IV_BYTES = 12
export const BACKUP_TAG_BYTES = 16
/** Etykieta RSA-OAEP przy zawijaniu klucza kopii kluczem publicznym administratora. */
export const BACKUP_KEY_LABEL = 'ngo-crm/backup-key/v1'

/** Rodzaje ramek w strumieniu po rozpakowaniu. */
export const FRAME_TABLE = 1 // JSON { t: nazwa tabeli, rows: [...] } (klucze = nazwy kolumn w bazie)
export const FRAME_FILE_START = 2 // JSON { name: storageKey, bytes: rozmiar }
export const FRAME_FILE_DATA = 3 // surowe bajty pliku załącznika (już zaszyfrowane w przeglądarce)
export const FRAME_MANIFEST = 4 // JSON BackupManifest, zawsze ostatnia ramka

/** Wpis administratora w nagłówku: po co jest każde pole, opisuje D3. */
export interface BackupAdminEntry {
  userId: string
  /** SHA-256 (hex) małych liter e-maila: do znalezienia wpisu bez jawnego adresu. */
  emailHash: string
  kdfSalt: string
  kdfIterations: number
  /** Klucz prywatny zaszyfrowany `wrapKey` z dnia kopii (jak w `users.privateKeyEnc`). */
  privateKeyEnc: string
  /** Klucz kopii zawinięty RSA-OAEP (SHA-256, etykieta BACKUP_KEY_LABEL), base64. */
  wrappedKey: string
}

export interface BackupHeader {
  format: number
  programVersion: string
  migrations: number
  createdAt: string
  segmentBytes: number
  admins: BackupAdminEntry[]
}

/** Ostatnia ramka (zaszyfrowana): liczby do pokazania po sprawdzeniu. */
export interface BackupManifest {
  tables: Record<string, number>
  files: number
  /** Załączniki z wpisem w bazie, ale bez pliku na dysku w chwili kopii. */
  filesMissing: number
  fileBytes: number
}

/** Dane uwierzytelniane segmentu (AAD), jako tekst UTF-8. */
export const segmentAad = (headerSha256Hex: string, index: number, last: boolean) => `ngo-crm/backup/v1|${headerSha256Hex}|${index}|${last ? 1 : 0}`
