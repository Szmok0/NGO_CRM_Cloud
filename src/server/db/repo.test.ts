// Test warstwy zapisu na tabeli używanej tylko tutaj (test_records, poza schema.ts i migracjami).
// Wymaga lokalnej bazy testowej z TEST_DATABASE_URL (.env), zob. testDb.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq, sql } from 'drizzle-orm'
import { mysqlTable, varchar } from 'drizzle-orm/mysql-core'
import { AppError } from '@shared/errors'
import { openTestDb } from '../testDb'
import type { Db } from './connection'
import { changeLog, domainColumns } from './schema'
import { createRepo, NAMES_ONLY_TABLES, type Repo } from './repo'

const testRecords = mysqlTable('test_records', {
  ...domainColumns(),
  name: varchar('name', { length: 100 }).notNull(),
  note: varchar('note', { length: 200 })
})

let db: Db
let close: () => Promise<void>
let repo: Repo
const USER = '00000000-0000-4000-8000-000000000001'

const entries = () => db.select().from(changeLog).where(eq(changeLog.entity, 'test_records')).orderBy(asc(changeLog.at))
const cleanup = async () => {
  await db.execute(sql`delete from change_log where entity = 'test_records'`)
  await db.execute(sql`delete from test_records`)
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  await db.execute(sql`
    create table if not exists test_records (
      id char(36) primary key,
      created_at datetime(3) not null,
      updated_at datetime(3) not null,
      updated_by char(36) not null,
      deleted_at datetime(3) null,
      version int not null,
      name varchar(100) not null,
      note varchar(200) null
    )`)
})

beforeEach(async () => {
  await cleanup()
  let t = Date.parse('2026-01-01T10:00:00.000Z')
  repo = createRepo(db, { userId: USER, now: () => new Date((t += 1000)) })
})

afterAll(async () => {
  if (!db) return
  await cleanup()
  await db.execute(sql`drop table if exists test_records`)
  await close()
})

const conflict = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<AppError>)

describe('repo: warstwa zapisu', () => {
  it('insert ustawia pola techniczne, version 1 i dopisuje change_log', async () => {
    const row = await repo.insert(testRecords, { name: 'Rekord testowy' })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row).toMatchObject({ version: 1, updatedBy: USER, deletedAt: null, name: 'Rekord testowy' })
    expect(row.createdAt.toISOString()).toBe('2026-01-01T10:00:01.000Z')
    expect(row.updatedAt).toEqual(row.createdAt)
    const log = await entries()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ entityId: row.id, op: 'insert', userId: USER, changedFields: { name: 'Rekord testowy' } })
  })

  it('update z aktualną wersją: podbija version i zapisuje w change_log tylko zmienione pola', async () => {
    const row = await repo.insert(testRecords, { name: 'A', note: 'x' })
    const updated = await repo.update(testRecords, row.id, 1, { name: 'A', note: 'y' })
    expect(updated).toMatchObject({ version: 2, note: 'y' })
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime())
    const log = await entries()
    expect(log).toHaveLength(2)
    expect(log[1]).toMatchObject({ op: 'update', changedFields: { note: 'y' } })
  })

  it('update bez zmian: null, bez wpisu w change_log i bez zmiany wersji', async () => {
    const row = await repo.insert(testRecords, { name: 'A' })
    expect(await repo.update(testRecords, row.id, 1, { name: 'A' })).toBeNull()
    expect(await entries()).toHaveLength(1)
    const [stored] = await db.select().from(testRecords).where(eq(testRecords.id, row.id))
    expect(stored!.version).toBe(1)
  })

  it('zapis ze starą wersją jest odrzucany (VERSION_CONFLICT), rekord bez zmian', async () => {
    const row = await repo.insert(testRecords, { name: 'A' })
    await repo.update(testRecords, row.id, 1, { name: 'B' }) // ktoś inny zapisał wersję 2
    await conflict(repo.update(testRecords, row.id, 1, { name: 'C' }))
    await conflict(repo.softDelete(testRecords, row.id, 1))
    const [stored] = await db.select().from(testRecords).where(eq(testRecords.id, row.id))
    expect(stored).toMatchObject({ name: 'B', version: 2, deletedAt: null })
    expect(await entries()).toHaveLength(2)
  })

  it('softDelete i restore: deletedAt, wersja i wpisy delete/restore', async () => {
    const row = await repo.insert(testRecords, { name: 'A' })
    const deleted = await repo.softDelete(testRecords, row.id, 1)
    expect(deleted).toMatchObject({ version: 2 })
    expect(deleted!.deletedAt).toBeInstanceOf(Date)
    expect(await repo.softDelete(testRecords, row.id, 2)).toBeNull()
    const restored = await repo.restore(testRecords, row.id, 2)
    expect(restored).toMatchObject({ version: 3, deletedAt: null })
    expect((await entries()).map((e) => e.op)).toEqual(['insert', 'delete', 'restore'])
  })

  it('tabela z NAMES_ONLY_TABLES: change_log ma tylko nazwy pól, bez wartości', async () => {
    NAMES_ONLY_TABLES.add('test_records')
    try {
      const row = await repo.insert(testRecords, { name: 'Ania Testowa', note: 'tajne' })
      await repo.update(testRecords, row.id, 1, { name: 'Ania Zmieniona' })
      await repo.softDelete(testRecords, row.id, 2)
      const log = await entries()
      expect(log.map((e) => e.changedFields)).toEqual([{ name: true, note: true }, { name: true }, { deletedAt: true }])
      expect(JSON.stringify(log)).not.toMatch(/Ania|tajne/)
    } finally {
      NAMES_ONLY_TABLES.delete('test_records')
    }
  })

  it('nieistniejący rekord → NOT_FOUND', async () => {
    await expect(repo.update(testRecords, '00000000-0000-4000-8000-00000000ffff', 1, { name: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
