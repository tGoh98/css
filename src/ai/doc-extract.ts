/**
 * Manual-upload document extractor.
 *
 * Single Sonnet 4.6 call: take a PDF (base64), detect what kind of document
 * it is (analyst report, earnings transcript, investor presentation, other),
 * and emit a common set of fields plus a few analyst-specific fields when
 * the doc IS an analyst report.
 *
 * Sonnet (not Haiku) because these PDFs are dense — multi-column layouts,
 * tables, charts inline — and we care about accurate metadata extraction.
 *
 * Anthropic's API natively accepts PDF document blocks (no client-side
 * parser needed). The model sees both rendered pages and extracted text.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const DOC_EXTRACTOR_MODEL = "claude-sonnet-4-6";

const DocType = z.enum([
  "analyst-report",
  "transcript",
  "presentation",
  "report",
  "other",
]);
export type DocType = z.infer<typeof DocType>;

const DocExtraction = z.object({
  doc_type: DocType,
  title: z.string().min(1).max(240),
  firm: z.string().max(160).nullable(),
  author: z.string().max(160).nullable(),
  date: z.string().nullable(), // ISO YYYY-MM-DD
  ticker: z.string().max(12).nullable(),
  sentiment: z.enum(["bullish", "neutral", "bearish", "n/a"]),
  summary: z.string().min(1).max(1200),
  key_points: z.array(z.string().max(280)).max(8),
  // Analyst-specific; nullable when doc_type !== 'analyst-report'.
  rating: z.string().max(60).nullable(),
  price_target: z.number().nonnegative().nullable(),
  target_currency: z.string().length(3).nullable(),
});

export type DocExtraction = z.infer<typeof DocExtraction>;

const SYSTEM_PROMPT = `You extract structured fields from a single uploaded PDF document. The user is tracking Figma, Inc. (NYSE: FIG) and its competitors, so most uploads will be FIG- or design-tools-related, but accept any topic.

First decide doc_type — what kind of document is this:
- "analyst-report": equity-research note from a firm like Morningstar, Goldman Sachs, JPMorgan, Argus, CFRA, MarketEdge, Seeking Alpha Pro, etc.
- "transcript": earnings call transcript, conference talk, podcast transcript, interview.
- "presentation": investor day deck, conference slides, S-1/IPO roadshow deck.
- "report": industry or market report from a research firm (Gartner, Forrester, IDC, Bain, BCG, McKinsey) or a long-form study.
- "other": doesn't fit the above (news article printout, blog post saved as PDF, internal memo, etc.).

Then emit:
- title: the document's own title verbatim if printed; otherwise synthesize a concise title like "Morningstar FIG analyst note (May 2026)" or "Figma Q1 2026 earnings call transcript".
- firm: the publishing organization (e.g. "Morningstar", "Goldman Sachs", "Gartner"). For an earnings transcript, use the company being reported on (e.g. "Figma, Inc."). Null if unclear.
- author: the named individual author / lead analyst / speaker. Null if not printed.
- date: ISO YYYY-MM-DD of the report / presentation / call date. Null if no date is visible.
- ticker: the primary stock ticker covered (e.g. "FIG"). Null if not stock-specific.
- sentiment: bullish if the doc frames the subject favorably; bearish if it argues against; neutral if balanced; "n/a" if not applicable (e.g. transcripts, descriptive reports).
- summary: one paragraph (max ~150 words) capturing what the document says. Neutral prose, no editorializing.
- key_points: 3-6 short bullets with the most important specific claims, numbers, or quotes. Each ≤ 280 chars.

If and only if doc_type === "analyst-report", also fill:
- rating: the firm's verbatim rating string (e.g. "Buy", "Outperform", "★★★★", "Hold"). Null if no rating.
- price_target: numeric value (e.g. 85.00). Null if no target.
- target_currency: ISO-4217 code (USD by default for US tickers). Null if no target.

For non-analyst doc_types, set rating, price_target, and target_currency to null.

Output ONLY by calling the \`emit\` tool. Do not write any prose response.`;

const EXTRACT_TOOL = {
  name: "emit",
  description: "Emit the structured fields for this document.",
  input_schema: {
    type: "object" as const,
    properties: {
      doc_type: {
        type: "string",
        enum: ["analyst-report", "transcript", "presentation", "report", "other"],
      },
      title: { type: "string" },
      firm: { type: ["string", "null"] },
      author: { type: ["string", "null"] },
      date: { type: ["string", "null"], description: "ISO YYYY-MM-DD" },
      ticker: { type: ["string", "null"] },
      sentiment: { type: "string", enum: ["bullish", "neutral", "bearish", "n/a"] },
      summary: { type: "string" },
      key_points: {
        type: "array",
        items: { type: "string" },
        maxItems: 8,
      },
      rating: { type: ["string", "null"] },
      price_target: { type: ["number", "null"] },
      target_currency: { type: ["string", "null"] },
    },
    required: [
      "doc_type",
      "title",
      "firm",
      "author",
      "date",
      "ticker",
      "sentiment",
      "summary",
      "key_points",
      "rating",
      "price_target",
      "target_currency",
    ],
    additionalProperties: false,
  },
};

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return cachedClient;
}

/**
 * Extract structured fields from a PDF.
 * `pdfBase64` must be the base64-encoded bytes (no data: prefix).
 */
export async function extractDocument(pdfBase64: string): Promise<DocExtraction> {
  const resp = await client().messages.create({
    model: DOC_EXTRACTOR_MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "emit" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            type: "text",
            text: "Detect the document type and extract fields via the emit tool.",
          },
        ],
      },
    ],
  });

  const toolBlock = resp.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("doc-extract: model did not call the emit tool");
  }
  return DocExtraction.parse(toolBlock.input);
}

/**
 * Source-row metadata for a given detected doc_type. Each doc_type gets its
 * own source row so per-source filtering on the Feed (and the Analyst tab's
 * kind-based query) work without special-casing.
 */
export function sourceForDocType(t: DocType): {
  name: string;
  kind: string;
} {
  switch (t) {
    case "analyst-report":
      return { name: "Analyst reports (manual upload)", kind: "analyst-report" };
    case "transcript":
      return { name: "Transcripts (manual upload)", kind: "transcript" };
    case "presentation":
      return { name: "Presentations (manual upload)", kind: "presentation" };
    case "report":
      return { name: "Research reports (manual upload)", kind: "report" };
    case "other":
      return { name: "Manual uploads (other)", kind: "upload" };
  }
}
