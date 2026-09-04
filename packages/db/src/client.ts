import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

export function createDatabaseClient(connectionString: string) {
  const pool = new Pool({ connectionString })
  const db = drizzle(pool, { schema })

  return {
    db,
    pool,
    async isReady() {
      try {
        await pool.query("select 1")
        return true
      } catch {
        return false
      }
    },
    async close() {
      await pool.end()
    },
  }
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>
