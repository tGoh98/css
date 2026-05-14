/**
 * Email notifier — sends breaking-item alerts and digest emails via Resend.
 *
 * Imported lazily by the ingest pipeline (Phase 2A) and the digest webhook
 * (this phase). All failures are caught and logged so a flaky email transport
 * never breaks ingest.
 */

import { and, eq } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db";
import {
  digests,
  itemClassifications,
  items,
  notificationChannels,
  notificationsSent,
  sources,
} from "@/db/schema";

type EmailChannel = {
  id: number;
  to: string;
};

function resendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[notify] RESEND_API_KEY not set; skipping send");
    return null;
  }
  return new Resend(key);
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
}

function fallbackTo(): string | null {
  return process.env.RESEND_TO_EMAIL || null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Cheap, dependency-free Markdown → HTML for digests. Handles headings, bold,
 * italics, inline code, links, lists, and paragraphs. Good enough for an email
 * body produced by Sonnet.
 */
function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  const inline = (s: string): string => {
    let r = escapeHtml(s);
    r = r.replace(/`([^`]+)`/g, "<code>$1</code>");
    r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    r = r.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return r;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      closeLists();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph();
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph();
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeLists();
  return out.join("\n");
}

async function enabledEmailChannels(): Promise<EmailChannel[]> {
  const rows = await db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.kind, "email"), eq(notificationChannels.enabled, true)));

  const channels: EmailChannel[] = [];
  for (const r of rows) {
    const cfg = (r.configJson ?? {}) as { to?: string };
    const to = cfg.to ?? fallbackTo();
    if (!to) {
      console.warn(`[notify] email channel ${r.id} has no 'to' address; skipping`);
      continue;
    }
    channels.push({ id: r.id, to });
  }
  return channels;
}

async function alreadySent(itemId: number, channelId: number): Promise<boolean> {
  const rows = await db
    .select({ itemId: notificationsSent.itemId })
    .from(notificationsSent)
    .where(
      and(eq(notificationsSent.itemId, itemId), eq(notificationsSent.channelId, channelId)),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Notify enabled email channels about a breaking item. Deduplicates against
 * `notifications_sent`. Never throws — failures are logged.
 */
export async function notifyBreaking(itemId: string | number): Promise<void> {
  const id = typeof itemId === "string" ? Number.parseInt(itemId, 10) : itemId;
  if (!Number.isFinite(id)) {
    console.error(`[notify] notifyBreaking: invalid itemId ${itemId}`);
    return;
  }
  try {
    const [row] = await db
      .select({
        item: items,
        classification: itemClassifications,
        source: sources,
      })
      .from(items)
      .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
      .leftJoin(sources, eq(sources.id, items.sourceId))
      .where(eq(items.id, id))
      .limit(1);

    if (!row?.item) {
      console.warn(`[notify] notifyBreaking: item ${id} not found`);
      return;
    }

    // Historical items must never page the user — backfill jobs flag them.
    if (row.item.backfilled) {
      return;
    }

    const channels = await enabledEmailChannels();
    if (channels.length === 0) {
      console.log("[notify] notifyBreaking: no enabled email channels");
      return;
    }

    const resend = resendClient();
    const title = row.item.title;
    const sourceName = row.source?.name ?? "unknown source";
    const oneLine = row.classification?.oneLine ?? row.item.snippet ?? "";
    const subject = `[CSS Breaking] ${title}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5;">
        <p style="margin: 0 0 12px;">
          <span style="display:inline-block; padding:2px 8px; border-radius:4px; background:#fee2e2; color:#991b1b; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">Breaking</span>
          <span style="margin-left:8px; padding:2px 8px; border-radius:4px; background:#eef2ff; color:#3730a3; font-size:11px; font-weight:600;">${escapeHtml(sourceName)}</span>
        </p>
        <h2 style="margin: 0 0 8px; font-size:18px;">${escapeHtml(title)}</h2>
        ${oneLine ? `<p style="margin: 0 0 16px; color:#374151;">${escapeHtml(oneLine)}</p>` : ""}
        <p style="margin: 0;"><a href="${escapeHtml(row.item.url)}" style="color:#2563eb;">Open source &rarr;</a></p>
      </div>
    `;
    const text = `[CSS Breaking] ${title}\n\n${oneLine}\n\nSource: ${sourceName}\n${row.item.url}\n`;

    for (const channel of channels) {
      try {
        if (await alreadySent(id, channel.id)) {
          continue;
        }
        if (resend) {
          const result = await resend.emails.send({
            from: fromAddress(),
            to: channel.to,
            subject,
            html,
            text,
          });
          if (result.error) {
            console.error(`[notify] resend error for item ${id} channel ${channel.id}:`, result.error);
            continue;
          }
        } else {
          console.log(`[notify] (dry-run, no key) would send breaking to ${channel.to}: ${subject}`);
        }
        await db
          .insert(notificationsSent)
          .values({ itemId: id, channelId: channel.id })
          .onConflictDoNothing();
      } catch (innerErr) {
        console.error(`[notify] failed to notify channel ${channel.id} for item ${id}:`, innerErr);
      }
    }
  } catch (err) {
    console.error(`[notify] notifyBreaking(${id}) failed:`, err);
  }
}

/**
 * Notify enabled email channels that one or more ingest sources hit their
 * per-tick saturation cap — older items in the upstream feed were likely not
 * fetched. Fire-and-forget; never throws. No per-tick dedup; the route handler
 * already aggregates warnings into a single call.
 */
export async function notifyIngestSaturation(
  source: string,
  warnings: string[],
): Promise<void> {
  if (warnings.length === 0) return;
  try {
    const channels = await enabledEmailChannels();
    if (channels.length === 0) {
      console.log(`[notify] saturation in ${source}: no enabled email channels`);
      return;
    }

    const resend = resendClient();
    const subject = `[CSS Saturation] ${source} — ${warnings.length} source(s) at cap`;
    const text = `Ingest tick "${source}" reported saturation. Older items in one or more upstream feeds were not fetched this tick.\n\n${warnings.map((w) => `- ${w}`).join("\n")}\n\nThis usually means a news spike (e.g. earnings) pushed items past the per-tick cap. Items may be lost if the next tick can't catch up before the feed shifts further. Consider running a manual catch-up via /api/cron/ingest/<source> or raising MAX_ITEMS_*.\n`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5;">
        <p style="margin: 0 0 12px;">
          <span style="display:inline-block; padding:2px 8px; border-radius:4px; background:#fef3c7; color:#92400e; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">Saturation</span>
          <span style="margin-left:8px; padding:2px 8px; border-radius:4px; background:#eef2ff; color:#3730a3; font-size:11px; font-weight:600;">${escapeHtml(source)}</span>
        </p>
        <p style="margin: 0 0 12px;">Older items in one or more upstream feeds were not fetched this tick.</p>
        <ul style="margin: 0 0 12px; padding-left: 20px;">
          ${warnings.map((w) => `<li style="margin-bottom:4px;">${escapeHtml(w)}</li>`).join("")}
        </ul>
        <p style="margin: 0; color:#6b7280; font-size:13px;">
          Likely a news spike (e.g. earnings) pushed items past the per-tick cap.
          Items may be lost if the next tick can't catch up before the feed shifts further.
        </p>
      </div>
    `;

    for (const channel of channels) {
      try {
        if (resend) {
          const sent = await resend.emails.send({
            from: fromAddress(),
            to: channel.to,
            subject,
            html,
            text,
          });
          if (sent.error) {
            console.error(
              `[notify] saturation send failed for channel ${channel.id}:`,
              sent.error,
            );
          }
        } else {
          console.log(
            `[notify] (dry-run, no key) would send saturation to ${channel.to}: ${subject}`,
          );
        }
      } catch (innerErr) {
        console.error(
          `[notify] failed to notify channel ${channel.id} (saturation):`,
          innerErr,
        );
      }
    }
  } catch (err) {
    console.error(`[notify] notifyIngestSaturation(${source}) failed:`, err);
  }
}

/**
 * Notify enabled email channels about a newly-published digest. Does not
 * deduplicate per-channel (digests are intentionally re-sent if the worker
 * regenerates them); the caller controls invocation cadence.
 */
export async function notifyDigest(digestId: string | number): Promise<void> {
  const id = typeof digestId === "string" ? Number.parseInt(digestId, 10) : digestId;
  if (!Number.isFinite(id)) {
    console.error(`[notify] notifyDigest: invalid digestId ${digestId}`);
    return;
  }
  try {
    const [digest] = await db.select().from(digests).where(eq(digests.id, id)).limit(1);
    if (!digest) {
      console.warn(`[notify] notifyDigest: digest ${id} not found`);
      return;
    }
    if (!digest.summaryMd) {
      console.warn(`[notify] notifyDigest: digest ${id} has no summary_md yet; skipping`);
      return;
    }

    const channels = await enabledEmailChannels();
    if (channels.length === 0) {
      console.log("[notify] notifyDigest: no enabled email channels");
      return;
    }

    const resend = resendClient();
    const periodStart = digest.periodStart.toISOString().slice(0, 10);
    const subject = `[CSS Digest] ${digest.period} – ${periodStart}`;
    const bodyHtml = markdownToHtml(digest.summaryMd);
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.55; max-width: 640px;">
        <p style="margin: 0 0 16px; color:#6b7280; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">CSS ${escapeHtml(digest.period)} digest · ${escapeHtml(periodStart)}</p>
        ${bodyHtml}
      </div>
    `;

    for (const channel of channels) {
      try {
        if (resend) {
          const result = await resend.emails.send({
            from: fromAddress(),
            to: channel.to,
            subject,
            html,
            text: digest.summaryMd,
          });
          if (result.error) {
            console.error(`[notify] resend error for digest ${id} channel ${channel.id}:`, result.error);
            continue;
          }
        } else {
          console.log(`[notify] (dry-run, no key) would send digest to ${channel.to}: ${subject}`);
        }
      } catch (innerErr) {
        console.error(`[notify] failed to notify channel ${channel.id} for digest ${id}:`, innerErr);
      }
    }
  } catch (err) {
    console.error(`[notify] notifyDigest(${id}) failed:`, err);
  }
}
