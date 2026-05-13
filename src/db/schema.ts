import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---------------------------------------------------------------------------
// Domain tables (per docs/ARCHITECTURE.md → Data model)
// ---------------------------------------------------------------------------

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'news'|'sec'|'blog'|'reddit'|'hn'|'competitor-news'|'competitor-blog'
  category: text("category").notNull(), // 'core'|'competitor'
  configJson: jsonb("config_json").$type<Record<string, unknown>>().default({}).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
});

export const items = pgTable(
  "items",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    snippet: text("snippet"),
    fullText: text("full_text"),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    rawJson: jsonb("raw_json").$type<Record<string, unknown>>(),
    clusterId: integer("cluster_id"),
    backfilled: boolean("backfilled").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("items_source_external_unique").on(table.sourceId, table.externalId),
    index("items_published_at_idx").on(table.publishedAt.desc()),
    index("items_source_published_idx").on(table.sourceId, table.publishedAt.desc()),
    index("items_cluster_idx").on(table.clusterId),
    // GIN index for Postgres full-text search across title + snippet + full_text.
    index("items_fts_idx").using(
      "gin",
      sql`to_tsvector('english', coalesce(${table.title}, '') || ' ' || coalesce(${table.snippet}, '') || ' ' || coalesce(${table.fullText}, ''))`,
    ),
  ],
);

export const itemClassifications = pgTable(
  "item_classifications",
  {
    itemId: integer("item_id")
      .primaryKey()
      .references(() => items.id, { onDelete: "cascade" }),
    relevance: numeric("relevance", { precision: 4, scale: 3 }).notNull(),
    priority: text("priority").notNull(), // 'routine'|'notable'|'breaking'
    oneLine: text("one_line").notNull(),
    classifierModel: text("classifier_model").notNull(),
    classifiedAt: timestamp("classified_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("item_classifications_priority_idx").on(table.priority)],
);

export const itemClusters = pgTable("item_clusters", {
  id: serial("id").primaryKey(),
  representativeTitle: text("representative_title").notNull(),
  itemCount: integer("item_count").default(0).notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const digests = pgTable(
  "digests",
  {
    id: serial("id").primaryKey(),
    period: text("period").notNull(), // 'day'|'week'|'month'
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    summaryMd: text("summary_md"),
    itemIds: integer("item_ids").array().notNull().default(sql`'{}'::int[]`),
    model: text("model"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("digests_period_start_unique").on(table.period, table.periodStart)],
);

export const watchlists = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'person'|'topic'|'keyword'
  matchConfigJson: jsonb("match_config_json").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bookmarks = pgTable("bookmarks", {
  itemId: integer("item_id")
    .primaryKey()
    .references(() => items.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const itemNotes = pgTable("item_notes", {
  itemId: integer("item_id")
    .primaryKey()
    .references(() => items.id, { onDelete: "cascade" }),
  bodyMd: text("body_md").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notificationChannels = pgTable("notification_channels", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // 'email'|'slack'|'discord'
  configJson: jsonb("config_json").$type<Record<string, unknown>>().default({}).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
});

export const notificationsSent = pgTable(
  "notifications_sent",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.channelId] })],
);

// ---------------------------------------------------------------------------
// Auth.js / NextAuth tables (DrizzleAdapter spec)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  // Domain extensions: GitHub identity captured at sign-in for the allowlist.
  githubId: text("github_id"),
  githubUsername: text("github_username"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);
