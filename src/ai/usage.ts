/**
 * Best-effort Anthropic usage logging.
 *
 * Writes one `ai_usage` row per API call so spend can be attributed by job
 * (classify vs cluster) and source, and so batch coalescing is visible
 * (item_count = items covered by the call; for batched classify this is the
 * batch size). Any failure here is swallowed — logging must never break
 * ingest.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";

interface LogAiUsageArgs {
  job: "classify" | "cluster";
  model: string;
  usage: Anthropic.Usage;
  itemId?: number | null;
  sourceKind?: string | null;
  itemCount?: number;
}

export async function logAiUsage({
  job,
  model,
  usage,
  itemId = null,
  sourceKind = null,
  itemCount = 1,
}: LogAiUsageArgs): Promise<void> {
  try {
    await db.insert(aiUsage).values({
      job,
      model,
      itemId,
      sourceKind,
      itemCount,
      inputTokens: usage.input_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteInputTokens: usage.cache_creation_input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
    });
  } catch {
    // Intentionally swallowed: usage logging is observability, not critical path.
  }
}
