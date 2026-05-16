/**
 * One-shot ingest for a list of documents (PDF or Word .docx) — same code
 * path as /admin/upload's uploadDocument server action, just driven from the
 * CLI so we can batch a folder of files without N round-trips through the
 * browser.
 *
 * Usage:
 *   npm exec tsx -- --env-file=.env.local scripts/ingest-pdfs.ts \
 *     /path/to/a.pdf /path/to/b.docx
 *
 * Skips files larger than 30 MB (Anthropic's document API caps at 32 MB).
 * Dedups by sha256 against items.external_id, so re-running on the same
 * folder is a free no-op for already-ingested files.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import {
  extractDocument,
  manualUploadSource,
  type DocExtraction,
} from "@/ai/doc-extract";
import { ensureSource, insertAndClassify, emptyResult } from "@/ingest/_shared";

const MAX_BYTES = 30 * 1024 * 1024;

function buildTitle(x: DocExtraction): string {
  if (x.doc_type === "analyst-report") {
    const ticker = x.ticker ? `${x.ticker} ` : "";
    const rating = x.rating ?? "n/a";
    const pt =
      x.price_target != null
        ? `, ${x.target_currency ?? "USD"} ${x.price_target.toFixed(2)} PT`
        : "";
    return `${x.firm ?? "Analyst"}: ${ticker}${rating}${pt}`.trim();
  }
  return x.title;
}

function buildSnippet(x: DocExtraction): string {
  const points = x.key_points.length > 0 ? `\n\n• ${x.key_points.join("\n• ")}` : "";
  return `${x.summary}${points}`;
}

function parseDocDate(s: string | null): Date {
  if (!s) return new Date();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return new Date();
}

async function ingestOne(path: string): Promise<void> {
  const filename = basename(path);
  let size: number;
  try {
    size = statSync(path).size;
  } catch (err) {
    console.log(`[skip] ${filename}: stat failed (${err instanceof Error ? err.message : err})`);
    return;
  }
  if (size > MAX_BYTES) {
    console.log(`[skip] ${filename}: ${(size / 1024 / 1024).toFixed(1)} MB exceeds ${MAX_BYTES / 1024 / 1024} MB cap`);
    return;
  }

  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const externalId = `sha256:${sha256}`;

  const dup = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.externalId, externalId))
    .limit(1);
  if (dup.length > 0) {
    console.log(`[dedup] ${filename} (${(size / 1024).toFixed(0)} KB) → existing item id ${dup[0].id}`);
    return;
  }

  let extraction: DocExtraction;
  try {
    extraction = await extractDocument(bytes, filename);
  } catch (err) {
    console.log(`[error] ${filename}: extract failed — ${err instanceof Error ? err.message : err}`);
    return;
  }

  const { name: sourceName, kind: sourceKind } = manualUploadSource();
  const sourceId = await ensureSource({
    name: sourceName,
    kind: sourceKind,
    category: "core",
    configJson: { mode: "manual-upload", docType: extraction.doc_type },
  });

  const title = buildTitle(extraction);
  const snippet = buildSnippet(extraction);

  const result = emptyResult();
  await insertAndClassify(
    sourceId,
    sourceName,
    sourceKind,
    {
      externalId,
      url: `upload:${sha256}`,
      title,
      snippet,
      fullText: `${extraction.summary}\n\n${extraction.key_points.join("\n")}`,
      author: extraction.author ?? null,
      publishedAt: parseDocDate(extraction.date),
      rawJson: {
        extraction,
        upload: {
          filename,
          bytes: size,
          sha256,
          uploadedAt: new Date().toISOString(),
          uploadedBy: "ingest-pdfs.ts",
        },
      },
    },
    result,
  );

  // Read back the row to get the id (insertAndClassify doesn't return it).
  const inserted = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.externalId, externalId))
    .limit(1);

  const dt = extraction.doc_type;
  const dateStr = extraction.date ?? "unknown date";
  const errs = result.errors.length > 0 ? ` (errors: ${result.errors.join("; ")})` : "";
  console.log(
    `[ok]   ${filename}: id=${inserted[0]?.id ?? "?"} doc_type=${dt} date=${dateStr} "${title.slice(0, 60)}"${errs}`,
  );
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("usage: ingest-pdfs.ts <file1.pdf> [file2.pdf ...]");
    process.exit(2);
  }
  console.log(`Ingesting ${paths.length} file(s)...`);
  for (const p of paths) {
    await ingestOne(p);
  }
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
  });
