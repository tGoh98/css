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

      <div
        role="alert"
        className="rounded-lg border-2 border-destructive bg-destructive/10 p-4 text-sm text-foreground"
      >
        <div className="mb-2 flex items-center gap-2 text-base font-bold uppercase tracking-wide text-destructive">
          <span aria-hidden>⚠</span>
          <span>Read this before trusting anything on this site</span>
        </div>
        <ul className="list-disc space-y-2 pl-5 leading-relaxed">
          <li>
            <strong>This is NOT investment advice.</strong>
            {" "}
            Nothing on this site — feed cards, AI summaries, digests, the
            Analyst tab, the chart, the insider widget, none of it — is a
            recommendation to buy, sell, or hold any security.
          </li>
          <li>
            <strong>This site is vibe-coded.</strong> Built one prompt at a
            time with Claude Code, almost entirely without manual code review.
            Bugs, broken parsers, miscounted shares, mis-tagged sources, and
            other quiet wrongness are all plausible.
          </li>
          <li>
            <strong>The AI hallucinates.</strong> Claude Haiku classifies every
            item and Claude Opus writes the digests. The probability of
            hallucinated facts, wrong dates, wrong dollar amounts, or
            fabricated citations is <em>non-zero</em>. The classifier prompt
            also runs over untrusted third-party text and can be tricked.
          </li>
          <li>
            <strong>Validate everything yourself.</strong> Click through to the
            original source (SEC EDGAR, the linked news article, the Form 4
            XML) before acting on anything. If the AI says a CFO sold 50,000
            shares, go read the filing.
          </li>
        </ul>
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
            or hourly (SEC, Figma blog, competitors) via GitHub
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
          <p>
            <strong>Topic clustering</strong>{" "}
            runs every 30 minutes — Haiku groups recent items by what
            they&apos;re actually about, so the Feed collapses ten
            near-duplicate stories about the same earnings release into a
            single card with a &ldquo;+9 similar&rdquo; badge. Saves you
            scrolling past the same news five times.
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
              <strong>Analyst</strong> — live FIG quote, analyst consensus,
              monthly recommendation trend, and earnings beat/miss history
              (via Finnhub)
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
