import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { PGlite } from '@electric-sql/pglite'
import { Pool } from 'pg'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as schema from './schema'
import { SCHEMA_DDL } from './ddl'

export type Database = NodePgDatabase<typeof schema>

let _db: Database | null = null
let _pool: Pool | null = null
let _pglite: PGlite | null = null
let _initPromise: Promise<Database> | null = null

export async function getDb(): Promise<Database> {
  if (_db) return _db
  if (_initPromise) return _initPromise

  _initPromise = (async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim()
    const forcePglite = process.env.USE_PGLITE === 'true' || process.env.VITEST === 'true'

    if (databaseUrl && !forcePglite) {
      _pool = new Pool({
        connectionString: databaseUrl,
        max: 10
      })
      const db = drizzlePg(_pool, { schema })
      await _pool.query(SCHEMA_DDL)
      _db = db
      return db
    }

    if (process.env.NODE_ENV === 'production' && !forcePglite) {
      throw new Error('DATABASE_URL environment variable is required in production')
    }

    // Embedded PostgreSQL (PGlite): in-memory for Vitest, persisted to .data/pgdata for local dev
    const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
    let dataDir: string | undefined
    if (!isTest) {
      dataDir = resolve(process.cwd(), '.data', 'pgdata')
      mkdirSync(dirname(dataDir), { recursive: true })
    }
    _pglite = new PGlite(dataDir)
    await _pglite.exec(SCHEMA_DDL)
    // Drizzle PGlite instance is API-compatible with NodePgDatabase for all CRUD & transaction calls
    _db = drizzlePglite(_pglite, { schema }) as unknown as Database
    return _db
  })()

  return _initPromise
}

/**
 * Reset the in-memory database (used exclusively in automated tests).
 */
export async function resetTestDb(): Promise<Database> {
  if (_pglite) {
    await _pglite.close()
    _pglite = null
  }
  if (_pool) {
    await _pool.end()
    _pool = null
  }
  _db = null
  _initPromise = null
  return getDb()
}

export async function closeDb(): Promise<void> {
  if (_pglite) {
    await _pglite.close()
    _pglite = null
  }
  if (_pool) {
    await _pool.end()
    _pool = null
  }
  _db = null
  _initPromise = null
}

export { schema }
