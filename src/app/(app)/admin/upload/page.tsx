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
import { type DocExtraction } from "@/ai/doc-extract";

export const dynamic = "force-dynamic";

// All manual uploads route to a single source with kind="upload"
// (see manualUploadSource in src/ai/doc-extract.ts). The historical per-doc-type
// kinds aren't included here — there are no remaining items in those source
// rows after the 2026-05-14 consolidation.
const UPLOAD_KINDS = ["upload"] as const;

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
        <h1 className="text-xl font-semibold tracking-tight">Manual uploads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ingest is <span className="font-medium">local-only</span> — document
          extraction runs through the local Claude Code CLI (Max-plan capacity,
          no API cost), so the deployed app cannot ingest documents. PDF and
          Word <code>.docx</code> are supported. From the owner&apos;s Mac:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
          npm exec tsx -- --env-file=.env.local scripts/ingest-pdfs.ts
          /path/to/a.pdf /path/to/b.docx
        </pre>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is now read-only for managing what&apos;s already ingested.
          The original file is <span className="font-medium">not stored</span> —
          only the extraction.
        </p>
      </div>

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
