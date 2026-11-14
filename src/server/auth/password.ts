// Serwer nie zna hasła, tylko `authKey` wyprowadzony w przeglądarce. W bazie leży scrypt(authKey)
// (decyzja 9: N=2^17, r=8, p=1, sól 16 B, skrót 32 B, maxmem 256 MB; jak hasła w iV_CRM).
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

export interface ScryptParams {
  N: number
  r: number
  p: number
}
export const SCRYPT_PARAMS: ScryptParams = { N: 2 ** 17, r: 8, p: 1 }
const KEY_LEN = 32
const SALT_LEN = 16
const MAXMEM = 256 * 1024 * 1024

const scrypt = (input: string, salt: Buffer, keylen: number, params: ScryptParams) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(input, salt, keylen, { ...params, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))))

/** Zapis „scrypt$N$r$p$sól$skrót” (base64) do kolumny users.authHash. */
export async function hashAuthKey(authKey: string, params: ScryptParams = SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const hash = await scrypt(authKey, salt, KEY_LEN, params)
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

/** Porównanie w stałym czasie. Nieczytelny zapis w bazie → false. */
export async function verifyAuthKey(authKey: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$')
  const params = { N: Number(n), r: Number(r), p: Number(p) }
  if (scheme !== 'scrypt' || !saltB64 || !hashB64 || !Object.values(params).every((x) => Number.isInteger(x) && x > 0)) return false
  const expected = Buffer.from(hashB64, 'base64')
  if (expected.length !== KEY_LEN) return false
  const actual = await scrypt(authKey, Buffer.from(saltB64, 'base64'), KEY_LEN, params)
  return timingSafeEqual(actual, expected)
}
