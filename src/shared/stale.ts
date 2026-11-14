// „Zamarłe” kontakty: uczestnik (aktywna rola participant) w działaniu planowanym
// lub w realizacji, bez aktywności kontakt/wsparcie i bez obecności „obecny”
// od ponad `staleDays` dni. Gdy nie ma żadnej aktywności, punktem odniesienia jest
// dzień dodania do działania (inaczej każdy nowo dopisany uczestnik byłby od razu „zamarły”).

const DAY_MS = 86_400_000

export interface StaleInput {
  contactId: string
  /** Najwcześniejsza data dodania do trwającego / planowanego działania (ISO). */
  joinedAt: string
  /** Daty aktywności typu contact/support oraz obecności „present” (ISO lub RRRR-MM-DD). */
  touches: string[]
}

export interface StaleResult {
  contactId: string
  lastTouch: string | null
  days: number
}

export function daysBetween(fromIso: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / DAY_MS)
}

/** Zamarły, gdy od ostatniego kontaktu minęło WIĘCEJ niż staleDays pełnych dni. */
export function findStale(inputs: StaleInput[], staleDays: number, now: Date): StaleResult[] {
  const out: StaleResult[] = []
  for (const i of inputs) {
    const last = i.touches.length ? i.touches.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null
    const days = daysBetween(last ?? i.joinedAt, now)
    if (days > staleDays) out.push({ contactId: i.contactId, lastTouch: last, days })
  }
  return out.sort((a, b) => b.days - a.days)
}
