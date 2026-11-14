// Pomocnicze kodowanie dla kryptografii w przeglądarce (WebCrypto, bez bibliotek).

export const utf8 = (s: string) => new TextEncoder().encode(s)

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n))

export function toBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Zapis szyfrogramu AES-GCM: „v1.IV.szyfrogram” (base64). Wersja pozwala później zmienić format. */
export const sealed = (iv: Uint8Array, ciphertext: ArrayBuffer) => `v1.${toBase64(iv)}.${toBase64(ciphertext)}`

export function parseSealed(value: string): { iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> } {
  const [version, iv, ciphertext] = value.split('.')
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('Nieznany format szyfrogramu')
  return { iv: fromBase64(iv), ciphertext: fromBase64(ciphertext) }
}
