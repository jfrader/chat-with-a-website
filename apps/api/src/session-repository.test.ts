import { fileURLToPath } from "node:url"
import { createDatabaseClient, type DatabaseClient } from "@profound/db"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { DrizzleSessionRepository } from "./session-repository"

const databaseUrl = process.env.TEST_DATABASE_URL
const testDatabaseUrl = databaseUrl ?? ""

describe.skipIf(!databaseUrl)("DrizzleSessionRepository", () => {
  let client!: DatabaseClient
  let repository!: DrizzleSessionRepository

  beforeAll(async () => {
    client = createDatabaseClient(testDatabaseUrl)
    await migrate(client.db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    })
    repository = new DrizzleSessionRepository(client.db)
  })

  beforeEach(async () => {
    await client.pool.query("truncate table sessions cascade")
  })

  afterAll(async () => {
    await client.close()
  })

  it("binds create idempotency to URL and lists searchable newest sessions", async () => {
    const firstRequest = {
      url: "https://example.com/first",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    }
    const first = await repository.createOrGet(firstRequest)
    expect((await repository.createOrGet(firstRequest)).created).toBe(false)
    await expect(
      repository.createOrGet({ ...firstRequest, url: "https://example.org/conflict" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
    await repository.update(first.session.id, { title: "Search needle", status: "complete" })
    const second = await repository.createOrGet({
      url: "https://example.net/second",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    })

    expect((await repository.list({ query: "", limit: 1 })).sessions[0]?.id).toBe(second.session.id)
    expect((await repository.list({ query: "needle", limit: 20 })).sessions[0]?.id).toBe(
      first.session.id,
    )
  })

  it("rejects cursors with non-UUID IDs or non-canonical timestamps", async () => {
    const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

    await expect(
      repository.list({
        query: "",
        limit: 20,
        cursor: cursor({ createdAt: "2026-08-26T00:00:00.000Z", id: "not-a-uuid" }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_URL" })
    await expect(
      repository.list({
        query: "",
        limit: 20,
        cursor: cursor({
          createdAt: "2026-08-26T00:00:00Z",
          id: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_URL" })
  })

  it("treats PostgreSQL ILIKE wildcard characters as literal search text", async () => {
    const percent = await repository.createOrGet({
      url: "https://example.com/percent",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    })
    await repository.update(percent.session.id, { title: "A 100% literal title" })
    const underscore = await repository.createOrGet({
      url: "https://example.com/underscore",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    })
    await repository.update(underscore.session.id, { title: "A literal_under title" })
    await repository.createOrGet({
      url: "https://example.com/plain",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    })

    expect((await repository.list({ query: "%", limit: 20 })).sessions.map(({ id }) => id)).toEqual(
      [percent.session.id],
    )
    expect((await repository.list({ query: "_", limit: 20 })).sessions.map(({ id }) => id)).toEqual(
      [underscore.session.id],
    )
  })

  it("persists idempotent messages, reconciles interruption, and cascades delete", async () => {
    const session = await repository.createOrGet({
      url: "https://example.com/article",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    })
    const requestId = "33333333-3333-4333-8333-333333333333"
    const pair = await repository.createMessages(session.session.id, requestId, "Question")
    expect(
      (await repository.createMessages(session.session.id, requestId, "Question")).created,
    ).toBe(false)
    await expect(
      repository.createMessages(session.session.id, requestId, "Different question"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
    await repository.reconcileInterrupted()
    expect((await repository.findById(session.session.id))?.failureCode).toBe(
      "GENERATION_INTERRUPTED",
    )
    expect(
      (await repository.listMessages(session.session.id)).find(
        ({ id }) => id === pair.assistantMessage.id,
      ),
    ).toMatchObject({
      status: "failed",
      failureCode: "GENERATION_INTERRUPTED",
    })
    expect(await repository.delete(session.session.id)).toBe(true)
    expect(await repository.listMessages(session.session.id)).toEqual([])
  })
})
