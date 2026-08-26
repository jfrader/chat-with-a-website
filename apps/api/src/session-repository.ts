import {
  apiErrorCodeSchema,
  type CreateSessionRequest,
  type SessionDto,
  sessionStageSchema,
  sessionStatusSchema,
} from "@profound/contracts"
import type { DatabaseClient } from "@profound/db"
import { sessions } from "@profound/db"
import { and, eq, ne, sql } from "drizzle-orm"

export const UNAUTHENTICATED_WORKSPACE_ID = "unauthenticated"

export type SessionRecord = Omit<
  SessionDto,
  "attemptId" | "completedAt" | "createdAt" | "updatedAt"
> & {
  completedAt: Date | null
  createdAt: Date
  currentAttemptId: string
  idempotencyKey: string
  promptVersion: string | null
  sourceHash: string | null
  sourceText: string
  updatedAt: Date
  workspaceId: string
}

export type SessionUpdate = Partial<
  Pick<
    SessionRecord,
    | "attemptNumber"
    | "canonicalUrl"
    | "completedAt"
    | "currentAttemptId"
    | "description"
    | "failureCode"
    | "failureStage"
    | "finalUrl"
    | "inputTokens"
    | "model"
    | "outputTokens"
    | "promptVersion"
    | "provider"
    | "siteName"
    | "sourceHash"
    | "sourceText"
    | "sourceTruncated"
    | "sourceWordCount"
    | "status"
    | "summary"
    | "title"
    | "updatedAt"
  >
>

export type CreateSessionResult = {
  created: boolean
  session: SessionRecord
}

export interface SessionRepository {
  claimForRecovery(
    workspaceId: string,
    id: string,
    expectedAttemptId: string,
    staleAfterMs: number,
    update: SessionUpdate,
  ): Promise<SessionRecord | null>
  createOrGet(workspaceId: string, request: CreateSessionRequest): Promise<CreateSessionResult>
  findById(workspaceId: string, id: string): Promise<SessionRecord | null>
  updateForAttempt(
    workspaceId: string,
    id: string,
    attemptId: string,
    update: SessionUpdate,
  ): Promise<SessionRecord | null>
}

type SessionRow = typeof sessions.$inferSelect

const toSessionRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  idempotencyKey: row.idempotencyKey,
  originalUrl: row.originalUrl,
  canonicalUrl: row.canonicalUrl,
  finalUrl: row.finalUrl,
  host: row.host,
  title: row.title,
  siteName: row.siteName,
  description: row.description,
  sourceText: row.sourceText,
  sourceHash: row.sourceHash,
  summary: row.summary,
  status: sessionStatusSchema.parse(row.status),
  failureStage: sessionStageSchema.nullable().parse(row.failureStage),
  failureCode: apiErrorCodeSchema.nullable().parse(row.failureCode),
  sourceWordCount: row.sourceWordCount,
  sourceTruncated: row.sourceTruncated,
  provider: row.provider,
  model: row.model,
  promptVersion: row.promptVersion,
  currentAttemptId: row.currentAttemptId,
  attemptNumber: row.attemptNumber,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  completedAt: row.completedAt,
})

export class DrizzleSessionRepository implements SessionRepository {
  readonly #database: DatabaseClient["db"]

  constructor(database: DatabaseClient["db"]) {
    this.#database = database
  }

  async claimForRecovery(
    workspaceId: string,
    id: string,
    expectedAttemptId: string,
    staleAfterMs: number,
    update: SessionUpdate,
  ): Promise<SessionRecord | null> {
    const [row] = await this.#database
      .update(sessions)
      .set({ ...update, updatedAt: sql`now()` })
      .where(
        and(
          eq(sessions.workspaceId, workspaceId),
          eq(sessions.id, id),
          eq(sessions.currentAttemptId, expectedAttemptId),
          sql`${sessions.updatedAt} <= now() - (${staleAfterMs} * interval '1 millisecond')`,
          ne(sessions.status, "complete"),
          ne(sessions.status, "failed"),
        ),
      )
      .returning()

    return row ? toSessionRecord(row) : null
  }

  async createOrGet(
    workspaceId: string,
    request: CreateSessionRequest,
  ): Promise<CreateSessionResult> {
    const canonicalUrl = new URL(request.url).toString()
    const [inserted] = await this.#database
      .insert(sessions)
      .values({
        workspaceId,
        idempotencyKey: request.idempotencyKey,
        originalUrl: request.url,
        canonicalUrl,
        host: new URL(canonicalUrl).hostname,
      })
      .onConflictDoNothing({ target: [sessions.workspaceId, sessions.idempotencyKey] })
      .returning()

    if (inserted) return { created: true, session: toSessionRecord(inserted) }

    const [existing] = await this.#database
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.workspaceId, workspaceId),
          eq(sessions.idempotencyKey, request.idempotencyKey),
        ),
      )
      .limit(1)

    if (!existing) throw new Error("Idempotent session insert did not return an existing row")
    return { created: false, session: toSessionRecord(existing) }
  }

  async findById(workspaceId: string, id: string): Promise<SessionRecord | null> {
    const [row] = await this.#database
      .select()
      .from(sessions)
      .where(and(eq(sessions.workspaceId, workspaceId), eq(sessions.id, id)))
      .limit(1)
    return row ? toSessionRecord(row) : null
  }

  async updateForAttempt(
    workspaceId: string,
    id: string,
    attemptId: string,
    update: SessionUpdate,
  ): Promise<SessionRecord | null> {
    const [row] = await this.#database
      .update(sessions)
      .set({ ...update, updatedAt: sql`now()` })
      .where(
        and(
          eq(sessions.workspaceId, workspaceId),
          eq(sessions.id, id),
          eq(sessions.currentAttemptId, attemptId),
        ),
      )
      .returning()

    return row ? toSessionRecord(row) : null
  }
}
