// Sprawdzanie nowej wersji programu (ZADANIE_04, D9). Raz na dobę serwer (nie przeglądarka, więc CSP bez zmian) pyta
// publiczne API wydań GitHuba o najnowsze wydanie. Zapytanie nie niesie danych organizacji ani identyfikatorów
// (tylko ogólna nazwa klienta, której wymaga GitHub). Brak połączenia to nie błąd: panel pokazuje „nie udało się sprawdzić”.
import { isNull } from 'drizzle-orm'
import type { SecurityStatus } from '@shared/api'
import pkg from '../../../package.json'
import type { Db } from '../db/connection'
import { settings } from '../db/schema'

/** Repozytorium główne projektu (stała w kodzie). */
export const RELEASES_API_URL = 'https://api.github.com/repos/Szmok0/NGO_CRM_Cloud/releases/latest'
const RELEASE_URL_PREFIX = 'https://github.com/Szmok0/NGO_CRM_Cloud/'
const CHECK_EVERY_MS = 24 * 3600_000
const FETCH_TIMEOUT_MS = 10_000
/** Wydanie ze znacznikiem w tytule, np. „[bezpieczeństwo] Wersja 0.1.1”, jest poprawką bezpieczeństwa (czerwone w panelu). Samo słowo w tytule nie wystarcza. */
const SECURITY_WORD = /\[(bezpiecze[nń]stwo|security)\]/i

export interface ReleaseInfo {
  version: string
  title: string
  url: string
  security: boolean
}

interface Cache {
  /** Ostatnie udane sprawdzenie. */
  checkedAt: Date | null
  release: ReleaseInfo | null
  /** Ostatnia próba (udana lub nie); po nieudanej następna jest przy najbliższym tyknięciu timera. */
  attemptedAt: Date | null
  lastFailed: boolean
}

let cache: Cache = { checkedAt: null, release: null, attemptedAt: null, lastFailed: false }
let fetcher: typeof fetch = (input, init) => fetch(input, init)

/** Tylko dla testów: podmiana zapytania sieciowego i czyszczenie pamięci podręcznej. */
export function setUpdateFetcher(f: typeof fetch | null) {
  fetcher = f ?? ((input, init) => fetch(input, init))
}
export function resetUpdateCache() {
  cache = { checkedAt: null, release: null, attemptedAt: null, lastFailed: false }
}

const parts = (v: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1, 4).map(Number) ?? null

/** Czy wersja `a` jest nowsza od `b` (numery x.y.z; coś innego → false). */
export function isNewerVersion(a: string, b: string): boolean {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i]! !== y[i]!) return x[i]! > y[i]!
  return false
}

/** Odpowiedź API wydań → wydanie albo null, gdy kształt się nie zgadza (nic z niej nie trafia do interfejsu bez sprawdzenia). */
export function parseRelease(json: unknown): ReleaseInfo | null {
  if (typeof json !== 'object' || json === null) return null
  const j = json as Record<string, unknown>
  if (typeof j.tag_name !== 'string' || j.draft === true || j.prerelease === true) return null
  const version = j.tag_name.replace(/^v/i, '')
  if (!parts(version)) return null
  const title = typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 200) : `Wersja ${version}`
  const url = typeof j.html_url === 'string' && j.html_url.startsWith(RELEASE_URL_PREFIX) ? j.html_url : `${RELEASE_URL_PREFIX}releases`
  return { version, title, url, security: SECURITY_WORD.test(title) }
}

export async function updateCheckEnabled(db: Db): Promise<boolean> {
  const [s] = await db.select({ on: settings.checkUpdates }).from(settings).where(isNull(settings.deletedAt)).limit(1)
  return s?.on ?? true
}

/** Jedno zapytanie do GitHuba, jeśli sprawdzanie jest włączone. Nigdy nie rzuca: błąd sieci zapisuje się jako „nie udało się”. */
export async function refreshUpdateInfo(db: Db, now: Date = new Date()): Promise<void> {
  if (!(await updateCheckEnabled(db))) return
  try {
    const res = await fetcher(RELEASES_API_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'ngo-crm-cloud' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error('status')
    const release = parseRelease(await res.json())
    if (!release) throw new Error('shape')
    cache = { checkedAt: now, release, attemptedAt: now, lastFailed: false }
  } catch {
    cache = { ...cache, attemptedAt: now, lastFailed: true }
  }
}

/** Czy minęła doba od ostatniego udanego sprawdzenia (po nieudanym próbujemy znowu przy kolejnym tyknięciu). */
export function updateCheckDue(now: Date): boolean {
  if (cache.lastFailed || !cache.checkedAt) return true
  return now.getTime() - cache.checkedAt.getTime() >= CHECK_EVERY_MS
}

/** Aktualny stan do panelu (z pamięci podręcznej, bez ruchu w sieci). */
export function updateStatus(enabled: boolean): SecurityStatus['update'] {
  const none = { latest: null, title: null, url: null, security: false, checkedAt: cache.checkedAt?.toISOString() ?? null }
  if (!enabled) return { state: 'disabled', ...none }
  const r = cache.release
  if (r && isNewerVersion(r.version, pkg.version)) return { state: 'available', latest: r.version, title: r.title, url: r.url, security: r.security, checkedAt: none.checkedAt }
  if (cache.lastFailed) return { state: 'failed', ...none }
  if (!r) return { state: 'pending', ...none }
  return { state: 'current', ...none, latest: r.version }
}

/** Timer procesu: sprawdzenie zaraz po starcie i potem co godzinę, pytanie do GitHuba najwyżej raz na dobę. */
export function startUpdateTimer(db: Db): void {
  const tick = () => {
    if (!updateCheckDue(new Date())) return
    void refreshUpdateInfo(db).catch(() => undefined)
  }
  tick()
  setInterval(tick, 3600_000).unref()
}
