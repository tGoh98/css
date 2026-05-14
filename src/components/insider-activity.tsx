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

export function InsiderActivity({ rows }: { rows: InsiderTx[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Insider Activity</CardTitle>
        <CardDescription>Recent Form 4 filings (last ~10)</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">
            No Form 4 filings ingested yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Date</TableHead>
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
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.role ?? "—"}</TableCell>
                  <TableCell>
                    {r.transaction === "sale" ? (
                      <Badge variant="destructive">Sale</Badge>
                    ) : r.transaction === "purchase" ? (
                      <Badge variant="default">Purchase</Badge>
                    ) : (
                      <Badge variant="secondary">{r.transaction ?? "—"}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtShares(r.shares)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUsd(r.value)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.filedAt.toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
