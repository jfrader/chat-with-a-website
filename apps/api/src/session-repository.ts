import {
  apiErrorCodeSchema,
  type CreateSessionRequest,
  type ListSessionsQuery,
  type MessageDto,
  messageRoleSchema,
  messageStatusSchema,
  type SessionDto,
  sessionStageSchema,
  sessionStatusSchema,
} from "@profound/contracts"
import type { DatabaseClient } from "@profound/db"
import { messages, sessions } from "@profound/db"
import { and, asc, desc, eq, ilike, lt, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import { ServiceError } from "./session-errors"

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

export type MessageRecord = Omit<
  MessageDto,
  "attemptId" | "completedAt" | "createdAt" | "updatedAt"
> & {
  completedAt: Date | null
  createdAt: Date
  currentAttemptId: string | null
  updatedAt: Date
}

export type SessionUpdate = Partial<
  Pick<
    SessionRecord,
    | "canonicalUrl"
    | "completedAt"
    | "description"
    | "failureCode"
    | "failureStage"
    | "finalUrl"
    | "generationVersion"
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
    | "suggestedPrompts"
    | "summary"
    | "title"
  >
>

export type MessageUpdate = Partial<
  Pick<
    MessageRecord,
    | "completedAt"
    | "content"
    | "failureCode"
    | "inputTokens"
    | "model"
    | "outputTokens"
    | "provider"
    | "reasoningContent"
    | "reasoningMs"
    | "status"
  >
>

export type CreateSessionResult = { created: boolean; session: SessionRecord }
export type CreateMessagesResult = {
  assistantMessage: MessageRecord
  created: boolean
  userMessage: MessageRecord
}
export type SessionPage = { nextCursor: string | null; sessions: SessionRecord[] }

export interface SessionRepository {
  createMessages(
    sessionId: string,
    requestId: string,
    content: string,
  ): Promise<CreateMessagesResult>
  createOrGet(request: CreateSessionRequest): Promise<CreateSessionResult>
  delete(id: string): Promise<boolean>
  findById(id: string): Promise<SessionRecord | null>
  list(query: ListSessionsQuery): Promise<SessionPage>
  listMessages(sessionId: string): Promise<MessageRecord[]>
  reconcileInterrupted(): Promise<void>
  update(id: string, update: SessionUpdate): Promise<SessionRecord | null>
  updateMessage(id: string, update: MessageUpdate): Promise<MessageRecord | null>
}

type SessionRow = typeof sessions.$inferSelect
type MessageRow = typeof messages.$inferSelect

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
  suggestedPrompts: row.suggestedPrompts,
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
  generationVersion: row.generationVersion,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  completedAt: row.completedAt,
})

const toMessageRecord = (row: MessageRow): MessageRecord => ({
  id: row.id,
  sessionId: row.sessionId,
  requestId: row.requestId,
  role: messageRoleSchema.parse(row.role),
  content: row.content,
  reasoningContent: row.reasoningContent,
  reasoningMs: row.reasoningMs,
  status: messageStatusSchema.parse(row.status),
  failureCode: apiErrorCodeSchema.nullable().parse(row.failureCode),
  provider: row.provider,
  model: row.model,
  currentAttemptId: row.currentAttemptId,
  attemptNumber: row.attemptNumber,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  completedAt: row.completedAt,
})

type Cursor = { createdAt: Date; id: string }

const cursorSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
  })
  .strict()

const encodeCursor = (session: SessionRecord) =>
  Buffer.from(
    JSON.stringify({ createdAt: session.createdAt.toISOString(), id: session.id }),
  ).toString("base64url")

const decodeCursor = (cursor: string | undefined): Cursor | null => {
  if (!cursor) return null
  try {
    const value = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")))
    const createdAt = new Date(value.createdAt)
    if (createdAt.toISOString() !== value.createdAt) throw new Error("Invalid cursor timestamp")
    return { createdAt, id: value.id }
  } catch {
    throw new ServiceError("INVALID_URL")
  }
}

const escapeIlikePattern = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")

export class DrizzleSessionRepository implements SessionRepository {
  readonly #database: DatabaseClient["db"]

  constructor(database: DatabaseClient["db"]) {
    this.#database = database
  }

  async createOrGet(request: CreateSessionRequest): Promise<CreateSessionResult> {
    const canonicalUrl = new URL(request.url).toString()
    const [inserted] = await this.#database
      .insert(sessions)
      .values({
        workspaceId: UNAUTHENTICATED_WORKSPACE_ID,
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
          eq(sessions.workspaceId, UNAUTHENTICATED_WORKSPACE_ID),
          eq(sessions.idempotencyKey, request.idempotencyKey),
        ),
      )
      .limit(1)

    if (!existing) throw new Error("Idempotent session insert did not return an existing row")
    if (new URL(existing.originalUrl).toString() !== canonicalUrl) {
      throw new ServiceError("IDEMPOTENCY_CONFLICT")
    }
    return { created: false, session: toSessionRecord(existing) }
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const [row] = await this.#database
      .select()
      .from(sessions)
      .where(and(eq(sessions.workspaceId, UNAUTHENTICATED_WORKSPACE_ID), eq(sessions.id, id)))
      .limit(1)
    return row ? toSessionRecord(row) : null
  }

  async list(query: ListSessionsQuery): Promise<SessionPage> {
    const cursor = decodeCursor(query.cursor)
    const literalQuery = escapeIlikePattern(query.query)
    const search = query.query
      ? or(
          ilike(sessions.title, `%${literalQuery}%`),
          ilike(sessions.originalUrl, `%${literalQuery}%`),
          ilike(sessions.canonicalUrl, `%${literalQuery}%`),
          ilike(sessions.summary, `%${literalQuery}%`),
        )
      : undefined
    const cursorFilter = cursor
      ? or(
          lt(sessions.createdAt, cursor.createdAt),
          and(eq(sessions.createdAt, cursor.createdAt), lt(sessions.id, cursor.id)),
        )
      : undefined
    const rows = await this.#database
      .select()
      .from(sessions)
      .where(and(eq(sessions.workspaceId, UNAUTHENTICATED_WORKSPACE_ID), search, cursorFilter))
      .orderBy(desc(sessions.createdAt), desc(sessions.id))
      .limit(query.limit + 1)
    const page = rows.slice(0, query.limit).map(toSessionRecord)
    const lastSession = page.at(-1)
    return {
      sessions: page,
      nextCursor: rows.length > query.limit && lastSession ? encodeCursor(lastSession) : null,
    }
  }

  async update(id: string, update: SessionUpdate): Promise<SessionRecord | null> {
    const [row] = await this.#database
      .update(sessions)
      .set({ ...update, updatedAt: sql`now()` })
      .where(and(eq(sessions.workspaceId, UNAUTHENTICATED_WORKSPACE_ID), eq(sessions.id, id)))
      .returning()
    return row ? toSessionRecord(row) : null
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.#database
      .delete(sessions)
      .where(and(eq(sessions.workspaceId, UNAUTHENTICATED_WORKSPACE_ID), eq(sessions.id, id)))
      .returning({ id: sessions.id })
    return deleted.length > 0
  }

  async listMessages(sessionId: string): Promise<MessageRecord[]> {
    const rows = await this.#database
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt), asc(messages.id))
    return rows.map(toMessageRecord)
  }

  async createMessages(
    sessionId: string,
    requestId: string,
    content: string,
  ): Promise<CreateMessagesResult> {
    return this.#database.transaction(async (transaction) => {
      const now = new Date()
      const inserted = await transaction
        .insert(messages)
        .values([
          {
            sessionId,
            requestId,
            role: "user",
            content,
            status: "complete",
            createdAt: now,
            completedAt: now,
          },
          {
            sessionId,
            requestId,
            role: "assistant",
            content: "",
            status: "streaming",
            createdAt: new Date(now.getTime() + 1),
          },
        ])
        .onConflictDoNothing()
        .returning()

      const rows =
        inserted.length === 2
          ? inserted
          : await transaction
              .select()
              .from(messages)
              .where(and(eq(messages.sessionId, sessionId), eq(messages.requestId, requestId)))
      const user = rows.find((row) => row.role === "user")
      const assistant = rows.find((row) => row.role === "assistant")
      if (!user || !assistant) throw new Error("Idempotent chat insert is incomplete")
      if (user.content !== content) throw new ServiceError("IDEMPOTENCY_CONFLICT")
      return {
        assistantMessage: toMessageRecord(assistant),
        created: inserted.length === 2,
        userMessage: toMessageRecord(user),
      }
    })
  }

  async updateMessage(id: string, update: MessageUpdate): Promise<MessageRecord | null> {
    const [row] = await this.#database
      .update(messages)
      .set({ ...update, updatedAt: sql`now()` })
      .where(eq(messages.id, id))
      .returning()
    return row ? toMessageRecord(row) : null
  }

  async reconcileInterrupted(): Promise<void> {
    const now = new Date()
    await this.#database
      .update(sessions)
      .set({
        status: "failed",
        failureCode: "GENERATION_INTERRUPTED",
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(sessions.workspaceId, UNAUTHENTICATED_WORKSPACE_ID),
          ne(sessions.status, "complete"),
          ne(sessions.status, "failed"),
        ),
      )
    await this.#database
      .update(messages)
      .set({
        status: "failed",
        failureCode: "GENERATION_INTERRUPTED",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(messages.status, "streaming"))
  }
}
