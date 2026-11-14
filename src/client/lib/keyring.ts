// Klucz prywatny użytkownika: odszyfrowany tylko w pamięci tej karty (nigdy localStorage ani sessionStorage).
// Po odświeżeniu strony znika: stan „zablokowany” do następnego logowania.
import { unwrapPrivateKey } from '../crypto/keys'
import { call } from './api'

let privateKey: CryptoKey | null = null

export const keysUnlocked = () => privateKey !== null

export function lockKeys() {
  privateKey = null
}

/** Po pełnym logowaniu: pobiera zaszyfrowany klucz prywatny i odszyfrowuje go kluczem `wrapKey` z hasła. */
export async function unlockKeys(wrapKey: CryptoKey, userId: string): Promise<boolean> {
  const keys = await call('auth.keys', {})
  if (!keys.privateKeyEnc) return false
  privateKey = await unwrapPrivateKey(keys.privateKeyEnc, wrapKey, userId)
  return true
}
