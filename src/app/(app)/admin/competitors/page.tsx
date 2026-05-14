import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isAdminUsername } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Non-owners get a 404 — don't leak that the route even exists. */
async function requireAdmin(): Promise<void> {
  const session = await auth();
  const username = (session?.user as { username?: string } | undefined)?.username;
  if (!isAdminUsername(username)) notFound();
}

type CompetitorConfig = {
  method?: "google-news" | "rss" | "github-releases";
  brand?: string;
  query?: string;
  feedUrl?: string;
  repo?: string;
  [k: string]: unknown;
};

async function listCompetitors() {
  return db
    .select()
    .from(sources)
    .where(eq(sources.category, "competitor"))
    .orderBy(sources.name);
}

async function addCompetitor(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim();
  const brand = String(formData.get("brand") ?? name).trim();
  const query = String(formData.get("query") ?? "").trim();
  const feedUrl = String(formData.get("feedUrl") ?? "").trim();
  const repo = String(formData.get("repo") ?? "").trim();

  if (!name) throw new Error("name is required");
  if (!["google-news", "rss", "github-releases"].includes(method)) {
    throw new Error(`invalid method: ${method}`);
  }

  const kind = method === "google-news" ? "competitor-news" : "competitor-blog";
  const cfg: CompetitorConfig = {
    method: method as CompetitorConfig["method"],
    brand,
  };
  if (method === "google-news") {
    if (!query) throw new Error("query required for google-news");
    cfg.query = query;
  } else if (method === "rss") {
    if (!feedUrl) throw new Error("feedUrl required for rss");
    cfg.feedUrl = feedUrl;
  } else if (method === "github-releases") {
    if (!repo) throw new Error("repo required (e.g. owner/repo)");
    cfg.repo = repo;
  }

  await db.insert(sources).values({
    name,
    kind,
    category: "competitor",
    configJson: cfg as unknown as Record<string, unknown>,
    enabled: true,
  });
  revalidatePath("/admin/competitors");
}

async function toggleEnabled(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = Number(formData.get("id"));
  const current = String(formData.get("current") ?? "true") === "true";
  await db.update(sources).set({ enabled: !current }).where(eq(sources.id, id));
  revalidatePath("/admin/competitors");
}

async function deleteCompetitor(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = Number(formData.get("id"));
  await db
    .delete(sources)
    .where(and(eq(sources.id, id), eq(sources.category, "competitor")));
  revalidatePath("/admin/competitors");
}

function describeMethod(cfg: CompetitorConfig): string {
  if (cfg.method === "google-news") return `Google News · "${cfg.query ?? "?"}"`;
  if (cfg.method === "rss") return `RSS · ${cfg.feedUrl ?? "?"}`;
  if (cfg.method === "github-releases") return `GitHub releases · ${cfg.repo ?? "?"}`;
  return cfg.method ?? "unknown";
}

export default async function CompetitorsAdminPage() {
  await requireAdmin();
  const rows = await listCompetitors();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Manage competitors
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each row drives one upstream poll on the hourly tick. Add a row →
          new competitor flows into the Feed on the next hourly cron run.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No competitors yet — add one below.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => {
                const cfg = (r.configJson ?? {}) as CompetitorConfig;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {describeMethod(cfg)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.enabled ? "default" : "secondary"}>
                        {r.enabled ? "enabled" : "disabled"}
                      </Badge>
                      {r.lastPolledAt && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          polled {new Date(r.lastPolledAt).toISOString().slice(11, 16)} UTC
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <form action={toggleEnabled} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="current" value={String(r.enabled)} />
                        <Button type="submit" variant="outline" size="sm">
                          {r.enabled ? "Disable" : "Enable"}
                        </Button>
                      </form>
                      <form action={deleteCompetitor} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" variant="ghost" size="sm" className="text-destructive">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a competitor</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addCompetitor} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              <span className="font-medium">Display name</span>
              <Input name="name" required placeholder="e.g. Google News (OpenAI)" />
              <span className="text-muted-foreground">
                Shown on item cards. Convention: &quot;Google News (Brand)&quot; or &quot;Brand blog&quot;.
              </span>
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium">Brand</span>
              <Input name="brand" placeholder="e.g. OpenAI" />
              <span className="text-muted-foreground">Defaults to name if omitted.</span>
            </label>
            <label className="grid gap-1 text-xs sm:col-span-2">
              <span className="font-medium">Method</span>
              <select
                name="method"
                required
                className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
                defaultValue="google-news"
              >
                <option value="google-news">Google News (search query)</option>
                <option value="rss">RSS feed</option>
                <option value="github-releases">GitHub releases</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs sm:col-span-2">
              <span className="font-medium">Query (for Google News)</span>
              <Input name="query" placeholder='"OpenAI" design tool' />
              <span className="text-muted-foreground">
                Quoted strings reduce noise. Required if method = Google News.
              </span>
            </label>
            <label className="grid gap-1 text-xs sm:col-span-2">
              <span className="font-medium">Feed URL (for RSS)</span>
              <Input name="feedUrl" placeholder="https://example.com/blog/feed.xml" />
            </label>
            <label className="grid gap-1 text-xs sm:col-span-2">
              <span className="font-medium">Repo (for GitHub releases)</span>
              <Input name="repo" placeholder="owner/repo" />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm">
                Add competitor
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
