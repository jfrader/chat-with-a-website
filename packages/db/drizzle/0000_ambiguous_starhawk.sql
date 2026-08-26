CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('streaming', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."session_stage" AS ENUM('fetching', 'extracting', 'summarizing');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('fetching', 'extracting', 'summarizing', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" "message_status" NOT NULL,
	"failure_code" text,
	"provider" text,
	"model" text,
	"current_attempt_id" uuid,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"original_url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"final_url" text,
	"host" text NOT NULL,
	"title" text,
	"site_name" text,
	"description" text,
	"source_text" text DEFAULT '' NOT NULL,
	"source_hash" text,
	"source_word_count" integer DEFAULT 0 NOT NULL,
	"source_truncated" boolean DEFAULT false NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" "session_status" DEFAULT 'fetching' NOT NULL,
	"failure_stage" "session_stage",
	"failure_code" text,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"current_attempt_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_session_created_id_index" ON "messages" USING btree ("session_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_workspace_idempotency_key_unique" ON "sessions" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "sessions_workspace_created_id_index" ON "sessions" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);