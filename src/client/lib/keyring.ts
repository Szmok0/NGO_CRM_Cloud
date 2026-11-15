// Klucze w pamięci tej karty (nigdy localStorage ani sessionStorage): klucz prywatny użytkownika i klucze organizacji
// otwarte z jego slotów (wersja → klucz niewyeksportowalny). Po odświeżeniu strony i po 15 min bezczynności znikają:
// stan „zablokowany” do wpisania hasła (okno „Odblokuj”) albo ponownego logowania.
import { useSyncExternalStore } from 'react'
import type { ApiOutputs } from '@shared/api'
import { fromBase64 } from '../crypto/encoding'
import { deriveKeys } from '../crypto/kdf'
import { openSlot, unwrapPrivateKey } from '../crypto/keys'
import { call } from './api'

/** Blokada kluczy po bezczynności (D5): krótsza niż wylogowanie po 30 min. */
export const IDLE_LOCK_MS = 15 * 60 * 1000

/** Złe hasło w oknie „Odblokuj” (szyfrogram klucza prywatnego się nie otworzył). */
export class WrongPasswordError extends Error {
  constructor() {
    super('WRONG_PASSWORD')
  }
}

let privateKey: CryptoKey | null = null
let orgKeys = new Map<number, CryptoKey>()

export interface KeyringState {
  /** Klucz prywatny odszyfrowany w tej karcie. */
  unlocked: boolean
  /** Są otwarte sloty klucza organizacji (osoba ma dostęp do danych wrażliwych). */
  hasOrgAccess: boolean
}
let state: KeyringState = { unlocked: false, hasOrgAccess: false }
const listeners = new Set<() => void>()

function publish() {
  const next = { unlocked: privateKey !== null, hasOrgAccess: orgKeys.size > 0 }
  if (next.unlocked === state.unlocked && next.hasOrgAccess === state.hasOrgAccess) return
  state = next
  listeners.forEach((l) => l())
}

/** Stan kluczy w komponentach (odświeża się po odblokowaniu, blokadzie i zmianie slotów). */
export function useKeyring(): KeyringState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

export const keysUnlocked = () => privateKey !== null

export function lockKeys() {
  privateKey = null
  orgKeys = new Map()
  publish()
}

/** Klucze organizacji do bieżącej wersji (i starszych, jeszcze niewycofanych), niewyeksportowalne. */
export const orgKeyFor = (keyVersion: number) => orgKeys.get(keyVersion) ?? null

/** Otwiera sloty zalogowanej osoby własnym kluczem prywatnym. */
export async function loadOrgKeys(): Promise<void> {
  if (!privateKey) return
  const slots = await call('keys.mySlots', {})
  const next = new Map<number, CryptoKey>()
  for (const s of slots) next.set(s.keyVersion, await openSlot(s.wrappedKey, privateKey, s.keyVersion, false))
  orgKeys = next
  publish()
}

/**
 * Klucze organizacji z możliwością eksportu, tylko na czas operacji (nadanie dostępu, zmiana klucza; D4).
 * Wywołujący nie zapisuje ich nigdzie i nie przechowuje po operacji. Pusta mapa: osoba nie ma slotów.
 */
export async function openExportableOrgKeys(): Promise<Map<number, CryptoKey>> {
  const result = new Map<number, CryptoKey>()
  if (!privateKey) return result
  for (const s of await call('keys.mySlots', {})) result.set(s.keyVersion, await openSlot(s.wrappedKey, privateKey, s.keyVersion, true))
  return result
}

async function applyKeys(keys: ApiOutputs['auth.keys'], wrapKey: CryptoKey, userId: string): Promise<boolean> {
  if (!keys.privateKeyEnc) return false
  privateKey = await unwrapPrivateKey(keys.privateKeyEnc, wrapKey, userId)
  publish()
  await loadOrgKeys()
  return true
}

/** Po pełnym logowaniu: pobiera zaszyfrowany klucz prywatny i odszyfrowuje go kluczem `wrapKey` z hasła, potem otwiera sloty. */
export async function unlockKeys(wrapKey: CryptoKey, userId: string): Promise<boolean> {
  return applyKeys(await call('auth.keys', {}), wrapKey, userId)
}

/**
 * Okno „Odblokuj” po odświeżeniu strony: `wrapKey` liczony z hasła w przeglądarce, nic nie idzie do serwera
 * (poza pobraniem własnego szyfrogramu klucza). Złe hasło = błąd odszyfrowania → WrongPasswordError.
 * Zwraca false, gdy konto nie ma kluczy.
 */
export async function unlockWithPassword(password: string, userId: string): Promise<boolean> {
  const keys = await call('auth.keys', {})
  if (!keys.privateKeyEnc) return false
  const { wrapKey } = await deriveKeys(password, fromBase64(keys.kdfSalt), keys.kdfIterations)
  try {
    privateKey = await unwrapPrivateKey(keys.privateKeyEnc, wrapKey, userId)
  } catch {
    throw new WrongPasswordError()
  }
  publish()
  await loadOrgKeys()
  return true
}

/** Własny klucz publiczny (SPKI base64) do utworzenia slotu przy odzyskiwaniu dostępu. */
export const ownPublicKey = async () => (await call('auth.keys', {})).publicKey

/**
 * Automatyczna blokada kluczy po bezczynności (D5); zwykłe dane działają dalej.
 * Zwraca funkcję zatrzymującą nasłuch (wylogowanie, zmiana widoku).
 */
export function startIdleLock(ms = IDLE_LOCK_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(lockKeys, ms)
  }
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
  events.forEach((e) => window.addEventListener(e, arm, { passive: true }))
  arm()
  return () => {
    clearTimeout(timer)
    events.forEach((e) => window.removeEventListener(e, arm))
  }
}
