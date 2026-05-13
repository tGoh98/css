import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ComingSoon({ tab }: { tab: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tab}</CardTitle>
        <CardDescription>Coming soon — Phase 2</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        This tab is a Phase 1 placeholder. Content for {tab} will be wired up in
        Phase 2 alongside the ingest pipeline and UI implementation.
      </CardContent>
    </Card>
  );
}
