// Zmiana klucza organizacji w przeglądarce administratora (ZADANIE_03, krok 4; D9). Serwer dostaje tylko sloty i szyfrogramy.
// Start: nowy klucz, sloty dla osób z dostępem i nowy slot odzyskiwania. Potem partiami: przeszyfrowanie danych wrażliwych
// i metadanych załączników. Koniec: serwer wycofuje stare wersje i kasuje ich sloty. Przerwaną zmianę można wznowić.
import { reencryptMeta } from '../crypto/files'
import { createSlot, generateOrgKey, importPublicKey } from '../crypto/keys'
import { createRecoverySlot, formatRecoveryKey, generateRecoveryKey } from '../crypto/recovery'
import { reencryptSensitive } from '../crypto/sensitive'
import { pl } from '../i18n/pl'
import { call } from './api'
import { loadOrgKeys, openExportableOrgKeys, orgKeyFor } from './keyring'

const BATCH = 50
/** Tyle kolejnych partii bez żadnego zapisu (same konflikty) uznajemy za zacięcie. */
const MAX_STALLED = 5

/** Zmiana trwa, gdy administrator ma sloty do co najmniej dwóch niewycofanych wersji klucza. */
export async function rotationInProgress(): Promise<boolean> {
  return (await call('keys.mySlots', {})).length > 1
}

export interface NewRecoveryKey {
  bytes: Uint8Array<ArrayBuffer>
  /** Postać do wydruku (14 grup). */
  text: string
}

/** Nowy klucz odzyskiwania, pokazywany administratorowi przed startem; na serwer idzie dopiero slot z nim. */
export async function newRecoveryKey(): Promise<NewRecoveryKey> {
  const bytes = generateRecoveryKey()
  return { bytes, text: await formatRecoveryKey(bytes) }
}

/** Start zmiany: nowa wersja klucza, sloty dla wszystkich z dostępem i slot odzyskiwania. */
export async function startRotation(recovery: NewRecoveryKey): Promise<void> {
  const own = await openExportableOrgKeys()
  if (own.size === 0) throw new Error(pl.access.noOwnAccess)
  const keyVersion = Math.max(...own.keys()) + 1
  const holders = (await call('access.list', {})).filter((a) => a.hasAccess)
  const newKey = await generateOrgKey()
  const slots = await Promise.all(
    holders.map(async (h) => {
      if (!h.publicKey) throw new Error(pl.rotate.holderNoKey)
      return { userId: h.userId, wrappedKey: await createSlot(newKey, await importPublicKey(h.publicKey), keyVersion) }
    })
  )
  await call('keys.rotateStart', { keyVersion, slots, recoverySlot: await createRecoverySlot(newKey, recovery.bytes, keyVersion) })
  await loadOrgKeys()
}

/**
 * Przeszyfrowanie wszystkich rekordów ze starszą wersją (także z Kosza) i zakończenie zmiany.
 * Rekord zmieniony w międzyczasie wraca w kolejnej partii (serwer podaje go z aktualną `version`).
 * Rekordu, którego nie da się odszyfrować, nie pomijamy: zmiana staje, a stare klucze zostają.
 */
export async function reencryptAll(onProgress: (done: number, total: number) => void): Promise<void> {
  await loadOrgKeys()
  let total = 0
  let stalled = 0
  for (;;) {
    const p = await call('keys.rotatePending', { limit: BATCH })
    const left = p.remaining.sensitive + p.remaining.attachments
    total = Math.max(total, left)
    onProgress(total - left, total)
    if (left === 0) break
    const newKey = orgKeyFor(p.currentVersion)
    if (!newKey) throw new Error(pl.rotate.keyMissing)
    try {
      const sensitive = []
      for (const r of p.sensitive) {
        const old = orgKeyFor(r.keyVersion)
        if (!old) throw new Error(pl.rotate.keyMissing)
        const enc = await reencryptSensitive(r, old, r.keyVersion, newKey, p.currentVersion, r.contactId)
        sensitive.push({ id: r.id, version: r.version, ...enc })
      }
      const attachments = []
      for (const r of p.attachments) {
        const old = orgKeyFor(r.keyVersion)
        if (!old) throw new Error(pl.rotate.keyMissing)
        attachments.push({ id: r.id, version: r.version, metaEnc: await reencryptMeta(r.metaEnc, old, r.keyVersion, newKey, p.currentVersion, r) })
      }
      const res = await call('keys.rotateBatch', { keyVersion: p.currentVersion, sensitive, attachments })
      stalled = res.updated === 0 ? stalled + 1 : 0
    } catch (e) {
      if (e instanceof DOMException) throw new Error(pl.rotate.decryptFailed)
      throw e
    }
    if (stalled >= MAX_STALLED) throw new Error(pl.rotate.stalled)
  }
  await call('keys.rotateFinish', {})
  await loadOrgKeys()
  onProgress(total, total)
}
