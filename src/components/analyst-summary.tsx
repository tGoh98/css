import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalystSnapshot } from "@/lib/queries/yahoo";

function recBadge(key: string | undefined): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (!key) return { label: "—", variant: "secondary" };
  const k = key.toLowerCase();
  if (k.includes("strong_buy") || k === "buy") return { label: key.replace("_", " "), variant: "default" };
  if (k === "hold") return { label: "Hold", variant: "secondary" };
  if (k.includes("sell")) return { label: key.replace("_", " "), variant: "destructive" };
  return { label: key, variant: "secondary" };
}

export function AnalystSummary({ data }: { data: AnalystSnapshot | null }) {
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyst Consensus</CardTitle>
          <CardDescription>Yahoo data unavailable</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Couldn&apos;t fetch analyst snapshot right now.
        </CardContent>
      </Card>
    );
  }
  const rec = recBadge(data.recommendationKey);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Analyst Consensus · FIG</CardTitle>
        <CardDescription>
          {data.numberOfAnalystOpinions ?? "—"} analyst opinion
          {(data.numberOfAnalystOpinions ?? 0) === 1 ? "" : "s"}
          {data.recommendationMean != null && ` · mean ${data.recommendationMean.toFixed(2)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Rating">
          <Badge variant={rec.variant} className="text-xs uppercase">
            {rec.label}
          </Badge>
        </Stat>
        <Stat label="Current">${data.currentPrice?.toFixed(2) ?? "—"}</Stat>
        <Stat label="Target (mean)">${data.targetMean?.toFixed(2) ?? "—"}</Stat>
        <Stat label="Target (low)">${data.targetLow?.toFixed(2) ?? "—"}</Stat>
        <Stat label="Target (high)">${data.targetHigh?.toFixed(2) ?? "—"}</Stat>
      </CardContent>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{children}</span>
    </div>
  );
}
