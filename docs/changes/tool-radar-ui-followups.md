# Tool Radar UI follow-ups

**Status:** shipped · **Branch:** `dev/tool-radar-ui-followups`

## What it is and why

A bug-fix batch against Tool Radar (`tool-radar.md`), reported after using
the live site. Four issues came in: a shrinking avatar, a mismatched
section background, two spots of verbose explanatory copy, and emoji icons
in the top entry-point bar. The fourth report also asked for an expert
UI/UX consultation on that bar's mobile layout, since it "reads as an
afterthought bolted onto the page, not a designed component." That
consultation turned into a full redesign of the bar, not just an icon swap.

## What it was required to do

- Fix the avatar shrinking when a Tool Radar card's title wraps to two or
  three lines.
- Bring Tool Radar's section background back in line with the rest of the
  site.
- Cut the podcast player's AI-narration disclosure and Tool Radar's
  section-header explainer down from verbose to plain.
- Replace the entry-point bar's emoji icons, and have a UI/UX expert
  review the bar's mobile layout, spacing and visual weight — not just
  patch the icons.

## How it was implemented

### 1. Avatar shrinking

Fixed at the shared `.avatar` rule in `views/_shared/feed/feed.css`, not
at Tool Radar's call site: `.avatar` had explicit `width`/`height` but no
`flex-shrink: 0`, so as a flex item it lost the cross-axis fight against a
wrapping sibling heading. The news feed never showed this bug only because
it nests avatars inside `.avatar-stack`, which does set `flex-shrink: 0`.
Fixing the shared rule covers every current and future caller, not just
Tool Radar's card.

### 2. Section background

Tool Radar's section inherited `--surface-warm`, visible as a mismatched
band at desktop widths. `views/_shared/tools/tools.css` now sets
`.newsroomTools { background: var(--bg); }`, mirroring the existing
`.newsroomPodcast { background: var(--bg); }` rule. An audit of every
card/section background, border and radius token across the feed, podcast
and tools components found no other divergence.

### 3. Verbose copy

Removed outright rather than trimmed: the podcast player's AI-narration
disclosure paragraph (`PodcastApp.tsx`, `.podcast-disclosure` in
`podcast.css`) and Tool Radar's section-header `KIND_EXPLAINER` paragraph
(`ToolRadarApp.tsx`, `formatters.ts`, `.tools-kind-explainer` in
`tools.css`). Tool Radar keeps its existing one-line subtitle. The models
card still explains, once at the source-code comment, that Hugging Face's
models API has no description field — a card for such a model now simply
renders nothing there instead of repeating a placeholder line.

### 4. Entry-point bar: icons and redesign

Emoji replaced with inline stroke SVGs (microphone, compass) in the same
24-viewBox idiom `SourceSheet` and `StoryCard` already use.

The UI/UX consultation (`npm run review:ui`) first returned "Not ready":
the bar sat above the brand header as a ~36px utility strip, implying
global navigation while under-weighting its own content. It is now a 56px
two-line band placed after the complete header and before the story list.
A second consultation pass, after the redesign below, returned "Ready"
with no findings.

**The sticky-positioning trap.** Moving the bar below the header meant
unwinding what had trapped its `position: sticky` there in the first
place. `.app-shell` set `overflow: hidden`, and `.scroll-area` set
`overflow-x: hidden` (whose `overflow-y` then computes to `auto`) — each
establishes a scroll container that never actually scrolls, and a sticky
descendant of a never-scrolling scroll container has nowhere to travel.
Both rules are now scoped to the MCP View only
(`.newsroomFeed--mcp .app-shell` / `.newsroomFeed--mcp .scroll-area`); the
standalone site variant uses `overflow: clip` instead, which clips
identically but is explicitly exempt from establishing a scroll
container — that exemption is the whole reason for the choice, on both
axes. The naive edit (`overflow-x: clip` paired with any non-`visible`
`overflow-y`) would silently recreate the same trap, since only `visible`
and `clip` avoid computing the other axis to `auto`.

**The knock-on.** Once the ancestors stopped trapping sticky,
`.feed-header`'s own long-dormant `position: sticky` would have started
genuinely engaging on the site for the first time, pinning the brand,
search, and provider/tag/sort filters for the entire scroll. That was
deliberately not wanted — a real fix needs its own compact scrolled-state
design — so `.newsroomFeed:not(.newsroomFeed--mcp) .feed-header` is
pinned to `position: static`.

**Mobile metadata.** Below 640px, with the bar's two entries sharing the
row, all secondary metadata and the status chip used to be hidden — a
workaround for a purely horizontal squeeze, where the name, its metadata,
and a never-shrinking status pill competed for ~195px on one line. The new
two-line composition gives the supporting text its own row, dissolving
that constraint, so the suppression was removed rather than kept.
Visibility is now driven by a `:only-child` compact/full text swap
(`.digest-bar-supporting-compact` / `-full`) that works at every width
instead of a breakpoint.

**`DigestEntry` reshape.** `{href, label, statusLabel}` became `{href,
compactSupporting, fullSupporting, accentSupporting, ariaLabel}`
(`views/_shared/feed/types.ts`, with matching changes in
`views/_shared/podcast/formatters.ts` and
`views/_shared/tools/formatters.ts`). Each link now also carries a
full-sentence accessible name (e.g. "Weekly podcast, Sep 2 – Sep 9, 2026,
ready to play") distinct from its abbreviated visible text, via a new
`timeAgoLong()` formatter for the Tool Radar entry.

**Verification method.** Stickiness was measured empirically in headless
Chromium at 320, 390 and 1440px — the bar's top stays pinned at 0 across a
1000px+ scroll while the header's top moves by the full scroll delta, and
`clientWidth === scrollWidth` at every width — rather than inferred by
reading the CSS.

## Verification

`npm run verify` passes: lint clean, 32 test files / 454 tests, no type
errors. `npm run build` and `npm run build:site` both succeed.
