# Podcast UI fixes

**Status:** shipped · **Branch:** `dev/podcast-ui-fixes`

## What it is and why

A bug-fix batch against the weekly podcast digest shipped in
`weekly-podcast-digest.md`. Seven separate reports came in against the
same feature: three cosmetic (a link that should read as a badge, a
transcript toggle sitting too far from the card edge, the digest card
blending into the story list beneath it), two informational (the wrong
date range, duration in the wrong place), and two functional (no
highlight tracking playback, and audio that silently failed to play on
iOS). None needed new capability — the feature works as designed; this
fixes how it looks and behaves.

## What it was required to do

Each report needed a working fix, not just a rendered "looks right"
screenshot:

- The "Ready to play" status should look like a status chip, not a link
  competing with the play control.
- "Show transcript" should sit flush with the card's own content edge.
- The currently-narrated line should highlight, keeping pace with actual
  audio playback (pause/seek/scrub included).
- Playback must work on iOS Safari/Chrome, with a real error surfaced if
  it doesn't rather than a silent failure.
- The digest card should read as visually distinct from the story cards
  below it.
- The date range shown must be the dates the episode actually covers, not
  a calendar week that may not overlap them.
- Duration should sit next to the week number, not below the player.

## How it was implemented

### 1. Status badge and 2. transcript toggle spacing

Two small CSS changes in `views/_shared/feed/feed.css` and
`views/_shared/podcast/podcast.css`. `.digest-bar-status` became a pill
chip using the existing `--accent-soft`/`--radius-pill` tokens instead of
plain link-colored text. `.podcast-transcript-toggle`'s padding dropped
its horizontal component (`var(--space-1) var(--space-2)` →
`var(--space-1) 0`), so the label lines up with the rest of the card
instead of sitting one `--space-2` in from it.

### 3. Transcript highlighting

A new pure function, `activeSegmentIndex()`
(`views/_shared/podcast/formatters.ts`), estimates which transcript
paragraph is currently playing from the `<audio>` element's own
`currentTime`: it assumes narration speed is constant and gives each
segment a start time proportional to how many characters precede it
(`duration * charsBefore / totalChars`). `PodcastApp.tsx` lifts
`currentTime` into `EpisodeCard`, feeding an `onTimeUpdate` handler on the
audio element — no separate timer, so pause/seek/scrub stay correct for
free — and passes the resulting `activeIndex` down to `Transcript`, which
sets a CSS class plus `aria-current` on the matching paragraph.

`currentTime` starts as `null` and only becomes a number on the first real
`onTimeUpdate` event, so nothing is highlighted before playback starts —
confirmed by the UI review (no `aria-current` paragraph before playback).

This is a character-proportional estimate, not a real timestamp: it drifts
on TTS sentence pauses and on spelled-out numbers or acronyms. The code
carries a comment naming that ceiling and its fix — recording real
per-chunk `ffprobe` offsets in `podcast.json` and looking those up instead
of estimating.

### 4. iOS playback failure

The actual bug, and the one worth reading closely: episodes were hosted
as GitHub Release assets. Release assets are served as
`application/octet-stream` with `Content-Disposition: attachment` and no
CORS headers. iOS/WebKit routes `<audio>` through AVFoundation, which
requires a genuine `audio/*` content type and honors the attachment
disposition — so playback failed there (Chrome on iOS uses WebKit too,
which is why the report named it). Two workarounds were ruled out first:
fetching to a Blob URL is blocked by the missing CORS headers, and no CDN
can front a Release asset to fix the content type.

The fix moves audio hosting off Releases entirely, onto the same static
site that already serves `feed.json`/`podcast.json`: each episode's mp3
now lands at `audio/<episode.id>.mp3` on the `feed` branch (GitHub Pages),
served with the correct MIME type and range-request support, referenced
from `podcast.json` as a plain relative URL.

Supporting changes this pulled along:

- `src/podcast/github-api.ts` and its test are deleted — dead code, since
  nothing uploads to Releases any more.
- `synthesize-episode.ts` no longer uploads; it returns a
  `SynthesisOutcome` carrying the local scratch-file path instead.
- `scripts/synthesize-podcast.ts` copies that mp3 into the publish
  worktree and prunes any `audio/*.mp3` no longer referenced by a `ready`
  episode in the published (already-windowed) `podcast.json`, so the
  branch doesn't accumulate orphaned files.
- `scripts/lib/podcast-worktree-publish.ts` gained an optional
  `syncFiles` hook and switched from `git add podcast.json` to
  `git add -A`, so the mp3 and the `podcast.json` update land in the same
  commit — `podcast.json` must never point at an mp3 that hasn't been
  pushed yet.
- `src/podcast/ffmpeg.ts` now encodes with `-ac 1 -b:a 64k` (down from
  128kbps stereo). The bitrate cut is what roughly halves the file
  (~7.1MB → ~3.4MB); mono alone doesn't shrink a fixed-bitrate encode, it
  just stops spending that bitrate on a duplicated channel for a single
  narrated voice. This matters now because the file is committed straight
  into git instead of living in a Release.
- `.github/workflows/deploy-feed-site.yml`'s cleanup step now excludes
  `audio` alongside `feed.json` and `podcast.json` — otherwise a routine
  site deploy would delete the audio directory it doesn't own.
- A new `describeMediaError()` in `PodcastApp.tsx` maps the `<audio>`
  element's `onError` event to a short, human-readable message (network,
  decode, unsupported format, or generic), since iOS/WebKit in particular
  surfaces a contentless `MediaError` with no detail of its own. The
  transcript stays reachable underneath rather than the card failing
  silently.

**This fix has one required manual follow-up after merge:** the episode
already published before this change (`podcast-2026-W37`) still points at
its old Release URL. Its `audioStatus` needs to be flipped to `pending` on
the `feed` branch so the next synthesis run republishes it under the new
Pages hosting. Until that happens, the live site's one existing episode
keeps the broken URL, and iOS playback stays broken for it in practice.

### 5. Card elevation

`.podcast-shell` picked up `background: var(--surface)`,
`border-radius: var(--radius-lg)`, and `box-shadow: var(--elev-raised)` —
the same tokens the story cards already use, not new ones. Under 640px
the radius narrows and the shell gets side margin, so the card doesn't
clip its own rounded corners against the viewport edge.

### 6. Wrong date range

Root cause: an episode's `isoWeek` field is just an identifier — one
episode per calendar week, enforced by SQLite. What an episode actually
*narrates* is whatever the curating agent's `get-feed` call considered
fresh at the moment it wrote the script, which is not the same window.
Episodes are submitted mid-week (the real `podcast-2026-W37` episode was
submitted on a Wednesday), and "due" is advisory only — so the ISO week
can start before the covered content and even extend into the future
relative to it.

`formatIsoWeekRange(isoWeekId)` is replaced by
`formatCoveredDateRange(publishedAt)`, which derives the covered window
directly as `[publishedAt - MAX_STORY_AGE_DAYS, publishedAt]` — the same
staleness window the feed itself uses to decide what's fresh.
`MAX_STORY_AGE_DAYS` moved out of `feed-service.ts` into a new
`src/shared/story-age.ts`, now the single source of truth for both
`FeedService` and this formatter (views/ may not import from
`src/services/`, so it couldn't stay there). The now-unused ISO-week
helpers (`mondayOfIsoWeek`, `isoWeekDateRange`, `parseIsoWeekId`, the
`IsoWeekDateRange` type) were deleted from `src/shared/iso-week.ts`. The
raw ISO week code itself is unchanged and stays on the card as secondary
metadata, next to the corrected date range.

### 7. Duration placement

Moved into `.podcast-card-dates`, next to the week number; the old
`.podcast-audio-meta` block below the player is gone. Under 640px the
whole card head stacks: the title takes its own full-width row, and the
metadata becomes a left-aligned, wrapping row beneath it (at 320px the
metadata column alone was wider than the space left for the title
side-by-side).

## Verification

`npm run verify` (lint, 330 tests, typecheck), `npm run build`, and
`npm run build:site` all pass. A read-only UI/UX review returned "ready
for the scoped podcast UI changes" with no remaining actionable findings,
with evidence at 320px, 390px, and 1440px confirming: no `aria-current`
paragraph before playback starts, zero layout shift as the highlight
advances, and correct mobile/desktop metadata layout.

## Known limitations

- Transcript highlighting is a character-proportional estimate, not real
  per-segment timing — it drifts on TTS pauses and on spelled-out numbers
  or acronyms.
- The iOS fix could not be verified on a physical iOS/WebKit device in
  this environment.
- The already-published `podcast-2026-W37` episode needs its
  `audioStatus` manually flipped to `pending` on the `feed` branch after
  merge (see above) — this is required, not optional, for iOS playback to
  actually work in production.
- `podcast-worktree-publish.ts`'s new `syncFiles` hook has no dedicated
  unit test yet.
