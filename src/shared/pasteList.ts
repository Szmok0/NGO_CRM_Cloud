// Wklejona lista uczestników: jedna osoba w linii,
// „Imię Nazwisko” albo „Imię Nazwisko; e-mail; telefon” (separator ; lub tabulator z Excela).

export interface PastedPerson {
  line: number
  raw: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  /** Błąd linii (np. samo imię) — taka linia nie jest importowana. */
  error: 'NAME_INCOMPLETE' | null
}

export function parsePasteList(text: string): PastedPerson[] {
  const out: PastedPerson[] = []
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim()
    if (!raw) return
    const [namePart = '', ...rest] = raw.split(/[;\t]/).map((p) => p.trim())
    const words = namePart.split(/\s+/).filter(Boolean)
    let email: string | null = null
    let phone: string | null = null
    for (const part of rest) {
      if (!part) continue
      if (part.includes('@')) email = email ?? part
      else phone = phone ?? part
    }
    out.push({
      line: i + 1,
      raw,
      firstName: words[0] ?? '',
      lastName: words.slice(1).join(' '),
      email,
      phone,
      error: words.length < 2 ? 'NAME_INCOMPLETE' : null
    })
  })
  return out
}
