import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InsiderFilters } from "@/components/insider-filters";
import type { InsiderTx } from "@/lib/queries/insider";

function fmtShares(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function InsiderActivity({
  rows,
  total,
  reporters,
  hasActiveFilter,
}: {
  rows: InsiderTx[];
  total: number;
  reporters: string[];
  hasActiveFilter: boolean;
}) {
  const description = rows.length === total
    ? `${total} Form 4 filing${total === 1 ? "" : "s"} match`
    : `Showing ${rows.length} of ${total} matching filings`;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle className="text-base">Insider Activity</CardTitle>
          <CardDescription className="text-xs">{description}</CardDescription>
        </div>
        <InsiderFilters reporters={reporters} hasActiveFilter={hasActiveFilter} />
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">
            {total === 0 && !hasActiveFilter
              ? "No Form 4 filings ingested yet."
              : "No Form 4 filings match the current filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Role</TableHead>
                  <TableHead>Trans.</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Shares</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.itemId}>
                    <TableCell className="font-medium">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {r.name ?? "Unknown"}
                      </a>
                      {/* Role + date inline below the name on mobile so we
                          don't lose the info entirely when columns are hidden. */}
                      <div className="text-[10px] text-muted-foreground sm:hidden">
                        {r.role ?? "—"} · {r.filedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">{r.role ?? "—"}</TableCell>
                    <TableCell>
                      {r.transaction === "sale" ? (
                        <Badge variant="destructive">Sale</Badge>
                      ) : r.transaction === "purchase" ? (
                        <Badge variant="default">Buy</Badge>
                      ) : (
                        <Badge variant="secondary">{r.transaction ?? "—"}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums">{fmtShares(r.shares)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUsd(r.value)}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {r.filedAt.toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
