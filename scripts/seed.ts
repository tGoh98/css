/**
 * Seed script — populates baseline rows the app needs to be useful on day one.
 *
 *   tsx scripts/seed.ts
 *
 * Idempotent: every insert is "if not exists". Safe to re-run.
 *
 * What it seeds:
 *   1. Sources (delegates to Phase 2A's seedSources if present).
 *   2. Watchlists for people (Dylan Field + Figma exec team) and topics.
 *   3. One enabled email notification channel pointing at RESEND_TO_EMAIL.
 *
 * Per ARCHITECTURE.md "Pre-seed defaults (people, topics, competitors, subs)".
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationChannels, watchlists } from "@/db/schema";

type WatchlistSeed = {
  name: string;
  kind: "person" | "topic" | "keyword";
  matchConfigJson: Record<string, unknown>;
};

// NOTE: Names below are seed defaults — Dylan Field is confirmed CEO of Figma.
// The CFO entry is a placeholder ("Praveer Melwani" appears in some published
// reporting but should be VERIFIED against the live S-1 / 10-K before relying
// on it). The "Figma exec team" topic-level watchlist catches anyone we miss.
const PEOPLE: WatchlistSeed[] = [
  {
    name: "Dylan Field",
    kind: "person",
    matchConfigJson: {
      role: "CEO",
      keywords: ["Dylan Field", "Field"],
    },
  },
  {
    name: "Praveer Melwani",
    kind: "person",
    matchConfigJson: {
      role: "CFO",
      // Placeholder — verify the actual CFO name against the live S-1.
      verified: false,
      keywords: ["Praveer Melwani", "Melwani", "Figma CFO"],
    },
  },
  {
    name: "Figma exec team",
    kind: "topic",
    matchConfigJson: {
      keywords: [
        "Figma executive",
        "Figma CFO",
        "Figma COO",
        "Figma CTO",
        "Figma CPO",
        "chief revenue officer",
        "VP engineering",
      ],
    },
  },
];

const TOPICS: WatchlistSeed[] = [
  {
    name: "AI features",
    kind: "topic",
    matchConfigJson: {
      keywords: ["AI", "Make", "Figma AI", "generative", "Sites", "Slides AI"],
    },
  },
  {
    name: "acquisitions",
    kind: "topic",
    matchConfigJson: {
      keywords: ["acquires", "acquisition", "buys", "M&A", "deal"],
    },
  },
  {
    name: "pricing",
    kind: "topic",
    matchConfigJson: {
      keywords: ["pricing", "seat", "subscription", "tier", "plan"],
    },
  },
  {
    name: "enterprise",
    kind: "topic",
    matchConfigJson: {
      keywords: ["enterprise", "Fortune", "rollout", "ELA", "procurement"],
    },
  },
];

async function trySeedSources(): Promise<void> {
  // Use a variable specifier so TS doesn't try to resolve the optional module
  // at typecheck time. Phase 2A may or may not have shipped this yet.
  const specifier = "@/db/seed-sources";
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
    const fn = mod.seedSources as (() => Promise<void>) | undefined;
    if (typeof fn === "function") {
      await fn();
      console.log("[seed] sources seeded via @/db/seed-sources");
    } else {
      console.warn(
        "[seed] @/db/seed-sources resolved but did not export seedSources(); skipping",
      );
    }
  } catch (err) {
    console.warn(
      "[seed] @/db/seed-sources not available yet (Phase 2A still writing it); skipping. " +
        "Re-run `npm run seed` once it lands.",
      err instanceof Error ? `(${err.message})` : "",
    );
  }
}

async function upsertWatchlist(seed: WatchlistSeed): Promise<void> {
  const existing = await db
    .select({ id: watchlists.id })
    .from(watchlists)
    .where(and(eq(watchlists.kind, seed.kind), eq(watchlists.name, seed.name)))
    .limit(1);
  if (existing.length > 0) {
    console.log(`[seed] watchlist "${seed.name}" already exists`);
    return;
  }
  await db.insert(watchlists).values({
    name: seed.name,
    kind: seed.kind,
    matchConfigJson: seed.matchConfigJson,
  });
  console.log(`[seed] watchlist "${seed.name}" inserted`);
}

async function seedNotificationChannel(): Promise<void> {
  const to = process.env.RESEND_TO_EMAIL;
  if (!to) {
    console.warn(
      "[seed] RESEND_TO_EMAIL not set; inserting an email channel with no destination — set it in .env.local",
    );
  }
  // Match on kind='email' AND the same `to` address inside config_json.
  const existing = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.kind, "email"));
  const dupe = existing.find((row) => {
    const cfg = (row.configJson ?? {}) as { to?: string };
    return cfg.to === to;
  });
  if (dupe) {
    console.log(`[seed] notification channel for ${to ?? "(no email)"} already exists`);
    if (!dupe.enabled) {
      await db
        .update(notificationChannels)
        .set({ enabled: true })
        .where(eq(notificationChannels.id, dupe.id));
      console.log(`[seed] re-enabled notification channel ${dupe.id}`);
    }
    return;
  }
  await db.insert(notificationChannels).values({
    kind: "email",
    enabled: true,
    configJson: { to: to ?? null },
  });
  console.log(`[seed] notification channel inserted for ${to ?? "(no email)"}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[seed] DATABASE_URL not set");
    process.exit(1);
  }

  await trySeedSources();

  for (const w of [...PEOPLE, ...TOPICS]) {
    await upsertWatchlist(w);
  }

  await seedNotificationChannel();

  console.log("[seed] done");
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
