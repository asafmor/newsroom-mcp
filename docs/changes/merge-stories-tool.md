# merge-stories tool

**Status:** shipped · **Branch:** `dev/merge-stories-tool`

## What it is and why

`IDEA.md` §49 flagged `merge_stories` as a likely-needed future tool: the
curating agent may create "OpenAI launches Model X" and "OpenAI launches
Model X API" as separate stories, then later realize they're the same
evolving event. Before this change, fixing that meant direct database
manipulation. This ships the explicit tool `IDEA.md` called for.

## What it was required to do

- Accept a surviving story id and a losing story id and merge the losing
  story into the surviving one.
- Reject a self-merge, and do so before any existence check, so the caller
  gets the clearer "cannot merge into itself" error rather than a
  not-found.
- Require both stories to exist, naming the missing id if not.
- Require both stories to be `status: "active"`, naming the offending
  story and its status if not.
- Move every content item off the losing story onto the surviving story
  without violating the `UNIQUE(story_id, content_item_id)` constraint
  when an item happens to be attached to both.
- Reconcile the surviving story's timestamps rather than blindly stamping
  "now", so a merge can't be used to artificially refresh a stale story.
- Archive the losing story as part of the same operation.
- Return the surviving story in the same shape as `create-story`,
  `attach-item-to-story`, and `update-story`.
- Do the mutation atomically — no partially-merged state on failure.

## How it was implemented

Ninth MCP tool, following the repo's existing thin-tool convention:

- `src/tools/merge-stories-tool.ts` (new) — validates via
  `mergeStoriesInputSchema`/`mergeStoriesOutputSchema` (`src/tools/schemas.ts`,
  input `{ survivingStoryId, losingStoryId }`, output = `storySchema`), calls
  `StoryService.mergeStories`, serializes with `serializeStory`, and returns
  errors via `toolErrorResult`. Registered in `src/composition.ts` alongside
  the other eight tools.
- `StoryService.mergeStories` (`src/services/story-service.ts`) owns all
  validation: self-merge check first, then both-exist checks, then
  both-active checks, before delegating to the repository. Keeping
  validation in the service (not the repository) matches this repo's
  layering — `src/sqlite/` shouldn't own business rules.
- `SqliteStoryRepository.mergeStories` (`src/sqlite/sqlite-story-repository.ts`)
  does the actual mutation inside one `BEGIN`/`COMMIT`/`ROLLBACK`
  transaction: retarget the loser's `story_items` rows onto the survivor,
  reconcile the survivor's timestamps, archive the loser — all or nothing.
- No schema migration was needed; the operation only touches existing
  `stories` and `story_items` columns.

### Decisions worth remembering

1. **Timestamps are reconciled from pre-merge values, never set to `now`.**
   `firstSeenAt` = min of the two (the real event started at the earlier
   discovery), `lastItemAttachedAt` = max, and critically
   `lastMeaningfulUpdateAt` = max of the two *pre-merge* values. If merge
   set `lastMeaningfulUpdateAt` to the merge time instead, a story that had
   gone quiet for 7+ days could jump back into `get-feed` (which hides
   stories with no meaningful update in that window) purely by absorbing
   another story — bypassing the same freshness rule that drives
   `FeedService`'s importance decay and `StoryService.archiveStaleStories()`'s
   30-day cutoff.

2. **Collision resolution avoids the unique index rather than fighting it.**
   `UNIQUE(story_id, content_item_id)` normally means a duplicate attach is
   a caller bug, but during a merge the same item legitimately living on
   both stories is expected. For each of the loser's `story_items` rows:
   if the survivor has no row for that item, `UPDATE ... SET story_id =`
   retargets it directly. If the survivor already has a row, the two are
   never both written — whichever has the stronger contribution
   (`meaningful-update` > `supporting` > `background`) wins and its
   reason/`attached_at` are copied onto the survivor's row (a tie leaves
   the survivor's row untouched); the loser's row is then deleted. The two
   rows never coexist, so the unique index is never at risk of a
   collision either way.

3. **Merge is mechanical only — no title/summary/score rewriting.** It
   deliberately doesn't touch the survivor's editorial fields; that stays a
   separate `update-story` call rather than duplicating
   `UpdateStoryInput`'s patch logic here. Active-status enforcement was
   also scoped to this tool only — `attach-item-to-story` and
   `update-story` keep their existing status-agnostic behavior, so no
   other tool's semantics changed.

### Also changed

- `docs/agent-system-prompt.md` now documents nine tools, with
  `merge-stories` as tool 7 plus a workflow step — without this the
  curating agent's own prompt still said "eight tools and no others" and
  would never have called the new tool.
- `docs/mcp-tools.md`, `docs/architecture.md`, and `AGENTS.md` were updated
  to reflect the ninth tool.

### Tests

61 tests passing:

- `test/unit/story-service.test.ts` (new) — validation ordering (self-merge
  before existence, existence before status) and error messages.
- `mergeStories` block in `test/unit/sqlite-story-repository.test.ts` —
  transaction behavior, timestamp reconciliation, and collision resolution
  against real in-memory SQLite.
- `test/mcp-server.test.ts` — end-to-end over the real MCP transport.

### Known gaps (recorded honestly)

- No un-merge/split tool exists — a bad merge is not reversible through the
  tool surface.
- No fault-injection test forces a genuine mid-transaction rollback
  (consistent with the existing `create`/`attachItem` test convention in
  this repo — the `ROLLBACK` path is exercised by inspection, not by test).
