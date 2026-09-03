# Structured story summaries

**Status:** shipped · **Branch:** `dev/structured-story-summaries` · **Commit:** `84c5c8f`

## What it is and why

Readers complained that story descriptions in the feed were one dense,
unbroken paragraph. A pull from the published `feed.json` snapshot backed
that up: across its 50 stories, summaries ran a median 219 characters and up
to 894, with a median of one sentence but as many as four — and not one of
the 50 contained a line break. The worst case was an 894-character,
four-sentence paragraph about "GPT-6 Astra" with no scannable structure at
all.

This change lets the curating agent write a short lede plus 2-4 bullet
points inside the existing `summary` string, and renders that structure as
a real lede and bullet list wherever a reader sees it. Plain-prose summaries
remain fully valid — the convention is optional, not a new required shape.

## Why the fix touches both generation and rendering

Four single-layer options were considered and two were rejected on
evidence before implementation started:

- **Generation-only** (just instruct the agent to write structure) would
  have been invisible to readers: `feed.css` had no `white-space` override
  on `.sheet-summary` or `.story-summary`, so HTML collapses any newline the
  agent wrote.
- **Render-only** (just parse and reformat existing prose) would have
  shipped a parser with nothing to parse — zero of the 50 real summaries
  contain any structural marker, and no renderer can invent structure an
  author never wrote.
- **A new data field** (`keyPoints: string[]`) was rejected separately: it
  would touch an estimated 10-12 files, require a SQLite migration, add
  15-20 KB to `feed.json`, and likely duplicate content already in
  `summary` — a lot of surface area for a presentational problem.

The shipped fix closes both gaps — authoring and display — at once, without
a new field, migration, tool, or dependency.

## What it was required to do

- `summary` keeps its existing shape: a plain string, still
  `z.string().min(1)`. No `.max()` length cap was added, since `summary` is
  filled by an external caller (the curating agent) and a hard ceiling would
  create a new tool-call rejection failure mode.
- The agent-facing convention (system prompt and schema description) states
  the optional shape — a short lede, optionally a blank line, then 2-4 lines
  each starting with `- ` — while making clear that plain prose is always
  acceptable.
- The shared feed UI renders a summary written in that shape as a lede
  paragraph plus a real `<ul>` bullet list, in both places a reader sees a
  story: the MCP View and the standalone site.
- Anything that isn't a clean, fully-conforming structured summary — including
  every one of the 50 real summaries in production today — renders exactly
  as before: the whole raw string as a single paragraph. No partial parsing,
  no dropped lines.
- feed.json's shape and size stay effectively unchanged; no backend
  behavior, SQLite schema, or MCP tool surface changes.

## How it was implemented

### Generation

- `docs/agent-system-prompt.md` (under `create-story` and `update-story`)
  and the Zod `.describe()` on `summary` in `createStoryInputSchema` and
  `updateStoryInputSchema` (`src/tools/schemas.ts`) spell out the same
  convention: lede first, optional blank line, then 2-4 `- `-prefixed
  bullet lines — and that plain prose remains correct.

### Rendering

- `parseSummary(raw): { lede, bullets }` in
  `views/_shared/feed/formatters.ts` — a pure function shared by both
  hosts (the mcp-use View and the standalone site).
- `SourceSheet.tsx` renders the lede as `<p className="sheet-summary">`
  followed by `<ul className="sheet-summary-bullets">` when bullets are
  present. `StoryCard.tsx` shows only the lede, keeping the card compact.
- `feed.css` gained spacing rules for the new bullet list.

### Parser rules

The parser is deliberately conservative — one non-conforming line falls
back to the complete original string, never a partial list:

1. **Requires a literal line break.** Zero newlines means unstructured: the
   whole raw string becomes the lede. This alone makes single-line prose
   like "GPT-4 — a new model" structurally impossible to misparse; no regex
   cleverness is needed for that case.
2. Splits on both `\n` and `\r\n`; blank or whitespace-only lines are
   discarded.
3. Fewer than two non-blank lines after that: unstructured, full original
   raw string.
4. Otherwise the first non-blank line is the lede; every remaining line
   must match `/^-\s+(\S.*)$/` after trimming leading whitespace.
5. **All-or-nothing.** One line that doesn't match falls the whole summary
   back to the complete, original raw string — never a partial list.

### Trade-offs recorded honestly

- The convention is unenforced by design. A prose-only summary is a
  permanently valid, non-degraded output, consistent with
  `docs/architecture.md` assigning summarization judgment to the agent, not
  the server.
- A structured story's card shows only the lede, which can look shorter
  than a legacy, three-line-clamped card. No height-normalizing logic was
  added; the card clamp and desktop grid are unchanged.
- Copy-to-clipboard copies the raw summary, `- ` markers included — they
  still read as bullets in a plain-text destination.
- Existing summaries are not backfilled. Only future curation runs adopt
  the new shape, so the feed shows a mix during the transition; this
  resolves on its own as stories churn.
- Only `- ` is recognized. `*`, `•`, and numbered lists are deliberately
  left as prose.

## Verification

- `npm run verify` passes: lint clean, 140 tests (up from a 130 baseline),
  no type errors. `npm run build` and `npm run build:site` both succeed.
- 11 new parser cases in `test/unit/feed-formatters.test.ts`: an
  adversarial single-line hyphen, plain prose, a well-formed lede plus
  bullets, CRLF line endings, blank-line filtering that doesn't trigger a
  fallback, a malformed/mixed case that falls back to the complete raw
  string, fewer-than-two-lines fallback, a lede with no bullets, an empty
  string, and no deduplication of repeated bullets.
- Code review approved the change against all 21 acceptance criteria.
- A read-only Codex UI/UX review (`npm run review:ui`) returned "Ready,"
  with no P0-P3 findings, evidenced on mobile and desktop web in both light
  and dark themes. It measured the "Sources" section starting about 93px
  earlier on mobile than with the original 894-character paragraph;
  confirmed the accessibility tree exposes one `list` and four `listitem`
  nodes for a structured summary; confirmed clipboard readback preserves
  the raw markers; and confirmed the malformed case falls back to one
  paragraph with no text dropped.

## Static-site constraint

No field was added to `feed.json` — only newline and `- ` characters inside
the existing `summary` string — so the published snapshot's shape is
unchanged and its size impact is negligible. The deployed static site still
fetches that one committed file and parses it client-side; no backend or
server-side rendering was introduced.
