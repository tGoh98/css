CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"summary_md" text,
	"item_ids" integer[] DEFAULT '{}'::int[] NOT NULL,
	"model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_classifications" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"relevance" numeric(4, 3) NOT NULL,
	"priority" text NOT NULL,
	"one_line" text NOT NULL,
	"classifier_model" text NOT NULL,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"representative_title" text NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_notes" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"snippet" text,
	"full_text" text,
	"author" text,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_json" jsonb,
	"cluster_id" integer,
	"backfilled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications_sent" (
	"item_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_sent_item_id_channel_id_pk" PRIMARY KEY("item_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_polled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	"github_id" text,
	"github_username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"match_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_classifications" ADD CONSTRAINT "item_classifications_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_notes" ADD CONSTRAINT "item_notes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "digests_period_start_unique" ON "digests" USING btree ("period","period_start");--> statement-breakpoint
CREATE INDEX "item_classifications_priority_idx" ON "item_classifications" USING btree ("priority");--> statement-breakpoint
CREATE UNIQUE INDEX "items_source_external_unique" ON "items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "items_published_at_idx" ON "items" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "items_source_published_idx" ON "items" USING btree ("source_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "items_cluster_idx" ON "items" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "items_fts_idx" ON "items" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("snippet", '') || ' ' || coalesce("full_text", '')));