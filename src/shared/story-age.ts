// Lives in src/shared/ (not src/services/) because both the server-side
// FeedService and the browser-side podcast UI need this number, and
// views/ must not import from src/services/ — that layer pulls in
// domain/repository/provider types the browser bundle has no business
// carrying. src/shared/ is the existing bridge for exactly this (see
// summary-format.ts, already imported by views/).

/**
 * How many days a story may go without a meaningful update before the
 * reader-facing feed hides it.
 *
 * Feed-only: get-active-stories (the AI's triage view) sees every active
 * story regardless of age, so it can still archive/update a story that's
 * fallen off the feed.
 *
 * Also the single source of truth for the window a published podcast
 * episode actually covers (views/_shared/podcast/formatters.ts) — an
 * episode summarizes whatever the feed considered fresh at the moment the
 * curating agent generated its script, i.e. stories meaningfully updated
 * within this many days of publishedAt.
 */
export const MAX_STORY_AGE_DAYS = 7;
