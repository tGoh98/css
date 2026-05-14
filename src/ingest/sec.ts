/**
 * SEC EDGAR poller for Figma, Inc.
 *
 * 1. Resolve Figma's CIK once (cached after first hit). We know it via the
 *    EDGAR company-search page: 0001579878 — but we also support
 *    re-resolving in case it ever changes.
 * 2. Pull the latest filings list from
 *    https://data.sec.gov/submissions/CIK{padded}.json
 * 3. Keep only 10-K / 10-Q / 8-K / S-1 / Form 4 (the user-facing categories
 *    that drive Official tab + Insider Activity widget).
 *
 * EDGAR REQUIRES a real, contactable User-Agent — anything missing/blank
 * is rate-limited or 403'd. We use the project-wide UA constant.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import { fetchWith, ensureSource, insertAndClassify, markPolled, emptyResult, USER_AGENT, type IngestResult } from "./_shared";
import { fetchAndParseForm4 } from "./sec-form4";

const FIGMA_CIK_FALLBACK = "0001579878"; // discovered via EDGAR company search
const KEPT_FORMS = new Set(["10-K", "10-Q", "8-K", "S-1", "S-1/A", "4", "4/A"]);

interface SubmissionsResponse {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

let cachedCik: string | null = null;

async function resolveFigmaCik(): Promise<string> {
  if (cachedCik) return cachedCik;

  // Try the JSON tickers index first — fast and structured.
  try {
    const res = await fetchWith("https://www.sec.gov/files/company_tickers.json");
    const data = (await res.json()) as Record<
      string,
      { cik_str: number; ticker: string; title: string }
    >;
    for (const v of Object.values(data)) {
      if (v.ticker === "FIG" || /\bfigma\b/i.test(v.title)) {
        cachedCik = String(v.cik_str).padStart(10, "0");
        return cachedCik;
      }
    }
  } catch {
    // fall through to fallback
  }

  cachedCik = FIGMA_CIK_FALLBACK;
  return cachedCik;
}

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();

  const sourceId = await ensureSource({
    name: "SEC EDGAR (Figma)",
    kind: "sec",
    category: "core",
    configJson: { tickers: ["FIG"], kept_forms: [...KEPT_FORMS] },
  });

  let cik: string;
  try {
    cik = await resolveFigmaCik();
  } catch (err) {
    result.errors.push(
      `sec: resolve CIK failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  let submissions: SubmissionsResponse;
  try {
    const res = await fetchWith(`https://data.sec.gov/submissions/CIK${cik}.json`);
    submissions = (await res.json()) as SubmissionsResponse;
  } catch (err) {
    result.errors.push(
      `sec: submissions fetch: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  const recent = submissions.filings?.recent;
  if (!recent) {
    result.errors.push("sec: no filings.recent in response");
    return result;
  }

  // Walk all of recent[] but skip already-ingested accessions BEFORE applying
  // the safety cap. Previous version applied the cap first then dedup'd, so a
  // fresh source row (or a 25-filing day) could permanently miss anything
  // past position 25. Now the cap only bites genuine new-filing backlog.
  // Cap exists to protect the 60s function budget — Form 4 XML fetch is the
  // most expensive per-item work, and 50 of those still fits.
  const SAFETY_CAP = 50;
  const CONCURRENCY = 6;

  const existing = await db
    .select({ externalId: items.externalId })
    .from(items)
    .where(eq(items.sourceId, sourceId));
  const existingIds = new Set(existing.map((r) => r.externalId));

  const candidates: Array<{
    accession: string; form: string; url: string; indexUrl: string;
    filingDate: string; description: string; primary: string;
  }> = [];
  let totalNewMatches = 0; // before truncation by SAFETY_CAP
  const n = recent.accessionNumber.length;
  for (let i = 0; i < n; i++) {
    const form = recent.form[i];
    if (!KEPT_FORMS.has(form)) continue;
    const accession = recent.accessionNumber[i];
    if (existingIds.has(accession)) continue;
    totalNewMatches += 1;
    if (candidates.length >= SAFETY_CAP) continue; // counted but not processed
    const accNoDash = accession.replace(/-/g, "");
    const primary = recent.primaryDocument[i] || `${accession}-index.htm`;
    candidates.push({
      accession,
      form,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNoDash}/${primary}`,
      indexUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNoDash}/${accession}-index.htm`,
      filingDate: recent.filingDate[i],
      description: recent.primaryDocDescription[i] ?? form,
      primary,
    });
  }

  if (totalNewMatches > SAFETY_CAP) {
    result.warnings.push(
      `sec: SATURATED — ${totalNewMatches} new EDGAR filings match KEPT_FORMS but only ${SAFETY_CAP} processed this tick; remaining ${totalNewMatches - SAFETY_CAP} will be picked up next tick (and re-dedup'd cheaply)`,
    );
  }

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (c) => {
        // candidates are pre-filtered against existingIds above, so every
        // entry here is genuinely new. Form 4 XML fetch always runs.
        let form4Extra: Record<string, unknown> = {};
        if (c.form === "4" || c.form === "4/A") {
          const parsed = await fetchAndParseForm4(c.url, USER_AGENT);
          if (parsed) {
            form4Extra = {
              reporter_name: parsed.reporter_name,
              reporter_role: parsed.reporter_role,
              is_director: parsed.is_director,
              is_officer: parsed.is_officer,
              is_ten_percent_owner: parsed.is_ten_percent_owner,
              transaction_code: parsed.transactions[0]?.code ?? null,
              transaction: parsed.direction,
              shares: parsed.net_shares,
              value: parsed.total_value,
              transactions: parsed.transactions,
            };
          }
        }
        await insertAndClassify(
          sourceId,
          "SEC EDGAR (Figma)",
          "sec",
          {
            externalId: c.accession,
            url: c.url,
            title: `${c.form} — ${c.description || submissions.name}`,
            snippet: form4Extra.reporter_name
              ? `Form ${c.form} filed ${c.filingDate}: ${form4Extra.reporter_name}${form4Extra.reporter_role ? ` (${form4Extra.reporter_role})` : ""}.`
              : `Form ${c.form} filed ${c.filingDate} by ${submissions.name}.`,
            publishedAt: new Date(`${c.filingDate}T00:00:00Z`),
            rawJson: {
              filing_type: c.form,
              accession: c.accession,
              filing_date: c.filingDate,
              primary_document: c.primary,
              index_url: c.indexUrl,
              cik,
              ...form4Extra,
            },
          },
          result,
        );
      }),
    );
  }

  await markPolled(sourceId);
  return result;
}
