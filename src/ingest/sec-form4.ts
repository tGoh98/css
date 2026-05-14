/**
 * Form 4 (insider transaction) XML parser. Walks the canonical EDGAR
 * ownership document and pulls out reporter identity, role flags, and the
 * non-derivative transactions (the human-readable bought/sold rows).
 *
 * EDGAR rule of thumb: ≤10 req/s and a real, contactable User-Agent.
 * Callers should serialize and add a small delay.
 */
import * as cheerio from "cheerio";

export interface Form4Transaction {
  /** Single-letter SEC transaction code (P/S/A/D/F/M/G/J/C…). */
  code: string;
  shares: number | null;
  price_per_share: number | null;
  /** 'A' = acquired (purchase / grant), 'D' = disposed (sale / withholding). */
  acquired_disposed: "A" | "D" | null;
}

export interface Form4Parsed {
  reporter_name: string | null;
  reporter_role: string | null;
  is_director: boolean;
  is_officer: boolean;
  is_ten_percent_owner: boolean;
  transactions: Form4Transaction[];
  /** Sum of `shares` across transactions, weighted by direction sign. */
  net_shares: number | null;
  /** Sum of |shares × price| across all transactions. */
  total_value: number | null;
  /** Direction: 'purchase' if net acquired, 'sale' if net disposed, 'other' otherwise. */
  direction: "purchase" | "sale" | "other" | null;
}

/**
 * Form 4 primary docs from EDGAR come in two flavours:
 *   .../000.../xslF345X05/form4-….xml  (HTML-rendered via XSL)
 *   .../000.../form4-….xml             (raw XML)
 * The raw XML is the canonical source. Strip any `xslF345X[0-9]+/` prefix.
 */
export function rawXmlUrl(primaryDocUrl: string): string {
  return primaryDocUrl.replace(/\/xslF345X\d+\//, "/");
}

export async function fetchAndParseForm4(
  primaryDocUrl: string,
  userAgent: string,
): Promise<Form4Parsed | null> {
  const url = rawXmlUrl(primaryDocUrl);
  let xml: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: "application/xml,text/xml,*/*" },
    });
    if (!res.ok) return null;
    xml = await res.text();
  } catch {
    return null;
  }
  return parseForm4Xml(xml);
}

export function parseForm4Xml(xml: string): Form4Parsed | null {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(xml, { xmlMode: true });
  } catch {
    return null;
  }

  // We only handle the first reporting owner. Multi-reporter filings are rare;
  // when they happen, the first owner is usually the headline.
  const owner = $("reportingOwner").first();
  const reporter_name = owner.find("rptOwnerName").first().text().trim() || null;
  const officerTitle = owner.find("officerTitle").first().text().trim() || null;
  const is_director = owner.find("isDirector").first().text().trim() === "true" ||
    owner.find("isDirector").first().text().trim() === "1";
  const is_officer = owner.find("isOfficer").first().text().trim() === "true" ||
    owner.find("isOfficer").first().text().trim() === "1";
  const is_ten_percent_owner =
    owner.find("isTenPercentOwner").first().text().trim() === "true" ||
    owner.find("isTenPercentOwner").first().text().trim() === "1";

  let reporter_role = officerTitle;
  if (!reporter_role) {
    const roles: string[] = [];
    if (is_director) roles.push("Director");
    if (is_officer) roles.push("Officer");
    if (is_ten_percent_owner) roles.push("10% owner");
    reporter_role = roles.length ? roles.join(", ") : null;
  }

  const transactions: Form4Transaction[] = [];
  $("nonDerivativeTable nonDerivativeTransaction").each((_, el) => {
    const $t = $(el);
    const code = $t.find("transactionCoding transactionCode").first().text().trim();
    const shares = numText($t.find("transactionAmounts transactionShares value").first().text());
    const pps = numText($t.find("transactionAmounts transactionPricePerShare value").first().text());
    const ad = $t.find("transactionAmounts transactionAcquiredDisposedCode value").first().text().trim();
    transactions.push({
      code,
      shares,
      price_per_share: pps,
      acquired_disposed: ad === "A" || ad === "D" ? ad : null,
    });
  });

  // Aggregate
  let netShares = 0;
  let totalValue = 0;
  let hasShares = false;
  let acquiredShares = 0;
  let disposedShares = 0;
  for (const t of transactions) {
    if (t.shares != null) {
      hasShares = true;
      const sign = t.acquired_disposed === "D" ? -1 : 1;
      netShares += sign * t.shares;
      if (t.acquired_disposed === "A") acquiredShares += t.shares;
      else if (t.acquired_disposed === "D") disposedShares += t.shares;
      if (t.price_per_share != null) totalValue += t.shares * t.price_per_share;
    }
  }

  let direction: Form4Parsed["direction"] = null;
  if (acquiredShares > disposedShares) direction = "purchase";
  else if (disposedShares > acquiredShares) direction = "sale";
  else if (hasShares) direction = "other";

  return {
    reporter_name,
    reporter_role,
    is_director,
    is_officer,
    is_ten_percent_owner,
    transactions,
    net_shares: hasShares ? netShares : null,
    total_value: totalValue > 0 ? Math.round(totalValue) : null,
    direction,
  };
}

function numText(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
