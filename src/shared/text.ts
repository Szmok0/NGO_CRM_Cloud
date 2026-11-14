// Porównywanie tekstu po polsku: bez wielkości liter i zbędnych spacji.
export const normText = (s: string | null | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl')

export const normPhone = (s: string | null | undefined): string => {
  const digits = (s ?? '').replace(/\D/g, '')
  return digits.length > 9 && digits.startsWith('48') ? digits.slice(2) : digits
}

export interface NamedContact {
  kind: 'person' | 'institution'
  firstName: string | null
  lastName: string | null
  name: string | null
}

export const displayName = (c: NamedContact): string =>
  c.kind === 'institution' ? (c.name ?? '') : [c.firstName, c.lastName].filter(Boolean).join(' ')

/** Wszystkie słowa zapytania występują w którymś z pól. */
export function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const words = normText(q).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const hay = fields.map(normText).join(' ')
  return words.every((w) => hay.includes(w))
}

export interface DuplicateCandidate {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
}

/** Możliwy duplikat: to samo imię i nazwisko, albo ten sam e-mail, albo ten sam telefon. */
export function isPossibleDuplicate(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  const sameName = !!normText(a.firstName) && !!normText(a.lastName) &&
    normText(a.firstName) === normText(b.firstName) && normText(a.lastName) === normText(b.lastName)
  const sameEmail = !!normText(a.email) && normText(a.email) === normText(b.email)
  const samePhone = normPhone(a.phone).length >= 6 && normPhone(a.phone) === normPhone(b.phone)
  return sameName || sameEmail || samePhone
}
