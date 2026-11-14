/** Odpowiedź GET /api/health (bez danych organizacji). */
export interface Health {
  status: 'ok'
  version: string
  migrations: number
  /** Czy żądanie przyszło po HTTPS (bezpośrednio albo przez pośrednika hostingu). */
  https: boolean
}
