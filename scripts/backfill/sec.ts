/**
 * Backfill SEC EDGAR filings for Figma.
 *
 *   tsx scripts/backfill/sec.ts [--limit N] [--cik 0001234567]
 *
 * Walks the EDGAR `submissions/CIK*.json` index for Figma back to the S-1
 * (April 2025). Pulls 10-K, 10-Q, 8-K, S-1, and Form 4 filings.
 *
 * CIK discovery: prefers a `FIGMA_CIK` constant imported from
 * `@/ingest/sec` if Phase 2A has shipped it. Otherwise queries the EDGAR
 * company-search JSON endpoint. CLI flag `--cik` overrides both.
 */

import { fetchAndParseForm4 } from "@/ingest/sec-form4";
import {
  classifyAndStore,
  ensureSource,
  insertBackfilledItem,
  parseFlags,
  sleep,
} from "./_common";

const USER_AGENT = "Claudy Simple Server (CSS) backfill personal use; contact: timgoh98@gmail.com";
const WANTED_FORMS = new Set(["10-K", "10-Q", "8-K", "S-1", "S-1/A", "4", "4/A"]);

type SubmissionsJson = {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription?: string[];
      reportDate?: string[];
    };
    files?: { name: string; filingCount: number; filingFrom: string; filingTo: string }[];
  };
};

async function discoverCik(): Promise<string | null> {
  try {
    const mod = (await import("@/ingest/sec")) as { FIGMA_CIK?: string | number; CIK?: string | number };
    const found = mod.FIGMA_CIK ?? mod.CIK;
    if (found) {
      return String(found).padStart(10, "0");
    }
  } catch {
    /* fall through to EDGAR lookup */
  }

  // EDGAR full-text company name search
  const url = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=figma&type=&dateb=&owner=include&count=40&output=atom";
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/atom+xml" } });
    if (!res.ok) {
      console.warn(`[backfill:sec] company search ${res.status}; will try a fallback`);
    } else {
      const text = await res.text();
      // Pick out the first CIK from the atom feed.
      const m = text.match(/CIK=(\d{10})/);
      if (m) return m[1];
    }
  } catch (err) {
    console.warn("[backfill:sec] company search threw:", err);
  }
  return null;
}

async function fetchSubmissions(cik10: string): Promise<SubmissionsJson> {
  const url = `https://data.sec.gov/submissions/CIK${cik10}.json`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`EDGAR submissions ${res.status} for ${cik10}`);
  return (await res.json()) as SubmissionsJson;
}

async function fetchSubmissionsFile(file: string): Promise<SubmissionsJson["filings"]["recent"]> {
  const url = `https://data.sec.gov/submissions/${file}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`EDGAR submissions file ${res.status} for ${file}`);
  const json = (await res.json()) as { accessionNumber: string[]; filingDate: string[]; form: string[]; primaryDocument: string[] };
  return json;
}

function filingUrl(cik10: string, accession: string, primaryDoc: string): string {
  const accNoDash = accession.replace(/-/g, "");
  const cikNum = String(Number.parseInt(cik10, 10));
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/${primaryDoc}`;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const limit = flags.limit ?? Number.POSITIVE_INFINITY;
  const explicit = flags.extra.cik ? String(flags.extra.cik).padStart(10, "0") : null;

  const cik = explicit ?? (await discoverCik());
  if (!cik) {
    console.error(
      "[backfill:sec] could not resolve Figma's CIK. Pass --cik=XXXXXXXXXX once it's known.",
    );
    process.exit(1);
  }
  console.log(`[backfill:sec] using CIK ${cik}`);

  const sourceId = await ensureSource({
    name: "SEC EDGAR (Figma)",
    kind: "sec",
    category: "core",
    configJson: { cik },
  });

  const submissions = await fetchSubmissions(cik);
  const buckets: { accessionNumber: string[]; filingDate: string[]; form: string[]; primaryDocument: string[] }[] = [
    submissions.filings.recent,
  ];
  for (const f of submissions.filings.files ?? []) {
    try {
      buckets.push(await fetchSubmissionsFile(f.name));
      await sleep(150); // be polite
    } catch (err) {
      console.warn(`[backfill:sec] skipping ${f.name}: ${err}`);
    }
  }

  let scanned = 0;
  let kept = 0;
  for (const bucket of buckets) {
    const n = bucket.accessionNumber.length;
    for (let i = 0; i < n; i++) {
      if (kept >= limit) break;
      scanned++;
      const form = bucket.form[i];
      if (!WANTED_FORMS.has(form)) continue;
      const accession = bucket.accessionNumber[i];
      const filingDate = bucket.filingDate[i];
      const primaryDoc = bucket.primaryDocument[i];
      const url = filingUrl(cik, accession, primaryDoc);
      let form4Extra: Record<string, unknown> = {};
      if (form === "4" || form === "4/A") {
        const parsed = await fetchAndParseForm4(url, USER_AGENT);
        await sleep(120); // SEC ≤10 req/s; stay well under
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
      const title = `${form} – Figma (${filingDate})`;
      const snippet = form4Extra.reporter_name
        ? `SEC ${form} filing, ${form4Extra.reporter_name}${form4Extra.reporter_role ? ` (${form4Extra.reporter_role})` : ""}, filed ${filingDate}.`
        : `SEC ${form} filing, accession ${accession}, filed ${filingDate}.`;
      const itemId = await insertBackfilledItem({
        sourceId,
        externalId: accession,
        url,
        title,
        snippet,
        publishedAt: new Date(`${filingDate}T00:00:00Z`),
        rawJson: {
          filing_type: form,
          accession,
          filing_date: filingDate,
          primary_document: primaryDoc,
          cik,
          ...form4Extra,
        },
      });
      if (itemId) {
        await classifyAndStore({
          itemId,
          title,
          snippet,
          url,
          sourceName: "SEC EDGAR (Figma)",
          sourceKind: "sec",
        });
        kept++;
      }
    }
    if (kept >= limit) break;
  }
  console.log(`[backfill:sec] done scanned=${scanned} inserted=${kept}`);
}

main().catch((err) => {
  console.error("[backfill:sec] failed:", err);
  process.exit(1);
});
