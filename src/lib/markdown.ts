/**
 * Minimal, safe Markdown → HTML renderer.
 *
 * Supports a small subset that matches what the digest writer produces:
 *   - # / ## / ### headings
 *   - paragraphs (blank-line separated)
 *   - bullet lists (lines starting with "- " or "* ")
 *   - **bold** and inline [text](url) links
 *   - inline `code`
 *
 * Everything else is HTML-escaped. Output is intended for `dangerouslySetInnerHTML`.
 * If a richer renderer is wanted later, swap to `react-markdown` once it's installed.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;
  return /^https?:\/\//i.test(trimmed);
}

function renderInline(text: string): string {
  // Render inline tokens on already-escaped text. We do **bold**, `code`, [text](url) — order matters.
  let out = escapeHtml(text);

  // `code`
  out = out.replace(/`([^`]+)`/g, (_, code: string) => `<code class="rounded bg-muted px-1 py-0.5 text-xs">${code}</code>`);

  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, inner: string) => `<strong>${inner}</strong>`);

  // [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => {
    // url was HTML-escaped (& → &amp; etc.) — decode minimally for validation
    const raw = url.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    if (!isSafeUrl(raw)) return label;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:text-foreground">${label}</a>`;
  });

  return out;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Blank → skip
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Heading
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level === 1
          ? "mt-6 mb-3 text-xl font-semibold"
          : level === 2
            ? "mt-5 mb-2 text-lg font-semibold"
            : "mt-4 mb-2 text-base font-semibold";
      out.push(`<h${level} class="${cls}">${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // List block
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*]\s+/, "");
        items.push(`<li>${renderInline(text)}</li>`);
        i++;
      }
      out.push(`<ul class="my-2 list-disc space-y-1 pl-6 text-sm">${items.join("")}</ul>`);
      continue;
    }

    // Paragraph (collect until blank line / heading / list)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(`<p class="my-2 text-sm leading-relaxed">${renderInline(paraLines.join(" "))}</p>`);
  }

  return out.join("\n");
}
