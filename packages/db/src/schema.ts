import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const sessionStatus = pgEnum("session_status", [
  "fetching",
  "extracting",
  "summarizing",
  "complete",
  "failed",
])

export const sessionStage = pgEnum("session_stage", ["fetching", "extracting", "summarizing"])
export const messageRole = pgEnum("message_role", ["user", "assistant"])
export const messageStatus = pgEnum("message_status", ["streaming", "complete", "failed"])

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    originalUrl: text("original_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    finalUrl: text("final_url"),
    host: text("host").notNull(),
    title: text("title"),
    siteName: text("site_name"),
    description: text("description"),
    sourceText: text("source_text").notNull().default(""),
    sourceHash: text("source_hash"),
    sourceWordCount: integer("source_word_count").notNull().default(0),
    sourceTruncated: boolean("source_truncated").notNull().default(false),
    summary: text("summary").notNull().default(""),
    tagline: text("tagline"),
    suggestedPrompts: jsonb("suggested_prompts").$type<string[]>().notNull().default([]),
    status: sessionStatus("status").notNull().default("fetching"),
    failureStage: sessionStage("failure_stage"),
    failureCode: text("failure_code"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    currentAttemptId: uuid("current_attempt_id").notNull().defaultRandom(),
    attemptNumber: integer("attempt_number").notNull().default(1),
    generationVersion: integer("generation_version").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_workspace_idempotency_key_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("sessions_workspace_created_id_index").on(
      table.workspaceId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
)

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull().defaultRandom(),
    role: messageRole("role").notNull(),
    content: text("content").notNull().default(""),
    reasoningContent: text("reasoning_content"),
    reasoningMs: integer("reasoning_ms"),
    status: messageStatus("status").notNull(),
    failureCode: text("failure_code"),
    provider: text("provider"),
    model: text("model"),
    currentAttemptId: uuid("current_attempt_id"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("messages_session_request_role_unique").on(
      table.sessionId,
      table.requestId,
      table.role,
    ),
    index("messages_session_created_id_index").on(table.sessionId, table.createdAt, table.id),
  ],
)
