// Walidacja numeru PESEL w przeglądarce (serwer nie widzi danych wrażliwych): 11 cyfr, poprawna data urodzenia, suma kontrolna.

const WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]

/** Stulecie zakodowane w miesiącu: +80 → 1800, +0 → 1900, +20 → 2000, +40 → 2100, +60 → 2200. */
const CENTURIES: [number, number][] = [
  [80, 1800],
  [60, 2200],
  [40, 2100],
  [20, 2000],
  [0, 1900]
]

export function isValidPesel(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false
  const d = [...value].map(Number)
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * d[i]!, 0)
  if ((10 - (sum % 10)) % 10 !== d[10]) return false

  const yy = d[0]! * 10 + d[1]!
  const mm = d[2]! * 10 + d[3]!
  const dd = d[4]! * 10 + d[5]!
  const [offset, century] = CENTURIES.find(([o]) => mm > o && mm <= o + 12) ?? [-1, 0]
  if (offset < 0) return false
  const year = century + yy
  const month = mm - offset
  const date = new Date(Date.UTC(year, month - 1, dd))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === dd
}
