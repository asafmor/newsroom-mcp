# Floating back-to-top button

**Status:** shipped · **Branch:** `dev/back-to-top-button`, hardened on `dev/back-to-top-clearance-tokens`

## What it is and why

The reader-facing feed page grew long enough — stories, then Tool Radar's
entry bar, then the weekly podcast digest section — that getting back to the
top meant a long manual scroll. This adds a small floating button that
appears once the reader has scrolled past the feed itself, and jumps back to
the top on click. It ships in `views/_shared/feed/`, so both hosts that
mount that code get it at once: the MCP View (`views/get-feed/`) and the
standalone static site (`site/`).

## What it was required to do

- Stay hidden while scrolling the feed; appear only once the reader reaches
  the podcast digest section or lower.
- Look subtle and stay out of the way of readable content, particularly at
  the very bottom of the page.
- Add end-of-page padding if needed so the button never sits over the last
  real content once scrolled all the way down.
- Match the existing design language (`docs/ui-ux-principles.md`, the
  `views/_shared/` styles already in place) rather than looking bolted on.
- Apply to both hosts unless there's a good reason not to.

## How it was implemented

### One button, two trigger conditions

The button component and its show/hide logic live in
`views/_shared/feed/BackToTopButton.tsx`; the actual "should it be visible
now" decision is two pure, unit-tested functions in
`views/_shared/feed/formatters.ts` — `shouldShowBackToTopSite` and
`shouldShowBackToTopMcp` — because the two hosts scroll differently:

- **site** — `.app-shell`/`.scroll-area` use `overflow: clip` on purpose
  (see `docs/changes/tool-radar-ui-followups.md`) so they never become a
  scroll container; the document/`window` scrolls instead. The trigger is
  the top edge of `#podcast-digest` — a section owned by a *sibling* React
  root that `site/src/main.tsx` mounts independently of `FeedApp` — reaching
  or passing the top of the viewport. `shouldShowBackToTopSite` is just
  `podcastSectionTop <= 0`. Scrolling back to top targets `window`.
- **mcp** — `.scroll-area` genuinely is the scrolling element
  (`max-height: 844px; overflow-y: auto`), and this host has no podcast
  section at all, so the equivalent trigger is scrolling roughly one
  panel-height: `shouldShowBackToTopMcp` is
  `viewportHeight > 0 && scrollTop >= viewportHeight` (the `viewportHeight >
  0` guard keeps it hidden before layout has been measured, rather than
  misreading `0 >= 0` as "past threshold"). Scrolling back to top targets
  the `.scroll-area` element via the pre-existing `scrollAreaRef`.

Both predicates are covered in `test/unit/feed-formatters.test.ts`,
including the exact boundary in each direction.

### Rendering and positioning

`BackToTopButton` renders as a sibling of `.app-shell` in `FeedApp.tsx`, not
a descendant — the same reason `SourceSheet`'s overlay already does this:
`.app-shell`'s `overflow: hidden`/`clip` clips `position: fixed`
descendants on mobile WebKit. `feed.css` gives it `position: fixed` by
default, and `.newsroomFeed--mcp .back-to-top { position: absolute; }`
switches it to absolute inside the MCP host's sandboxed panel, alongside
the pre-existing `.sheet-overlay`/`.source-sheet` overrides for the same
reason. `z-index: 24`, below `.sheet-overlay`/`.source-sheet` (30/31) and
Tool Radar's `.tools-persist-warning` (30), so any overlay always wins.

Hiding uses the native `inert` attribute rather than unmounting the button:
`inert` removes it from the accessibility tree and blocks focus/activation
while hidden or while the source sheet is open, but the element stays in
the DOM so the CSS opacity/transform `transition` can still animate the
fade. That transition (not `@keyframes`) inherits feed.css's existing
blanket `prefers-reduced-motion` override for free.

`FeedApp.tsx` gives `.scroll-area` a `tabIndex={-1}` — not a tab stop,
only a programmatic focus target — so that after the button scrolls the
page back up, keyboard focus lands somewhere sensible instead of staying on
a control that's about to go `inert`.

### Geometry tokens (the follow-up hardening)

The first pass hardcoded the button's `44px` diameter and `16px` inset in
three separate places: `.back-to-top` itself, the end-of-document padding
in `site/src/index.css`, and `.tool-card-action`'s clearance margin in
`views/_shared/tools/tools.css`. That end-of-document padding was also
wrong — it reserved `--space-8` (32px), but the button occupies `16px
inset + 44px diameter = 60px`, 28px short, letting the button sit over
real content at the very bottom of the page.

This is fixed by two new tokens in `feed.css`'s `:root` —
`--back-to-top-size: 44px` and `--back-to-top-inset: var(--space-4)` — with
all three consumers now deriving from them instead of repeating the
numbers: `.back-to-top`'s own `width`/`height`/`right`/`bottom`, `#root`'s
end-of-document padding (now `size + inset*2 +
env(safe-area-inset-bottom)`), and `.tool-card-action`'s reserved
`margin-right`. The geometry can no longer drift out of sync across files.

The reduced-motion fix from UI review (below) was also deduplicated: the
scroll-and-honor-reduced-motion logic that used to live inline in the
button's click handler is now an exported `scrollToTop()` helper in
`BackToTopButton.tsx`. Both places that jump back to the top route through
it: the button's `handleClick`, and `FeedApp.tsx`'s own sort-mode-change
scroll-to-top (the one that runs when the reader changes the sort order),
which previously called `scrollAreaRef.current?.scrollTo({ top: 0,
behavior: "smooth" })` directly and so carried the same reduced-motion
defect the button had. Fixing it only in the button would have left the
sibling caller broken, so the guard lives in the one helper they share.

## UI review findings that shaped the final state

`npm run review:ui` returned "Not ready" on the first pass, for two
findings:

- **P1 — reduced motion still animated the return.** `feed.css`'s
  `transition-duration: 0.01ms` override only shortens CSS transitions. A
  programmatic `scrollTo({ behavior: "smooth" })` is a browser-driven
  scroll animation, not a CSS transition, so it kept animating through
  roughly 20,000px of scroll regardless of the OS-level
  `prefers-reduced-motion: reduce` setting. Fixed with a JS-side
  `window.matchMedia("(prefers-reduced-motion: reduce)")` check that
  switches the scroll's `behavior` to `"auto"`.
- **P2 — mobile actions passed underneath the button.** At 390px wide,
  Tool Radar's final card's "Open demo" action overlapped the button by
  about 19×36px, and a click there hit-tested to the button instead of the
  action. Fixed by giving `.tool-card-action` a `margin-right` that
  reserves the button's footprint unconditionally, not just below some
  breakpoint — `.tools-shell` is centered with no side margin of its own,
  so a pixel-perfect breakpoint would have drifted back into overlap after
  any future layout change.

The same review confirmed the intended behavior: the button stays hidden
throughout the feed and appears exactly at the podcast-section boundary,
hidden instances are `inert` and absent from the accessibility tree, and
opening the source sheet suppresses the button.

**Known gap:** the MCP App host could not be verified in that review — the
capture failed with `browser_timeout: View did not become ready in time`.
The MCP-panel behavior (scroll trigger, focus handling, overlay
suppression) is backed by code review and the unit tests above, not by a
rendered capture.

A second `review:ui` pass was requested to re-verify the corrected
clearance geometry, the reduced-motion behavior on both callers, and that
previously unverified MCP host. It could not run: the Codex reviewer
account hit its usage limit (quota resets 2026-09-15). The hardening in
this change is therefore backed by `npm run verify`, `npm run build`,
`npm run build:site`, code review, and the geometry arithmetic above —
but the corrected end-of-document clearance has not been confirmed by a
rendered screenshot. Re-running `npm run review:ui` once quota returns is
the cheapest way to close both this and the MCP gap.

## Files touched

- `views/_shared/feed/BackToTopButton.tsx` — the component and the
  `scrollToTop()` helper
- `views/_shared/feed/formatters.ts` — `shouldShowBackToTopSite` /
  `shouldShowBackToTopMcp`
- `views/_shared/feed/FeedApp.tsx` — threads `variant`, renders the button
  as an `.app-shell` sibling, `tabIndex={-1}` on `.scroll-area`
- `views/_shared/feed/feed.css` — `.back-to-top` styles, the two geometry
  tokens, the `--mcp` position override
- `views/_shared/tools/tools.css` — `.tool-card-action` clearance
- `site/src/index.css` (new) + `site/src/main.tsx` — end-of-document
  clearance
- `test/unit/feed-formatters.test.ts` — boundary tests for both predicates

No change to `feed.json`, `podcast.json`, `tools.json`, any MCP tool
schema, or any published snapshot — this is purely presentational
client-side UI.
