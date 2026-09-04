import { fileURLToPath } from "node:url"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { createDatabaseClient } from "./client"

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_URL is required to run migrations")
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))
const client = createDatabaseClient(connectionString)

try {
  await migrate(client.db, { migrationsFolder })
  console.log("Database migrations complete")
} finally {
  await client.close()
}
