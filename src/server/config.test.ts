import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

describe('config: tryb kreatora', () => {
  it('pełna konfiguracja → serwer gotowy', () => {
    setEnv({ DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/db', APP_SECRET: 'x'.repeat(32) })
    expect(loadConfig().ready).toBe(true)
  })

  it('za krótki APP_SECRET → tryb kreatora z nazwą zmiennej', () => {
    setEnv({ DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/db', APP_SECRET: 'x'.repeat(31) })
    const c = loadConfig()
    expect(c.ready).toBe(false)
    if (!c.ready) expect(c.missing).toEqual(['APP_SECRET'])
  })

  it('brak DATABASE_URL i APP_SECRET → oba na liście, bez wartości w komunikacie', () => {
    setEnv({ DATABASE_URL: undefined, APP_SECRET: undefined })
    const c = loadConfig()
    expect(c.ready).toBe(false)
    if (!c.ready) expect(c.missing.sort()).toEqual(['APP_SECRET', 'DATABASE_URL'])
  })

  it('komunikat nie zawiera hasła z DATABASE_URL', () => {
    setEnv({ DATABASE_URL: 'postgres://u:tajne-haslo@h/db', APP_SECRET: 'x'.repeat(32) })
    const c = loadConfig()
    expect(c.ready).toBe(false)
    if (!c.ready) {
      expect(c.message).toContain('schemat: postgres:')
      expect(c.message).not.toContain('tajne-haslo')
    }
  })
})
