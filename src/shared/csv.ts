// CSV dla polskiego Excela: separator ;, CRLF. BOM UTF-8 dokleja zapis pliku.
export const CSV_BOM = '﻿'

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Tekst z danych użytkowników do CSV: komórka zaczynająca się od `=`, `@` albo `+`/`-` (poza numerem telefonu lub liczbą)
 * mogłaby zostać wykonana jako formuła w Excelu, więc dostaje apostrof z przodu.
 */
export const csvText = (v: string | null | undefined): string => {
  const s = v ?? ''
  if (/^[=@\t\r]/.test(s)) return `'${s}`
  if (/^[+-]/.test(s) && !/^[+-][\d\s().-]*$/.test(s)) return `'${s}`
  return s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')
}
