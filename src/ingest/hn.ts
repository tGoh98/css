/**
 * Hacker News poller via Algolia's free `search_by_date` endpoint.
 * No key required; ~10k req/h limit which is plenty.
 */
import {
  ensureSource,
  fetchWith,
  insertAndClassify,
  markPolled,
  emptyResult,
  type IngestResult,
} from "./_shared";

interface HNHit {
  objectID: string;
  title?: string;
  story_title?: string;
  url?: string;
  story_url?: string;
  author: string;
  created_at: string;
  created_at_i: number;
  story_text?: string;
  comment_text?: string;
  points?: number;
  num_comments?: number;
  _tags: string[];
}

interface HNResponse {
  hits: HNHit[];
}

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();

  const sourceId = await ensureSource({
    name: "Hacker News (Figma)",
    kind: "hn",
    category: "core",
    configJson: { query: "Figma", endpoint: "search_by_date" },
  });

  const url = "https://hn.algolia.com/api/v1/search_by_date?query=Figma&tags=story";
  let resp: HNResponse;
  try {
    const res = await fetchWith(url);
    resp = (await res.json()) as HNResponse;
  } catch (err) {
    result.errors.push(`hn: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  for (const h of resp.hits ?? []) {
    const title = h.title ?? h.story_title;
    if (!title) continue;
    const link =
      h.url ??
      h.story_url ??
      `https://news.ycombinator.com/item?id=${h.objectID}`;
    await insertAndClassify(
      sourceId,
      "Hacker News (Figma)",
      "hn",
      {
        externalId: h.objectID,
        url: link,
        title,
        snippet: (h.story_text ?? h.comment_text ?? "").slice(0, 1500) || null,
        author: h.author,
        publishedAt: new Date(h.created_at_i * 1000),
        rawJson: {
          points: h.points ?? null,
          num_comments: h.num_comments ?? null,
          tags: h._tags,
          hn_id: h.objectID,
        },
      },
      result,
    );
  }

  await markPolled(sourceId);
  return result;
}
