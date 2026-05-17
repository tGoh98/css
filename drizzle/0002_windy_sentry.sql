CREATE TABLE "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"model" text NOT NULL,
	"item_id" integer,
	"source_kind" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_usage_job_idx" ON "ai_usage" USING btree ("job");