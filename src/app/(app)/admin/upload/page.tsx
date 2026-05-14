import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { items, sources } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isAdminUsername } from "@/lib/env";
import {
  extractDocument,
  sourceForDocType,
  type DocExtraction,
} from "@/ai/doc-extract";
import { ensureSource, insertAndClassify, emptyResult } from "@/ingest/_shared";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
const UPLOAD_KINDS = [
  "analyst-report",
  "transcript",
  "presentation",
  "report",
  "upload",
] as const;

async function requireAdmin(): Promise<void> {
  const session = await auth();
  const username = (session?.user as { username?: string } | undefined)?.username;
  if (!isAdminUsername(username)) notFound();
}

type UploadRawJson = {
  extraction: DocExtraction;
  upload: {
    filename: string;
    bytes: number;
    sha256: string;
    uploadedAt: string;
    uploadedBy?: string;
  };
};

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
  // For other types, prefer the doc's own title verbatim.
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

async function uploadDocument(formData: FormData): Promise<void> {
  "use server";
  await requireAdmin();
  const session = await auth();
  const uploadedBy = (session?.user as { username?: string } | undefined)?.username;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Please choose a PDF file to upload.");
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error(`Only PDF files are supported (got ${file.type || "unknown"}).`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error(
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const b64 = bytes.toString("base64");

  // De-dup by content hash *before* the Sonnet call, so re-uploading the
  // same PDF is free.
  const externalId = `sha256:${sha256}`;
  const dup = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.externalId, externalId))
    .limit(1);
  if (dup.length > 0) {
    revalidatePath("/admin/upload");
    revalidatePath("/analyst");
    revalidatePath("/feed");
    return;
  }

  const extraction = await extractDocument(b64);
  const { name: sourceName, kind: sourceKind } = sourceForDocType(extraction.doc_type);
  const sourceId = await ensureSource({
    name: sourceName,
    kind: sourceKind,
    category: "core",
    configJson: { mode: "manual-upload", docType: extraction.doc_type },
  });

  const title = buildTitle(extraction);
  const snippet = buildSnippet(extraction);
  const rawJson: UploadRawJson = {
    extraction,
    upload: {
      filename: file.name,
      bytes: file.size,
      sha256,
      uploadedAt: new Date().toISOString(),
      uploadedBy,
    },
  };

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
      rawJson: rawJson as unknown as Record<string, unknown>,
    },
    result,
  );

  if (result.errors.length > 0) {
    throw new Error(`Upload classified with errors: ${result.errors.join("; ")}`);
  }

  revalidatePath("/admin/upload");
  revalidatePath("/analyst");
  revalidatePath("/feed");
}

async function deleteUpload(formData: FormData): Promise<void> {
  "use server";
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  await db.delete(items).where(eq(items.id, id));
  revalidatePath("/admin/upload");
  revalidatePath("/analyst");
  revalidatePath("/feed");
}

async function listUploads() {
  return db
    .select({
      id: items.id,
      title: items.title,
      author: items.author,
      publishedAt: items.publishedAt,
      rawJson: items.rawJson,
      sourceKind: sources.kind,
      sourceName: sources.name,
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        eq(sources.category, "core"),
        inArray(sources.kind, UPLOAD_KINDS as unknown as string[]),
      ),
    )
    .orderBy(desc(items.publishedAt))
    .limit(200);
}

function describeAnalyst(x: DocExtraction | undefined): string {
  if (!x || x.doc_type !== "analyst-report") return "";
  const r = x.rating ?? "n/a";
  const pt =
    x.price_target != null
      ? ` · ${x.target_currency ?? "USD"} ${x.price_target.toFixed(2)}`
      : "";
  return `${r}${pt}`;
}

export default async function UploadAdminPage() {
  await requireAdmin();
  const rows = await listUploads();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Manual upload</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop any PDF — analyst report, earnings transcript, investor deck,
          industry research, conference talk. Sonnet detects the document type
          and extracts title / author / date / summary / key points (plus
          rating &amp; price target for analyst reports), then routes it into
          the appropriate feed. The original PDF is{" "}
          <span className="font-medium">not stored</span> — only the extraction.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload a document</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={uploadDocument}
            encType="multipart/form-data"
            className="grid gap-3"
          >
            <label className="grid gap-1 text-xs">
              <span className="font-medium">PDF file</span>
              <input
                type="file"
                name="file"
                accept="application/pdf,.pdf"
                required
                className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-accent file:px-2 file:py-1 file:text-xs file:font-medium"
              />
              <span className="text-muted-foreground">
                Max {MAX_BYTES / 1024 / 1024} MB per file. PDFs only.
              </span>
            </label>
            <div>
              <Button type="submit" size="sm">
                Upload &amp; extract
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uploaded ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No uploads yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => {
                const raw = (r.rawJson ?? {}) as Partial<UploadRawJson>;
                const x = raw.extraction;
                const filename = raw.upload?.filename ?? "—";
                const analystLine = describeAnalyst(x);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {filename}
                        {r.author ? ` · ${r.author}` : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        {x?.doc_type ?? r.sourceKind}
                      </Badge>
                      {analystLine && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {analystLine}
                        </div>
                      )}
                      {x?.firm && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {x.firm}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.publishedAt).toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={deleteUpload} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                        >
                          Delete
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
