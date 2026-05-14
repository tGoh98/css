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
import type { FinnhubEarningsRow } from "@/lib/queries/finnhub";

function fmtEps(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(3)}`;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function EarningsSurprise({ rows }: { rows: FinnhubEarningsRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Earnings history</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No reported quarters yet.</CardContent>
      </Card>
    );
  }

  const beats = rows.filter((r) => (r.surprise ?? 0) > 0).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Earnings history</CardTitle>
        <CardDescription>
          {rows.length} reported quarter{rows.length === 1 ? "" : "s"} · {beats} beat{beats === 1 ? "" : "s"} consensus
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Qtr</TableHead>
                <TableHead className="text-right">Est.</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Surprise</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const sign = (r.surprise ?? 0) > 0 ? "beat" : (r.surprise ?? 0) < 0 ? "miss" : "inline";
                return (
                  <TableRow key={`${r.year}-${r.quarter}`}>
                    <TableCell>
                      <span className="font-medium">Q{r.quarter} {String(r.year).slice(-2)}</span>
                      <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
                        ({new Date(r.period).toLocaleDateString(undefined, { month: "short", day: "numeric" })})
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEps(r.estimate)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmtEps(r.actual)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums">
                      {fmtEps(r.surprise)}
                    </TableCell>
                    <TableCell className="text-right">
                      {sign === "beat" ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                          {fmtPct(r.surprisePercent)}
                        </Badge>
                      ) : sign === "miss" ? (
                        <Badge variant="destructive">{fmtPct(r.surprisePercent)}</Badge>
                      ) : (
                        <Badge variant="secondary">{fmtPct(r.surprisePercent)}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
