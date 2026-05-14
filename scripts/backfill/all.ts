/**
 * Run every backfill script sequentially.
 *
 *   tsx scripts/backfill/all.ts [--limit N]
 *
 * Forwarded `--limit` applies *per source*. Each step is run in a fresh
 * child process so one source crashing doesn't take down the others.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const SOURCES = ["sec", "hn", "figma-blog", "reddit", "competitors"] as const;

function runOne(source: string, args: string[]): Promise<number> {
  return new Promise((resolveP) => {
    const scriptPath = resolve(process.cwd(), `scripts/backfill/${source}.ts`);
    console.log(`\n[backfill:all] >>> ${source}`);
    const child = spawn("npx", ["tsx", scriptPath, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      console.log(`[backfill:all] <<< ${source} exit=${code ?? "null"}`);
      resolveP(code ?? 0);
    });
    child.on("error", (err) => {
      console.error(`[backfill:all] ${source} spawn failed:`, err);
      resolveP(1);
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let failures = 0;
  for (const source of SOURCES) {
    const code = await runOne(source, args);
    if (code !== 0) failures++;
  }
  if (failures > 0) {
    console.error(`[backfill:all] ${failures} source(s) failed`);
    process.exit(1);
  }
  console.log("[backfill:all] all sources complete");
}

main().catch((err) => {
  console.error("[backfill:all] failed:", err);
  process.exit(1);
});
