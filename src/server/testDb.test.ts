import { describe, expect, it } from 'vitest'
import { testDatabaseUrl } from './testDb'

const ok = 'mysql://u:p@127.0.0.1:3306/ngocrm_test'

describe('zabezpieczenie bazy testowej', () => {
  it('lokalna baza z przyrostkiem _test → dozwolona', () => {
    expect(testDatabaseUrl({ TEST_DATABASE_URL: ok })).toBe(ok)
    expect(testDatabaseUrl({ TEST_DATABASE_URL: 'mysql://u:p@localhost/x_test' })).toContain('x_test')
  })

  it.each([
    ['brak zmiennej', {}],
    ['NODE_ENV=production', { TEST_DATABASE_URL: ok, NODE_ENV: 'production' }],
    ['host zdalny', { TEST_DATABASE_URL: 'mysql://u:p@srv964.hstgr.io:3306/ngocrm_test' }],
    ['host produkcyjny jak na Hostingerze, ale baza bez _test', { TEST_DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/u161817445_ngocloud' }],
    ['baza robocza', { TEST_DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/ngocrm' }],
    ['ten sam adres co DATABASE_URL', { TEST_DATABASE_URL: ok, DATABASE_URL: ok }],
    ['inny protokół', { TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1/ngocrm_test' }],
    ['nie adres', { TEST_DATABASE_URL: 'ngocrm_test' }]
  ])('%s → odmowa', (_name, env) => {
    expect(() => testDatabaseUrl(env as NodeJS.ProcessEnv)).toThrow()
  })
})
