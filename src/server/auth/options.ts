import type { IpLimiter } from './lockout'
import type { ScryptParams } from './password'

/** Ustawienia logowania przekazywane do buildApp (trasy /api/auth/…, /api/setup/… i metody auth.* w RPC). */
export interface AuthOptions {
  appSecret: string
  /** Jednorazowy token kreatora pierwszego uruchomienia (zmienna SETUP_TOKEN). */
  setupToken?: string
  /** Folder na załączniki i kopie (zmienna STORAGE_DIR); kreator sprawdza, czy da się w nim zapisać. */
  storageDir?: string
  /** Tryb produkcyjny: STORAGE_DIR nie może leżeć w folderze aplikacji (wdrożenie go podmienia). */
  production?: boolean
  /** Zegar (testy). */
  now?: () => Date
  /** Parametry scrypt (testy: tańsze). */
  scryptParams?: ScryptParams
  ipLimiter?: IpLimiter
}
