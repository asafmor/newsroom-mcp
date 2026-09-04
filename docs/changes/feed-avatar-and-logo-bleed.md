# Feed avatar overflow and desktop logo bleed

**Status:** shipped · **Branch:** `dev/feed-avatar-and-logo-bleed`

## What it is and why

Three small, unrelated visual fixes to the shared feed card and header,
bundled because they surfaced together during a read-only UI review:

1. A story card with exactly one overflow provider (4 unique sources)
   showed a generic "+1" circle where it could just as easily show that
   provider's real avatar.
2. The "+N" overflow circle, for two or more hidden providers, rendered
   with its digits visibly off-center.
3. On desktop, the header logo sat 24px short of the app shell's left
   edge instead of flush with it.

None of these touch what data the feed shows — only how the existing
avatars and header line up.

## What it was required to do

- When exactly one provider overflows the 3-avatar strip, render that
  provider's actual avatar (logo or initials fallback) instead of a
  placeholder circle — but keep the count at 2+ overflow providers
  rendering the generic "+N" circle, since provider names don't fit there.
- Keep the adjacent numeric caption ("+1", "+2", ...) unchanged for every
  overflow count, including exactly one, since provider names can be too
  long to fit next to the summarized source list.
- Fix the "+N" circle's legibility for two or more hidden providers: the
  digits read as off-center at the shipped size.
- Align the desktop header logo flush with the app shell's edge, and
  account for every layout consequence of doing so rather than patching
  around it with compensating margins.
- No backend, schema, MCP tool, or `feed.json` change — this is
  presentation-only inside the shared feed UI.

## How it was implemented

Entirely inside `views/_shared/feed/`, the code shared by both feed hosts
(the MCP `get-feed` View and the standalone static site).

- **`StoryCard.tsx`** — the avatar-stack overflow slot now branches three
  ways: `extra === 1` renders `<Avatar providerName={uniqueSources[shown.length].providerName} />`
  (the real, fourth provider), `extra > 1` keeps the existing `+{extra}`
  circle, and `extra === 0` renders nothing. `extra === 1` is only
  reachable when `uniqueSources.length === 4` (3 shown, 1 left over), so
  `uniqueSources[shown.length]` always points at a real, in-bounds
  element. A provider with no known logo needs no extra handling —
  `Avatar`'s existing initials fallback already covers it. The adjacent
  `.source-count` caption's `+${extra}` suffix is untouched: it stays
  numeric at every count, `extra === 1` included.
- **`feed.css`** — `.avatar.more` (the "+N" circle, now only ever 2+) gets
  its own `font-family: sans-serif; font-size: 12px; line-height: 1`,
  overriding the `var(--font-mono)` / 9px it inherited from `.avatar`.
  Root cause: the mono family (Scoutie Sans) is a display font, not a true
  monospace, and its "+" glyph carries asymmetric side-bearings against a
  digit — `place-items: center` (also inherited from `.avatar`) centers
  the circle but not the visible glyphs inside it. The override is scoped
  to `.avatar.more` alone, so `.avatar`'s initials fallback (a provider's
  first letter) keeps the original mono family.
- **`feed.css`** — `.app-shell`'s `padding-inline: var(--space-6)` at
  `>=640px` is deleted, not overridden. It was a second inset stacked on
  top of the one each child already applies (`.feed-header`'s
  `--header-pad-x: var(--space-8)`, `.story-feed`'s `padding-inline:
  var(--space-6)`), and it held `.brand-logo` 24px short of the shell's
  edge — the logo's existing `margin-left: calc(-1 * var(--header-pad-x))`
  pull-back only reaches `.feed-header`'s own edge, not the shell's.
- **`test/unit/feed-css.test.ts`** — three new `describe` blocks: one
  asserting the avatar-stack JSX branches on `extra` exactly as above and
  that the caption stays numeric; one asserting `.avatar.more` drops the
  mono family and sets a font size above the base 9px; one asserting the
  shell rule has no `padding-inline` at desktop, the header rule is
  unchanged, and the base (mobile) header/logo rules are untouched.

### Notable decisions

- **Deletion, not cancellation.** An earlier version of the logo fix
  cancelled the shell's padding with a negative `margin-inline` on
  `.feed-header` plus a `--header-pad-x` fold, then added compensating
  bumps elsewhere. Both were rejected in favor of the plain one-line
  deletion that's now in the diff: no compensating margins anywhere, on
  the reasoning that a padding stacked on top of a padding is a bug in
  the shell, not something to work around at each child.
- **Accepted downstream consequences of the deletion**, all reviewed:
  every desktop element (header controls, cards, empty state) sits 24px
  closer to the shell's edges; the header's background and border-bottom
  now span the full shell width instead of being inset; and because
  `.app-shell` is `border-box` with `max-width: 960px`, the content box
  widened by 48px, moving the story grid's 1-column to 2-column threshold
  from 744px down to roughly 696–711px. Verified acceptable at 696px,
  711px (with a scrollbar), and 743px. Mobile (`<640px`) and the MCP View
  (`.newsroomFeed--mcp`, which opts out of the desktop breakpoint
  entirely) are untouched.
- **12px was chosen for the "+N" circle** after 9px (off-center) and after
  the UI review compared alternatives: 11px read as timid in the 26px
  circle, 13px started crowding it, 12px was confirmed subpixel-centered.
- **No DOM/React test harness exists in this repo.** The new tests follow
  the established `feed-css.test.ts` convention — `readFileSync` plus
  regex assertions over the CSS and JSX source text — rather than
  introducing jsdom or `@testing-library` for three small checks.

### Verification

`npm run verify`: 14 test files, 175 tests, no type errors. `npm run
build` and `npm run build:site` both succeed. Code review: approved, no
blocking items. `npm run review:ui`: verdict Ready, no findings —
evidence captured at mobile (390x844), desktop (1440x1000, light and
dark), the MCP App, and the 696/711/743px grid-transition widths. That
run's output lives under the git-ignored `.ui-review/` directory, so it's
a local artifact rather than something committed to the repo.
