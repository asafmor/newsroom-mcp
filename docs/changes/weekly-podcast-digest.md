# Weekly podcast digest

**Status:** shipped · **Branch:** `dev/weekly-digest-episodes`

## What it is and why

The idea: a weekly audio podcast that summarizes the top stories from the
curated feed — generated from data the project already produces, published
automatically every Friday morning, playable at any time afterward, with a
browsable history of every past episode rather than one "current" file that
gets overwritten.

## The design pivot that made this feasible

An initial analysis concluded that real synthesized audio was infeasible
under the project's static-site constraint (the reader surface is a
committed JSON snapshot plus a client-side build, with no server to host
media) and proposed falling back to the browser's `SpeechSynthesis` API. The
user rejected that — a robotic, non-persistent, device-dependent voice
wasn't the feature they asked for — and supplied an OpenAI TTS key instead,
so the design was redone around real synthesized audio.

The unlock was realizing the actual constraint had been misdiagnosed. The
`feed` branch already carries committed binaries (the site build's PNGs),
and `.git` was still only about 2.8 MB — so the real constraint was
*unbounded growth*, not binaries as such. Audio files are far larger than
PNGs and accumulate weekly forever, so the resolution keeps audio bytes out
of git entirely: each episode's MP3 is hosted as a GitHub Release asset,
referenced by URL from a small JSON snapshot. That also removed any cap on
episode history — Releases, unlike a committed file, don't make the repo
grow without bound in a way anyone has to prune.

## What it was required to do

- Produce one episode automatically each week, covering that week's top
  stories, without new manual work in the curation run beyond what the
  agent already does.
- Keep every past episode playable, not just the latest — a real, persisted
  history, browsable and playable on demand.
- Fit the existing reader-facing surface and its constraints, using the
  same periodic-work pattern the project already relies on (a scheduled
  GitHub Actions workflow) rather than a new kind of server or infra.
- Keep the server's existing division of labor: judgment calls (writing
  the episode) stay with the AI agent; mechanical, deterministic work
  (turning text into audio, publishing it) stays out of the MCP server and
  out of agent reasoning entirely.
- Disclose, visibly and adjacent to every player, that the narration is
  AI-generated — a requirement of OpenAI's usage policy for synthesized
  voice, not just a nice-to-have.

## How it was implemented

The feature splits into two phases along exactly the semantic/mechanical
line `docs/architecture.md` already draws for the rest of the system.

### Phase 1 — the agent writes the script (during a normal curation run)

- A new MCP tool, `submit-podcast-episode`, lets the curating agent submit
  a title plus an ordered array of spoken-style transcript **segments**
  (`src/tools/submit-podcast-episode-tool.ts`, schema in
  `src/tools/schemas.ts`). The agent is told to start a new segment at
  each story transition. This array shape — not one long string — is what
  makes chunking safe later: the OpenAI TTS API has a hard 4096-character
  input limit per request, and each segment is capped at 1,500 characters
  (`PODCAST_SEGMENT_MAX_CHARS`, `src/domain/podcast.ts`), well under that
  limit, so a downstream chunk built by packing whole segments together can
  never itself exceed it. Total script length is validated to fall between
  4,500 and 9,000 characters — roughly 5-10 minutes of speech at 150 words
  per minute.
- A second, read-only tool, `get-podcast-status`
  (`src/tools/get-podcast-status-tool.ts`), reports the current ISO week,
  whether an episode already exists for it, whether one is "due", and
  metadata-only summaries (never transcripts) of recent episodes. The
  agent calls this once per curation run alongside the existing `get-feed`
  confirmation step.
- **Storage:** a new migration, `src/sqlite/migrations/003_podcast_episodes.sql`,
  adds a `podcast_episodes` table with `UNIQUE (iso_week)` — the one
  episode per ISO calendar week rule is enforced by the database itself,
  not just application code, mirroring how `content_items` already enforces
  its own uniqueness. `PodcastRepository` / `SqlitePodcastRepository`
  expose `create` (throws `PodcastWeekConflictError`, whose message already
  names the conflicting episode, on a duplicate week),
  `findByIsoWeek`, `findRecent`, and `findAll`. Episodes are immutable once
  submitted — there's no update or delete.
- **ISO week logic:** `src/shared/iso-week.ts` implements ISO-8601 week
  numbering (Monday start, week 1 contains the year's first Thursday) as
  pure, dependency-free functions that always take a reference time as an
  argument rather than reading the wall clock — so tests are deterministic,
  including at year boundaries and week-53 years. "Due" is defined as: no
  episode yet for the current ISO week, and the reference time is at or
  after 08:00:00 UTC on that week's Friday. This lives in `src/shared/`
  rather than `src/services/` because it's pure logic consumed by both the
  server (`PodcastService`) and the view layer (episode date-range
  formatting), matching the precedent set by `src/shared/summary-format.ts`.
  Note "due" is advisory only, surfaced through `get-podcast-status` — the
  only hard-enforced rule is the database's per-week uniqueness constraint.
- `scripts/publish-podcast.ts` (new `npm run publish-podcast`) reads every
  episode from the database and writes a **text-only** `podcast.json` onto
  the `feed` branch, mirroring `publish-feed.ts`'s disposable-worktree
  pattern (a direct in-process call, no MCP round trip, so it costs no
  extra agent tokens). New episodes are added with `audioStatus: "pending"`.

### Phase 2 — mechanical synthesis (the Friday cron)

A new GitHub Actions workflow, `.github/workflows/synthesize-podcast.yml`,
runs on a `schedule:` cron at roughly 08:00 UTC every Friday, plus
`workflow_dispatch` for manual recovery. It declares `permissions:
contents: write`, a `concurrency` group with `cancel-in-progress: false`
(so an in-flight run is never killed mid-episode by the next trigger), and
an explicit step that verifies `ffmpeg`/`ffprobe` are on the runner before
anything else proceeds. It runs `scripts/synthesize-podcast.ts` — the same
script a developer can run locally with `OPENAI_API_KEY` set — so CI and
local runs share one code path, not two.

For every episode marked `pending` or `failed` in `podcast.json` (failures
self-heal automatically on the next run):

1. **Chunking** (`src/podcast/chunking.ts`): greedily packs whole segments,
   in order, into TTS requests under the 4096-character limit — a chunk
   never splits a segment mid-sentence, since each segment was already
   validated well under that limit at submission time.
2. **Synthesis** (`src/podcast/tts-client.ts`): calls `gpt-4o-mini-tts` via
   native `fetch()` — no `openai` SDK, no new runtime dependency — with
   retry-with-backoff (3 attempts by default). Every chunk of an episode
   resends that episode's stored voice and instructions identically; tone
   never drifts partway through an episode.
3. **Concatenation** (`src/podcast/ffmpeg.ts`): joins the chunk MP3s with
   ffmpeg's concat demuxer **and re-encodes** (`-c:a libmp3lame -b:a
   128k`) — deliberately never `-c copy` and never a naive byte
   concatenation, both of which produce wrong duration/seek behavior and
   audible seams between chunks. Final duration comes from probing the
   concatenated file with `ffprobe`, not from summing estimated per-chunk
   durations.
4. **Publishing** (`src/podcast/github-api.ts`): uploads the MP3 as a
   per-episode GitHub Release asset, tagged `podcast-<ISO week>`. The
   upload is idempotent — it reuses an existing release for that tag and
   replaces any existing asset of the same name — and verifies/corrects the
   served content type (`audio/mpeg`) after upload, since the public
   GitHub API offers no direct "edit content type" call.
5. **Result write-back**: `podcast.json` is rewritten for that one episode
   to `audioStatus: "ready"` with its URL/duration/size/MIME type, or
   `"failed"` with a short, non-sensitive failure reason (built only from
   HTTP status codes and ffmpeg/ffprobe stderr — never a raw stack trace or
   a secret).

Every episode is synthesized and published independently, inside its own
try/catch: one episode's synthesis or publish failure never blocks or
starves the others. A publish failure (e.g. persistent push contention)
still makes the script exit non-zero, so CI reports it rather than a false
green.

### The reader surface (standalone `site/` only)

`site/src/main.tsx` fetches `podcast.json` the same way it already fetches
`feed.json`, and mounts the new `PodcastApp`
(`views/_shared/podcast/PodcastApp.tsx`) below the story feed. Each episode
card:

- Plays with a native `<audio controls preload="none">` — no autoplay —
  when `audioStatus` is `"ready"`.
- Shows a plain status message ("still being produced" / "couldn't be
  produced, we'll retry automatically") for `"pending"`/`"failed"`, with
  the full transcript always available as real on-page text underneath —
  never gated behind the audio.
- Carries a visible AI-generated-voice disclosure directly adjacent to the
  player, required by OpenAI's usage policy for synthesized speech.
- Labels the episode primarily by its human calendar range ("Aug 31 – Sep
  6, 2026", computed from the ISO week id via `src/shared/iso-week.ts`),
  with the raw ISO week code as secondary metadata — a bare `2026-W37`
  doesn't tell a reader what dates it covers.
- Defaults the transcript panel open for pending/failed episodes (where
  it's the only usable content) and collapsed for ready ones (where the
  player is the primary affordance).

A slim "Weekly digest" entry in the site header links to the latest
episode for discoverability. The shared `PodcastApp`/`EpisodeList`
components render nothing when given no episode data, so nothing needed to
change on the MCP View side — View parity (playback inside the MCP App
itself) is explicitly deferred, not shipped here.

### Notable engineering decisions

- **Everything that touches the outside world sits behind an injectable
  seam**: the TTS HTTP call (`TtsRequestFn`), the ffmpeg/ffprobe shell-outs
  (`ProcessRunner`), and the GitHub Release API (`GithubApi`) are all
  interfaces with one real implementation each, wired only in
  `scripts/synthesize-podcast.ts`. `npm run verify` therefore never needs a
  secret, makes no network call, and never shells out to a real binary —
  332 tests pass with lint and typecheck clean.
- **`OPENAI_API_KEY` is deliberately not part of `src/config.ts` /
  `NewsroomConfig`.** The MCP server itself never calls TTS; the key is
  read directly from `process.env`, script/CI-only.
- **`podcast.json` writes are merge-only, in both directions.** Phase 1
  (`mergeNewEpisodes`) only ever adds new episodes as `pending` and never
  regresses an already-`ready` episode back to `pending`. Phase 2
  (`applyAudioResult`) only ever patches one episode's audio fields,
  leaving every other episode untouched. Both guard against a no-op
  rewrite that would otherwise churn `generatedAt` (and the commit
  history) with no real content change. Neither script ever stages
  `feed.json` — only `podcast.json`.
- **Push-retry loop for a now-three-writer branch.** `feed` already had two
  writers (`publish-feed.ts`, the site-deploy workflow); this feature adds
  a third and fourth (`publish-podcast.ts`, `synthesize-podcast.ts`).
  `scripts/lib/podcast-worktree-publish.ts` fetches, recomputes against the
  latest remote state, and retries the push up to 3 times on a
  non-fast-forward rejection — the "rebase" here is just an optimistic
  recompute, which is correct because `podcast.json` is a single-file,
  merge-only artifact with no real conflict to resolve.
- **A pre-existing bug was fixed along the way**: the site-deploy workflow
  (`.github/workflows/deploy-feed-site.yml`) deleted every file on the
  `feed` branch except `feed.json` on every deploy. Left as-is, the first
  site deploy after this feature shipped would have silently destroyed
  `podcast.json`. The cleanup step's exclusion list now also excludes
  `podcast.json`.
- **Published history is capped independently of stored history.**
  `podcast.json` keeps only the 26 most recent episodes
  (`PODCAST_HISTORY_WINDOW`, roughly 250-300 KB worst case) to bound the
  committed payload; full history remains in SQLite and in the GitHub
  Releases regardless of what's currently published.

### Verification

`npm run verify` passes: 332 tests across 29 files (up from a 130 baseline
much earlier in the project's history), lint clean, no type errors. New
test files cover ISO week math at year/week-53 boundaries
(`test/unit/iso-week.test.ts`), chunking, the TTS client's retry behavior,
ffmpeg/ffprobe wrapping, the GitHub Release API seam, the merge-only
`podcast.json` state machine, the end-to-end per-episode synthesis
pipeline, push-retry, the podcast repository, the podcast service, the new
tool schemas, and the new UI components.

## Honest limitations

- GitHub disables `schedule:`-triggered workflows after 60 days with no
  commits to the default branch — silently. `workflow_dispatch` exists
  partly as the manual recovery path, though a manual run does not itself
  reset that 60-day clock (only a push to `main` does).
- Cron trigger times are best-effort on GitHub's infrastructure and can
  slip past 08:00 UTC.
- There is no podcast RSS feed (`<enclosure>`), so episodes aren't
  distributed through Apple Podcasts, Spotify, or any other podcast app —
  playback is web-only, on the standalone site.
- No backfill for a missed week, no episode edit or delete, and no
  user-facing retry button — a failed episode retries automatically on the
  next scheduled or manually dispatched run only.
- MCP View / MCP App playback is not shipped; only the standalone site
  renders episodes.
- Phase 2 requires the `OPENAI_API_KEY` GitHub Actions secret to be
  configured on the repository, or the workflow fails at the synthesis step.

## Operator notes

- After a curation run's usual `get-feed` confirmation step, run `npm run
  publish-feed` followed by `npm run publish-podcast` to publish any new
  episode script as `pending`.
- `npm run synthesize-podcast` runs Phase 2 — normally left to the Friday
  CI workflow, but runnable locally with `OPENAI_API_KEY` (and
  `GITHUB_TOKEN`/`GITHUB_REPOSITORY`) set in the environment.
