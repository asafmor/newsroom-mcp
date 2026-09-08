// The single definition of the lede+bullets `summary` convention's shape.
//
// Deliberately framework-free and dependency-free, and deliberately NOT under
// `views/`: two very different callers must agree on what "structured" means
// or the feature silently breaks in half.
//   - the reader-facing renderer (views/_shared/feed, and site/) decides
//     whether to draw a real <ul>;
//   - the create-story/update-story structure nudge (src/tools/
//     summary-structure.ts) decides whether to advise the curating agent to
//     restructure.
// If those two ever disagreed, the server could nag about a summary the feed
// already renders as bullets, or stay silent on one it renders as a wall of
// prose. Keeping one parser here — rather than one under `views/` that server
// code reaches back into — removes that failure mode by construction while
// leaving the server free of any dependency on presentation code.

/**
 * A `summary` unstructured into one paragraph, or split into an optional
 * lede sentence plus a bullet list — see docs/agent-system-prompt.md's
 * lede+`- `-bullets convention. Pure/synchronous: parses the raw string
 * as-is, no validation, no side effects.
 *
 * Deliberately strict and all-or-nothing: a single non-bullet line among the
 * remaining lines falls the whole summary back to unstructured rather than
 * rendering a partial list.
 */
export interface ParsedSummary {
  readonly lede: string;
  /** Empty when the summary is unstructured (or has a lede but no bullets) — never partially populated. */
  readonly bullets: readonly string[];
}

const BULLET_LINE = /^-\s+(\S.*)$/;

export function parseSummary(raw: string): ParsedSummary {
  if (!/\r\n|\n/.test(raw)) return { lede: raw, bullets: [] };

  const lines = raw.split(/\r\n|\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return { lede: raw, bullets: [] };

  const [lede, ...rest] = lines;
  const bullets: string[] = [];
  for (const line of rest) {
    const match = BULLET_LINE.exec(line.trimStart());
    if (match === null) return { lede: raw, bullets: [] };
    bullets.push(match[1].trim());
  }
  return { lede: lede.trim(), bullets };
}
