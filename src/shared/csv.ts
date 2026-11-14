// CSV dla polskiego Excela: separator ;, CRLF. BOM UTF-8 dokleja zapis pliku.
export const CSV_BOM = '﻿'

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')
}
