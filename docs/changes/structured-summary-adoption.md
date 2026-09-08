# Structured summary adoption

**Status:** shipped · **Branch:** `dev/structured-summary-adoption` · **Commit:** `82326c9`

This is the sequel to
[Structured story summaries](./structured-story-summaries.md) (2026-09-03,
commit `84c5c8f`). That change taught the feed UI to render a lede-plus-
bullets `summary` as a real bullet list. This change exists because, three
days later, the live data showed it had never once had anything to render.

## What shipped on 2026-09-03, and why it didn't move the needle

The predecessor change made the lede-plus-bullets shape *optional*: the
curating agent could write it inside the existing `summary` string, and
`parseSummary` (`views/_shared/feed/formatters.ts`) would render it as a
real `<ul>` in both the MCP View and the standalone site. It shipped with
11 passing parser unit tests, a code review against 21 acceptance criteria,
and a Codex UI/UX review that returned "Ready" with no findings.

Measured against the live published snapshot three days later
(`git show origin/feed:feed.json`, 50 stories, all curated after the change
shipped):

- Summaries containing any newline: **0 / 50**.
- Summaries containing a `- ` bullet: **0 / 50**.
- Length: min 120 / p25 188 / **median 237** / p75 291 / p90 489 / **max
  1132**.

Total non-adoption — the rendering half of the fix never executed once in
production. Summaries also got *longer*, not shorter: the predecessor's own
baseline was median 219 / max 894; three days later it was median 237 / max
1132. The predecessor doc explicitly expected a "mixed transition period"
that would "resolve on its own as stories churn." That did not happen. It
was never a transition — it was zero uptake.

The lesson worth keeping: **the failure was invisible to every check the
first change ran.** Unit tests, a 21-point code review, and a UI review all
passed, because all three evaluate what happens to a summary that already
contains structure. None of them can observe whether the external curating
LLM chooses to write that structure in the first place — and it didn't.
That gap is what this change targets.

## Root cause, validated against the corpus, not assumed

- **Not a pipeline bug.** `summary` flows untouched (no trim, no
  stripping) through `StoryService` → `SqliteStoryRepository` →
  `FeedService` → `feed.json`. Any newline the agent wrote would have
  survived to the renderer. It never wrote one. The failure sits entirely
  in what the curating LLM chooses to produce, not in server code.
- **The guidance was a nicety with an escape hatch.** It said a plain
  paragraph "is always correct and never needs this," gave no worked
  example, and sat as one bullet among roughly seven tool-instruction
  bullets in a long system prompt.
- **The dominant finding: the fix targeted the wrong pathway.** The worst
  summaries aren't bad single drafts — they **accrete**, one `update-story`
  call at a time, each appending a clause to existing prose with nothing
  ever prompting a restructure. Most stories aren't born multi-faceted;
  they become so through updates. The 2026-09-03 guidance sat mainly under
  `create-story`, which is nearly irrelevant to how the worst cases
  actually form.

Real examples from the corpus:

- Story #27 (802 chars, Claude Fable/Mythos 5.1) writes "Headlines: a 75%
  cut to cached-input pricing…; gains on agentic/coding benchmarks…; and a
  new 'Enterprise Frontier Safeguards' architecture…" — the agent's
  enumerate-the-facets instinct firing correctly, then channeled into
  semicolons inside one paragraph instead of newlines and `- ` bullets.
- Story #20 (662 chars) tacks on an unrelated fact with "Separately, Meta
  is now offering…".
- Story #1 (1132 chars, GPT-6 Astra) is the pattern at its limit: six
  independent facts — launch/AGI framing, a Preparedness Framework
  threshold, a $1B safety commitment, benchmark-framing scrutiny, a
  rollout failure and apology, and a legibility critique — assembled
  across calls and never restructured.

## What's different this time

### 1. The guidance changed shape, not just wording

In `docs/agent-system-prompt.md` and the `summary` `.describe()` on both
`createStoryInputSchema` and `updateStoryInputSchema`
(`src/tools/schemas.ts`):

- The permission slip is gone. Past roughly 280 characters or three or
  more distinct facts, lede-plus-bullets is now the **expected** shape,
  not an option — prose stays correct and preferred for genuinely short,
  single-fact summaries.
- A **worked example** replaces the old abstract description, condensed
  from the real GPT-6 Astra story: its six facts become one lede sentence
  plus five bullets. It closes with an explicit anti-pattern callout —
  don't cram distinct facts into one paragraph joined by semicolons —
  aimed directly at story #27's failure.
- A bolded **restructure trigger** now lives inside `update-story`'s own
  instructions: a self-check at the moment of acting ("does the summary
  already cover two or more other facts?" — if yes, rewrite it from
  scratch as lede-plus-bullets rather than editing the prose in place).
  This is the highest-priority wording change in the feature, because it
  targets the accretion pathway that produced every worst case.

### 2. A second channel that doesn't depend on prompt compliance

`src/tools/summary-structure.ts`, wired into `create-story-tool.ts` and
`update-story-tool.ts`:

- `needsStructureNudge(summary)` is true when `summary.length > 280`
  (`SUMMARY_STRUCTURE_THRESHOLD`, strictly greater — exactly 280 does not
  fire) and `parseSummary(summary).bullets.length === 0`.
- When true, the tool's free-text confirmation gets an appended advisory
  sentence. The write always still succeeds: the stored summary is
  persisted byte-for-byte unmodified, `structuredContent` is unchanged, and
  the advisory is appended (not prepended) so a caller matching the old
  confirmation prefix still recognizes the message.
- On `update-story` it evaluates only a `summary` supplied in *that* call.
  A call that only updates scores, tags, or title can never fire it, and
  previously-stored text is never re-checked.
- This is a mechanical shape check on already-authored text — a pure
  predicate over the string's length and characters, the same category of
  thing as the existing `z.string().min(1)`. It is not the server making
  an editorial judgment, so `docs/architecture.md`'s rule that
  summarization judgment belongs to the agent still holds. The prompt
  bullet was already a directive at the point of authoring, and it was
  ignored 0/50 times; the nudge's structural advantage is that it recurs
  at every qualifying write instead of being read once near the top of a
  long system prompt, and it backstops something an LLM is genuinely bad
  at — judging whether its own text crossed a character count.

### 3. The result is now measurable

`scripts/measure-summary-adoption.ts`
(`npm run measure-summary-adoption -- <path-to-feed.json>`):

- Read-only, operates on a local `feed.json` file only — no network, no
  database, no server, zero side effects. Deliberately **not** wired into
  `npm run verify` or CI: it measures, it doesn't gate.
- Reports **primary adoption** (structured share among summaries over 280
  chars), a **regression guard** (structured share among summaries under
  200 chars, which should stay near zero — proving the threshold isn't
  forcing bullets onto stories that read fine as prose), a **mechanism
  check** (primary adoption split by whether a story ever received a
  `meaningful-update`, via the existing `developmentCount` field — no new
  field added — which directly tests whether the accretion fix worked),
  and the length distribution.
- On the pre-fix snapshot: 50 stories, min 120 / median 240.5 / p90 525 /
  max 1132; primary adoption **0/15 (0.0%)**; regression guard **0/13
  (0.0%)**; mechanism split **0/6** never-updated vs. **0/9** with one or
  more meaningful updates.
- An earlier ad-hoc diagnostic quoted "0/10" adoption; that counted a
  >300-char bucket. The script reports 0/15 at its actual >280 threshold,
  so the recorded baseline and future readings share a denominator.

## One shared parser

`parseSummary` and `ParsedSummary` moved from
`views/_shared/feed/formatters.ts` to a new `src/shared/summary-format.ts`,
behavior byte-identical; `formatters.ts` now imports and re-exports them,
so every existing call site (`StoryCard.tsx`, `SourceSheet.tsx`,
`toStorySnapshot`/`computeStoryDelta`, and
`test/unit/feed-formatters.test.ts`) is unchanged.

Why bother: the nudge and the renderer must never disagree about what
"structured" means, or the server could nag about a summary the feed
already bullets, or stay silent on one it renders as a wall of prose. The
first draft of this fix achieved that by having `src/tools/` import from
`views/`, which review flagged as a layering inversion — server code
reaching into presentation code, a boundary `docs/architecture.md`'s layer
diagram never includes and that had been clean in both directions until
then. Extracting to a neutral, dependency-free `src/shared/` module
preserves the single-source-of-truth guarantee by construction while
flipping the remaining dependency to the allowed downstream direction.
`src/shared/` specifically because `tsconfig.json`'s `include` is already
an explicit whitelist covering `src/**/*` (a new top-level `shared/` would
have needed config changes), and because `AGENTS.md` reserves
`src/domain/` for "plain interfaces/types… no logic."

## Trade-offs recorded honestly

- We still cannot control or A/B-test the external curating LLM. Both the
  prompt and the nudge are advisory; neither can force structure. That's
  inherent to `docs/architecture.md`'s design, not something more code
  fixes.
- A tool-result advisory is a weaker channel than a system-prompt directive
  in one sense: it arrives after the agent has already produced its
  answer, and there's no guarantee it reads tool-result prose closely
  mid-batch rather than just checking success.
- Raising structure to a default above a threshold risks overcorrecting
  into forced, awkward bullets on borderline-length stories that read fine
  as prose; the "genuinely discrete facets" qualifier and the sub-200-char
  regression guard both exist to catch that.
- `summary` still has no `.max()`. A hard cap on an externally-authored
  field would create a new tool-call-rejection failure mode — that
  reasoning carries over unchanged from the predecessor change.
- Existing published summaries are not backfilled; only future curation
  runs adopt the shape.
- Deliberately not fixed in this pass, to avoid confounding the adoption
  signal: attribution-first ledes ("Wired reports…", "reportedly" appears
  9+ times in the corpus) and title-redundant summaries that restate the
  headline without adding why it matters (stories #5, #6, #47). These are
  real, confirmed defects, but a different failure mode — voice and
  informativeness, not density and scannability. Flagged as a follow-up.

## Verification

- `npm run verify`: lint clean, 220 tests passing across 16 files (up from
  a 214 baseline on `main`), typecheck clean. `npm run build` and
  `npm run build:site` both succeed.
- New `test/unit/summary-structure.test.ts` covers: below threshold and
  unstructured (no nudge); above threshold and already structured (no
  nudge, regardless of length); above threshold and unstructured (fires);
  the exact-280 boundary (no nudge, strictly-greater semantics); a
  newline present but one line failing the bullet test (still fires,
  matching the parser's all-or-nothing fallback); and a non-ASCII case
  pinning UTF-16 code-unit measurement (`"😀".repeat(140).length === 280`
  fires no nudge; one more emoji fires it), so the threshold measures
  length exactly as the schema's `.min(1)` does.
- `test/mcp-server.test.ts` extends the protocol-level lifecycle test to
  assert, through the real server: the advisory fires or doesn't per the
  predicate on both tools; the stored value and `structuredContent` are
  untouched; the confirmation keeps its original prefix; and an
  `update-story` call that omits `summary` never fires the nudge
  regardless of the stored summary's length.
- The 11 original `parseSummary` cases in
  `test/unit/feed-formatters.test.ts` pass unchanged, still exercising the
  parser through the re-export.
- No new dependency, no SQLite migration, no new MCP tool, no change to
  any `outputSchema`.
- No Codex UI/UX review was run, deliberately: this change alters no
  reader-facing behavior. `views/_shared/feed/formatters.ts` was touched
  only to move the parser out, byte-identical behavior, no component,
  stylesheet, or rendered output changed. The rendering half was already
  reviewed and approved when it shipped in the predecessor change.

## How we'll know it actually worked

Unit tests can only prove the nudge and the measurement script work as
built. They cannot prove the curating LLM changes its behavior — and that
blind spot is exactly what let the predecessor change ship green and still
fail. Proof here has to be observational, against future published
snapshots:

- **Primary:** among summaries over 280 chars, structured share should
  reach 40% or more, up from the 0/15 baseline.
- **Regression guard:** summaries under 200 chars should stay near 0%
  structured.
- **Mechanism check:** `update-story`-grown stories should stop lagging
  freshly-created ones in adoption. If they still lag at the 7-day read,
  the restructure trigger needs strengthening, not a reword — and the
  script is what makes that determination possible.
- **Timeline:** first checkpoint at 3 days, a firmer read at 7 days
  (mirroring the system's own 7-day staleness window), given the roughly
  30-minute curation cadence.

If adoption is still near 0% at the 7-day read, treat the prompt/schema
channel as exhausted. The next move is a stronger mechanism, not a third
rewording.

## Static-site constraint

No new field was added to `feed.json` — the only change to a published
story's `summary` is newline and `- ` characters the agent chooses to
write inside the existing string, so the snapshot's shape is unchanged and
size impact is negligible (it's roughly 77 KB, committed straight into
git). The nudge only affects a transient tool confirmation message that is
never persisted. The measurement script is a manually run, read-only tool
that reads the same already-committed snapshot and is never invoked by, or
reachable from, the deployed static site.
