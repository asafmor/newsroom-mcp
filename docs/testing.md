# Testing

Three layers, same shape as `hattrick-mcp`:

## 1. Unit tests (`test/unit/`, `npm run test`)

- Repositories: open a fresh **in-memory** SQLite database
  (`openDatabase(":memory:")`) per test — real SQL, no mocking, fast.
- Services: same in-memory SQLite repos, not hand-rolled fakes — e.g.
  `feed-service.test.ts` exercises `FeedService`'s decay ranking against a
  real `SqliteStoryRepository`.
- Providers: stub `global.fetch` with `vi.stubGlobal("fetch", ...)`,
  returning real `Response` objects built from inline XML/JSON fixtures.
  No real network calls.
- Run with `npm run test` (excludes `test/live/**`).

## 2. Protocol test (`test/mcp-server.test.ts`)

Starts the real server (`index.ts`, unmodified) on an ephemeral port and
drives it through the actual MCP SDK client
(`StreamableHTTPClientTransport`), the way a real MCP client would. Uses
`NEWSROOM_DB_PATH=":memory:"` and stubs `global.fetch` for provider URLs
only — the MCP client's own HTTP traffic to the local test server passes
through to the real `fetch` untouched (stubbing that too breaks version
negotiation over the wire; watch for this if you touch the stub).

Exercises every tool in one lifecycle: ingest → list unprocessed → create a
story → attach an item as a `meaningful-update` → update the story → list
active stories → read the feed → mark an item processed → error cases
(missing content item, missing story).

## 3. Live sanity tests (`test/live/`, `npm run test:live`)

Opt-in, gated by `NEWSROOM_LIVE_TESTS=1` (`describe.skipIf`). No mocks at
all — hits the real RSS/Hacker News APIs through the real MCP tool
surface. Verifies the happy path actually works end to end, not just that
the code compiles against a mock.

A single flaky provider must not fail the suite: `IngestionService` catches
per-provider errors and continues (see `docs/architecture.md`), so the live
test asserts `providersProcessed >= 19` (not `=== <total>`) and
`itemsFetched > 0` rather than requiring every provider to succeed.

```bash
npm run test        # unit + protocol, no network
NEWSROOM_LIVE_TESTS=1 npm run test:live   # + real RSS/HN + real MCP tool calls
npm run verify       # lint + test + typecheck
```
