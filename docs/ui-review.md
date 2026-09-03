# UI/UX Review

Newsroom uses one read-only UI/UX review operation. The reviewer inspects the
current implementation, gathers visual and runtime evidence, and returns
advice to the developer that requested the review. The reviewer never edits
the product.

## Run a review

From the checkout under review:

```bash
npm run review:ui -- --request "Review the current uncommitted UI changes"
```

From another checkout or an automation manager that already knows the feature
worktree:

```bash
npm run review:ui -- \
  --worktree "$WORKTREE" \
  --request "Review the implemented feature against its requirements and current diff"
```

For a long request, pass a file:

```bash
npm run review:ui -- \
  --worktree "$WORKTREE" \
  --request-file /tmp/newsroom-ui-review-request.md
```

An automated coding agent can request machine-readable output:

```bash
npm run --silent review:ui -- \
  --worktree "$WORKTREE" \
  --format json \
  --request-file /tmp/newsroom-ui-review-request.md
```

On success, the command exits with status 0. JSON output contains
`sessionId`, `worktree`, `runDirectory`, `reportPath`, and the full Markdown
`report`. Failures use a nonzero exit status and write the reason to standard
error. Use `--silent` when consuming JSON so npm does not add script banners to
standard output.

The first call creates a dedicated Codex reviewer session for that resolved
worktree. Later calls resume the same session. Each worktree stores its own
session metadata and evidence under `.ui-review/`, which Git ignores.

Session memory provides continuity, but it is never current-state evidence.
Every review rereads the checkout, current guidance, requirements, and diff.

Before launching Codex, the wrapper refreshes the `origin/feed` ref when
possible and copies the newest available published `feed.json`, current
standalone source, and shared view source into the run directory. The prepared
site therefore uses realistic current content without overwriting the tracked
`site/feed.json`. The wrapper also allocates fresh ports so unrelated or stale
development servers cannot supply review evidence.

For the MCP App context, the reviewer starts the supplied fresh MCP endpoint
and runs `mcp-use screenshot --tool get-feed`. The launcher discovers a system
Chrome or Playwright's bundled Chromium and exposes it through
`MCP_USE_CHROME_PATH`. The resulting `mcp-app-overview.png` is the required
baseline evidence. An Inspector dashboard or tool form without the rendered
feed is explicitly invalid as MCP App evidence.

## What the developer receives

By default, the command prints the reviewer's Markdown report to standard
output. It always saves `report.md`, `result.json`, and screenshots under the
run directory named at the start of the command. The report contains:

- a clear verdict and the review scope;
- the mobile, desktop, and actual MCP App evidence examined;
- strengths worth preserving;
- prioritized findings with screenshot paths and runtime evidence;
- concrete design direction for each finding;
- uncertainties and anything the reviewer could not verify.

The calling developer decides what to change. If it changes the UI and wants
another opinion, it runs the same command again. This is a new review of the
current state, not a separate confirmation mode.

## Boundaries

The reviewer may start and stop local development servers and write evidence
inside `.ui-review/`. It must not edit source code, tests, documentation,
configuration, snapshots, or Git state. It must not commit, push, publish, or
open a pull request. The launcher fingerprints tracked and untracked repository
content before and after the review and fails if the reviewer changes it.

The review is not a screenshot test or CI gate. It is an expert consultation
for an automated developer workflow.
