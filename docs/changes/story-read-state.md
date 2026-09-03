# Locally-tracked read state

**Status:** shipped · **Branch:** `dev/story-read-state`

## What it is and why

The feed gets re-read across sessions, but nothing distinguished a story you'd
already opened from one you hadn't. Every visit started from scratch: same
cards, same order, no memory of what you'd already read.

This change adds read tracking entirely on the client. Opening a story marks
it read, read cards are visually de-emphasized, and the header shows an "N
new" unread count. It's `localStorage` in the browser — no change to
`feed.json`, no schema change, no backend, no new dependency. It lives in
`views/_shared/feed/`, the code shared by both feed hosts, so it ships to the
standalone static site (`variant="site"`) and the sandboxed `get-feed` MCP
View (`variant="mcp"`) at once.

## What it was required to do

- Prune stored read ids to the intersection with the current feed on load,
  then write the pruned set back, so storage never grows past the roughly 50
  stories a snapshot holds.
- Mark a story read only through the existing `openStory` path — opening the
  `SourceSheet`. No scroll tracking, no `IntersectionObserver`, no hover.
  Opening an already-read story is a no-op.
- Count unread against the full, unfiltered story list, not whatever the
  search/provider/tag filters currently show. Render the count as real DOM
  text, not color alone, and omit it from the DOM entirely at zero.
- Keep read cards fully legible and fully interactive. The read/unread
  distinction needs a signal beyond color and beyond opacity.
- Degrade silently if storage throws, holds malformed JSON, or has no read-id
  key at all — never crash the feed over it.

## How it was implemented

- `views/_shared/feed/formatters.ts` — two new pure functions:
  `pruneReadIds(storedIds, currentFeedIds)` and `unreadCount(stories,
  readIds)`. Unit-tested in `test/unit/feed-formatters.test.ts`.
- `views/_shared/feed/FeedApp.tsx` — a `READ_IDS_STORAGE_KEY =
  "newsroom-read-ids"` constant, `getInitialReadIds()`, a prune effect keyed
  on `[stories]`, and a persist effect keyed on `[readIds]`. Mirrors the
  existing theme/sort-mode persistence pattern already in this file.
- `views/_shared/feed/StoryCard.tsx` — an `isRead` prop and an
  `.unread-marker` element.
- `views/_shared/feed/FeedHeader.tsx` — an optional `unreadCount` prop
  rendering the "N new" badge.
- `views/_shared/feed/feed.css` — `.unread-count`, `.story-card--read`,
  `.unread-marker`.
- `test/unit/feed-css.test.ts` — regex guards on the new CSS rules.

Two decisions here are worth recording, because both are non-obvious and a
future edit could easily undo them.

**The read set is three-state: `Set<string> | undefined`.** `undefined`
means `localStorage` was unreadable this session — sandboxed MCP View hosts
can throw on access — while an empty `Set` means a genuine first visit.
`StoryCard` takes `isRead: boolean | undefined` and renders the marker only
on an explicit `false`, so when storage is unavailable the cards render
exactly as they did before this feature: no markers, no badge. An earlier
revision collapsed this to a plain boolean with `?? false`, which lit up
every card as unread whenever storage failed.

**Read-card de-emphasis is border-only.** An earlier revision also shifted
the read card's background to `--surface-warm`. That drops `--muted` text —
used at 11px by `.story-meta-row` and `.source-count` inside the card — from
4.76:1 to 4.23:1 contrast against the light theme, under the WCAG AA 4.5:1
floor for normal text. (Dark theme was unaffected.) The background shift was
dropped; the read signal is the softened border plus the absent unread
marker. `test/unit/feed-css.test.ts` now fails if any
`story-card--read`-scoped rule sets `background`, `background-color`,
`color`, or `opacity`, so the tint doesn't come back unnoticed.
