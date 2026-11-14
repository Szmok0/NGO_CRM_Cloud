/** Odpowiedź GET /api/health (bez danych organizacji). */
export type Health =
  | {
      status: 'ok'
      version: string
      migrations: number
      /** Czy żądanie przyszło po HTTPS (bezpośrednio albo przez pośrednika hostingu). */
      https: boolean
    }
  | {
      /** Tryb kreatora: brak lub błędna konfiguracja; `missing` to nazwy zmiennych do ustawienia w panelu. */
      status: 'setup'
      version: string
      missing: string[]
      https: boolean
    }
