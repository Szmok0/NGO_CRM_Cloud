import { randomUUID } from 'node:crypto'
import { and, eq, getTableName, type InferInsertModel, type InferSelectModel } from 'drizzle-orm'
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core'
import { AppError } from '@shared/errors'
import type { Db } from './connection'
import { changeLog } from './schema'

/** Tabela domenowa: ma kolumny z domainColumns() (schema.ts). */
export type DomainTable = MySqlTable & {
  id: MySqlColumn
  createdAt: MySqlColumn
  updatedAt: MySqlColumn
  updatedBy: MySqlColumn
  deletedAt: MySqlColumn
  version: MySqlColumn
}
type TechField = 'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'deletedAt' | 'version'
export type Row<T extends DomainTable> = InferSelectModel<T>
export type NewRow<T extends DomainTable> = Omit<InferInsertModel<T>, TechField> & { id?: string }
export type Patch<T extends DomainTable> = Partial<Omit<InferInsertModel<T>, TechField>>

export interface RepoContext {
  userId: string
  /** Zegar (testy). */
  now?: () => Date
}

const TECH_FIELDS = new Set<string>(['id', 'createdAt', 'updatedAt', 'updatedBy', 'deletedAt', 'version'])
const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date ? String(a) === String(b) : JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Op = 'insert' | 'update' | 'delete' | 'restore'

/**
 * Jedyna warstwa zapisu do tabel domenowych. Ustawia pola techniczne, sprawdza `version`
 * (blokada optymistyczna) i w tej samej transakcji dopisuje wpis do change_log.
 * `db` może być trwającą transakcją (zapisy stają się wtedy jej częścią).
 */
export function createRepo(db: Pick<Db, 'transaction'>, ctx: RepoContext) {
  const now = () => (ctx.now ? ctx.now() : new Date())

  const log = (tx: Tx, table: DomainTable, entityId: string, op: Op, changedFields: Record<string, unknown>, at: Date) =>
    tx.insert(changeLog).values({ id: randomUUID(), entity: getTableName(table), entityId, op, changedFields, userId: ctx.userId, at })

  async function getRaw(tx: Tx, table: DomainTable, id: string) {
    const [row] = await tx.select().from(table as MySqlTable).where(eq(table.id, id)).for('update')
    return row as Record<string, unknown> | undefined
  }

  /** Bieżący rekord o oczekiwanej wersji; inaczej NOT_FOUND albo VERSION_CONFLICT. */
  async function current(tx: Tx, table: DomainTable, id: string, expectedVersion: number) {
    const row = await getRaw(tx, table, id)
    if (!row) throw new AppError('NOT_FOUND')
    if (row['version'] !== expectedVersion) throw new AppError('VERSION_CONFLICT')
    return row
  }

  /** Zapis zmian z warunkiem na wersję i podbiciem jej o 1. */
  async function write(tx: Tx, table: DomainTable, id: string, expectedVersion: number, set: Record<string, unknown>, at: Date) {
    const [res] = await tx
      .update(table as MySqlTable)
      .set({ ...set, updatedAt: at, updatedBy: ctx.userId, version: expectedVersion + 1 } as never)
      .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
    if (res.affectedRows !== 1) throw new AppError('VERSION_CONFLICT')
  }

  async function setDeleted<T extends DomainTable>(table: T, id: string, expectedVersion: number, deleted: boolean): Promise<Row<T> | null> {
    return db.transaction(async (tx) => {
      const row = await current(tx, table, id, expectedVersion)
      if (Boolean(row['deletedAt']) === deleted) return null
      const at = now()
      const deletedAt = deleted ? at : null
      await write(tx, table, id, expectedVersion, { deletedAt }, at)
      await log(tx, table, id, deleted ? 'delete' : 'restore', { deletedAt }, at)
      return (await getRaw(tx, table, id)) as Row<T>
    })
  }

  return {
    async insert<T extends DomainTable>(table: T, values: NewRow<T>): Promise<Row<T>> {
      return db.transaction(async (tx) => {
        const at = now()
        const id = values.id ?? randomUUID()
        const row = { ...values, id, createdAt: at, updatedAt: at, updatedBy: ctx.userId, deletedAt: null, version: 1 }
        await tx.insert(table as MySqlTable).values(row as never)
        const fields = Object.fromEntries(Object.entries(values).filter(([k, v]) => !TECH_FIELDS.has(k) && v !== undefined))
        await log(tx, table, id, 'insert', fields, at)
        return (await getRaw(tx, table, id)) as Row<T>
      })
    },

    /**
     * Zapisuje tylko zmienione pola, gdy rekord ma wersję `expectedVersion`.
     * Starsza wersja → AppError('VERSION_CONFLICT'), bez cichego nadpisywania (zasada danych 2).
     * Zwraca null, gdy nic się nie zmieniło (bez wpisu w change_log i bez zmiany wersji).
     */
    async update<T extends DomainTable>(table: T, id: string, expectedVersion: number, patch: Patch<T>): Promise<Row<T> | null> {
      return db.transaction(async (tx) => {
        const row = await current(tx, table, id, expectedVersion)
        const changed: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || TECH_FIELDS.has(k)) continue
          if (!same(row[k], v)) changed[k] = v
        }
        if (Object.keys(changed).length === 0) return null
        const at = now()
        await write(tx, table, id, expectedVersion, changed, at)
        await log(tx, table, id, 'update', changed, at)
        return (await getRaw(tx, table, id)) as Row<T>
      })
    },

    /** Usunięcie = oznaczenie `deletedAt` (zasada danych 3). Zwraca null, gdy już usunięty. */
    softDelete<T extends DomainTable>(table: T, id: string, expectedVersion: number) {
      return setDeleted(table, id, expectedVersion, true)
    },

    /** Przywrócenie z Kosza. Zwraca null, gdy nie był usunięty. */
    restore<T extends DomainTable>(table: T, id: string, expectedVersion: number) {
      return setDeleted(table, id, expectedVersion, false)
    }
  }
}

export type Repo = ReturnType<typeof createRepo>
