import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          About Claudy Simple Syndication
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A personal news aggregator for tracking Figma the company.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What it does</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed text-foreground/90">
          CSS pulls everything published about Figma — news, SEC filings, blog
          posts, Hacker News, Reddit, and competitor moves — into one place.
          Each item is read by Claude Haiku, scored for relevance, and given a
          priority (breaking / notable / routine). Junk is dropped before it
          reaches the feed.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where the signal comes from</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed">
          <ul className="list-disc space-y-1 pl-5 text-foreground/90">
            <li>
              <strong>Google News</strong> — broad press coverage
            </li>
            <li>
              <strong>SEC EDGAR</strong> — 10-K, 10-Q, 8-K, S-1, Form 4 insider
              trades
            </li>
            <li>
              <strong>Figma&apos;s blog</strong>
            </li>
            <li>
              <strong>Hacker News &amp; Reddit</strong> — r/FigmaDesign,
              r/wallstreetbets, r/IPO and adjacent design + financial subs
            </li>
            <li>
              <strong>Competitors</strong> — Adobe, Canva, Sketch, Penpot, plus
              AI challengers (Google Stitch, Pencil, Galileo AI, Uizard,
              Anthropic&apos;s Claude design)
            </li>
            <li>
              <strong>Yahoo Finance &amp; Seeking Alpha</strong> — analyst
              ratings, price targets
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How the AI works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed text-foreground/90 space-y-3">
          <p>
            <strong>Ingestion</strong> runs every 15 minutes (news, Reddit, HN)
            or hourly (SEC, Figma blog, competitors, analyst) via GitHub
            Actions cron. New items get a single Claude Haiku call for
            relevance + priority.
          </p>
          <p>
            <strong>Digests</strong> run on a local Mac via launchd, invoking{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[12px]">
              claude --print
            </code>{" "}
            with Claude Opus 4.7 (on a Max plan) and writing the summary back
            to Postgres. Daily at 09:00, weekly Mondays, monthly the 1st —
            with catch-up on Mac wake.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The tabs</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed">
          <ul className="list-disc space-y-1 pl-5 text-foreground/90">
            <li>
              <strong>Feed</strong> — everything ingested, chronologically, with
              competitor noise filtered to notable+
            </li>
            <li>
              <strong>Digests</strong> — scheduled AI summaries
            </li>
            <li>
              <strong>Official</strong> — SEC filings + Figma&apos;s own posts,
              with the FIG ticker and insider-activity widget
            </li>
            <li>
              <strong>Competitors</strong> — same shape as Feed but scoped to
              competing tools
            </li>
            <li>
              <strong>Analyst</strong> — consensus ratings and analyst commentary
            </li>
          </ul>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Source code:{" "}
        <a
          href="https://github.com/tGoh98/css"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          github.com/tGoh98/css
        </a>
        . Built with Claude Code.
      </p>
    </div>
  );
}
