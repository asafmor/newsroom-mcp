import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// No DOM/React test harness exists in this repo (see docs/testing.md) —
// these assert on the source text, the same convention test/unit/podcast-ui.test.ts
// and test/unit/feed-css.test.ts already use.

const toolRadarAppTsx = readFileSync(new URL("../../views/_shared/tools/ToolRadarApp.tsx", import.meta.url), "utf8");
const toolsCss = readFileSync(new URL("../../views/_shared/tools/tools.css", import.meta.url), "utf8");
const mainTsx = readFileSync(new URL("../../site/src/main.tsx", import.meta.url), "utf8");
const feedAppTsx = readFileSync(new URL("../../views/_shared/feed/FeedApp.tsx", import.meta.url), "utf8");
const getFeedViewTsx = readFileSync(new URL("../../views/get-feed/view.tsx", import.meta.url), "utf8");

// Mirrors test/unit/podcast-ui.test.ts's digestEntry tests — toolsEntry is
// digestEntry's sibling wiring, and the code reviewer flagged that it had
// none of its own (item 6 of the second UI-review round).
describe("Tool Radar header entry point (P1 UI-review finding: discoverability)", () => {
  it("renders toolsEntry as a .digest-bar sibling of digestEntry, inside the shared .entry-bar-row", () => {
    expect(feedAppTsx).toContain("toolsEntry");
    expect(feedAppTsx).toMatch(/<a href=\{toolsEntry\.href\} className="digest-bar" aria-label=\{toolsEntry\.ariaLabel\}>/);

    const rowIndex = feedAppTsx.indexOf('className="entry-bar-row"');
    const digestIndex = feedAppTsx.indexOf("href={digestEntry.href}");
    const toolsIndex = feedAppTsx.indexOf("href={toolsEntry.href}");
    expect(rowIndex).toBeGreaterThan(-1);
    expect(digestIndex).toBeGreaterThan(rowIndex);
    expect(toolsIndex).toBeGreaterThan(digestIndex);
  });

  it("computes toolsEntry via toolsDigestEntry, gated on the Tool Radar fetch succeeding, in site/src/main.tsx", () => {
    expect(mainTsx).toContain("toolsDigestEntry");
    expect(mainTsx).toMatch(/toolRadarState\.status === "success"\s*\?\s*toolsDigestEntry\(/);
    // Freshness (P1-b UI-review finding) comes from the same snapshot
    // fetch already driving the rest of the page — no new data plumbing.
    expect(mainTsx).toContain(
      "toolsDigestEntry(toolRadarState.entries, toolRadarState.sources, toolRadarState.generatedAt)",
    );
    expect(mainTsx).toContain('href: "#tool-radar"');
    expect(mainTsx).toContain("toolsEntry={toolsEntry}");
  });

  it("never leaks a Tool Radar (or podcast digest) link into the sandboxed MCP View", () => {
    // views/get-feed/view.tsx has no podcast/Tool Radar data to compute
    // either entry from — passing neither prop is what keeps FeedApp from
    // ever rendering .entry-bar-row inside the MCP View.
    expect(getFeedViewTsx).not.toContain("digestEntry");
    expect(getFeedViewTsx).not.toContain("toolsEntry");
  });
});

describe("Tool Radar mount point", () => {
  it("mounts as a sibling section on the standalone site, not a new route", () => {
    expect(mainTsx).toContain("ToolRadarApp");
    expect(mainTsx).toContain('fetch("./tools.json")');
  });

  it("renders an anchored section distinct from the news feed/podcast digest", () => {
    expect(toolRadarAppTsx).toContain('id="tool-radar"');
    expect(toolRadarAppTsx).toContain('aria-label="Tool Radar"');
  });

  it("does not reuse StoryCard/swipe machinery — card anatomy is new", () => {
    expect(toolRadarAppTsx).not.toContain("StoryCard");
    expect(toolRadarAppTsx).not.toContain("useSwipeToRead");
  });
});

describe("Tool Radar kind-chip filter (req. 24-25)", () => {
  it("follows the sort-tabs pattern: role=group, aria-pressed", () => {
    expect(toolRadarAppTsx).toMatch(/role="group" aria-label="Filter by kind"/);
    expect(toolRadarAppTsx).toContain('aria-pressed={kindFilter === "all"}');
    expect(toolRadarAppTsx).toContain("aria-pressed={kindFilter === kind}");
  });

  it("renders chips only for kinds actually present, via kindsPresent(entries)", () => {
    expect(toolRadarAppTsx).toContain("kindsPresent(entries)");
    expect(toolRadarAppTsx).toContain("kinds.map((kind)");
  });

  it("filters entries by the selected kind, ANDed with the bookmark filter (via bookmarkedEntries in bookmark-only mode)", () => {
    expect(toolRadarAppTsx).toContain('kindFilter === "all" || item.entry.kind === kindFilter');
    expect(toolRadarAppTsx).toContain('kindFilter === "all" || entry.kind === kindFilter');
  });
});

describe("Tool Radar bookmark tri-state discipline (req. 27a, mirrors FeedApp's getInitialReadIds)", () => {
  it("treats storage-inaccessible (undefined) as a state distinct from an empty Map", () => {
    expect(toolRadarAppTsx).toContain("function getInitialBookmarks(): Map<string, ToolEntry> | undefined");
    expect(toolRadarAppTsx).toMatch(/catch \{\s*return undefined;\s*\}/);
    expect(toolRadarAppTsx).toContain("if (raw === null) return new Map();");
  });

  it("suppresses the bookmark toggle control entirely when storage is unavailable", () => {
    expect(toolRadarAppTsx).toContain("bookmarksAvailable={bookmarks !== undefined}");
    expect(toolRadarAppTsx).toContain("{bookmarksAvailable && (");
  });

  it("hides the per-card bookmark button when storage is unavailable, rather than one that can never persist", () => {
    expect(toolRadarAppTsx).toContain("onToggleBookmark={bookmarks === undefined ? undefined : ()");
    expect(toolRadarAppTsx).toContain("{onToggleBookmark !== undefined && (");
  });
});

describe("Tool Radar bookmark persistence survives weekly snapshot turnover (P1 UI-review finding)", () => {
  it("never prunes stored bookmarks against the current run's entries", () => {
    expect(toolRadarAppTsx).not.toContain("pruneReadIds");
  });

  it("stores full ToolEntry snapshots (not bare ids), keyed by id, so a bookmark stays renderable after leaving the snapshot", () => {
    const formattersTs = readFileSync(new URL("../../views/_shared/tools/formatters.ts", import.meta.url), "utf8");
    expect(formattersTs).toContain("export function addBookmark(bookmarks: ReadonlyMap<string, ToolEntry>, entry: ToolEntry)");
    expect(formattersTs).toContain("export function bookmarkedEntries(");
  });

  it("persists the bookmark map's full entry values, not just ids, via the shared persistBookmarks helper", () => {
    const formattersTs = readFileSync(new URL("../../views/_shared/tools/formatters.ts", import.meta.url), "utf8");
    expect(toolRadarAppTsx).toContain("const persisted = persistBookmarks(next);");
    expect(formattersTs).toContain("JSON.stringify([...bookmarks.values()])");
  });

  // P1 UI-review finding (round 3): persistence used to run in an effect on
  // `bookmarks`, so the star filled (and the label flipped to "Remove
  // bookmark") a render *before* the write was attempted — a denied write
  // then left the card presenting as saved. Rendered state must be whatever
  // actually reached storage, which is `persisted`, not `next`: the
  // one-eviction retry inside persistBookmarks can drop the oldest entry.
  it("commits only what persistBookmarks confirms it stored, so a denied write never renders as saved", () => {
    expect(toolRadarAppTsx).toContain("setBookmarks(persisted);");
    expect(toolRadarAppTsx).not.toContain("setBookmarks(next);");
    // The failure branch returns before any setBookmarks call.
    expect(toolRadarAppTsx).toMatch(/if \(persisted === undefined\) \{[\s\S]*?setPersistFailed\(true\);[\s\S]*?return;/);
    // No effect re-derives storage from state behind the click handler's back.
    expect(toolRadarAppTsx).not.toMatch(/useEffect\([\s\S]*persistBookmarks/);
  });

  // P1 UI-review finding (round 2): the write used to be fire-and-forget
  // with a swallowed exception — a denied write (quota, Safari private
  // mode) silently diverged in-memory state from what actually persisted.
  it("reports write success/failure instead of a swallowed try/catch, and surfaces a notice on denial", () => {
    const formattersTs = readFileSync(new URL("../../views/_shared/tools/formatters.ts", import.meta.url), "utf8");
    expect(formattersTs).toContain("export function persistBookmarks(");
    expect(toolRadarAppTsx).toContain("const [persistFailed, setPersistFailed] = useState(false);");
    expect(toolRadarAppTsx).toContain("setPersistFailed(true);");
    expect(toolRadarAppTsx).toMatch(/persistFailed &&/);
  });

  // P2 UI-review finding: an empty weekly snapshot must not also cut off
  // access to previously bookmarked tools.
  it("keeps the filter bar (and its bookmark toggle) reachable even when the current snapshot is empty", () => {
    expect(toolRadarAppTsx).toContain("!bookmarkOnly && entries.length === 0");
    // The old top-level early return that skipped ToolsBoard entirely for
    // an empty snapshot is gone — ToolRadarApp always mounts ToolsBoard.
    expect(toolRadarAppTsx).not.toMatch(/if \(state\.entries\.length === 0\)/);
  });

  it("sources the bookmarks-only view from bookmarkedEntries(), which falls back to the stored snapshot instead of dropping a stale bookmark", () => {
    expect(toolRadarAppTsx).toContain("bookmarkedEntries(bookmarks ?? new Map(), entries)");
  });

  it("marks a bookmark that's left the current snapshot as stale instead of silently mixing eras", () => {
    expect(toolRadarAppTsx).toContain("No longer trending");
    expect(toolRadarAppTsx).toContain("readonly stale?: boolean;");
  });

  it("bounds bookmark storage growth", () => {
    const formattersTs = readFileSync(new URL("../../views/_shared/tools/formatters.ts", import.meta.url), "utf8");
    expect(formattersTs).toContain("export const BOOKMARKS_MAX = 200;");
  });

  it("parses stored bookmarks defensively — malformed/old-shape (bare id array) JSON degrades to empty, never throws", () => {
    const formattersTs = readFileSync(new URL("../../views/_shared/tools/formatters.ts", import.meta.url), "utf8");
    expect(formattersTs).toContain("export function parseStoredBookmarks(raw: string): ToolEntry[]");
    expect(formattersTs).toMatch(/catch \{\s*\/\/ malformed JSON/);
  });
});

describe("Tool Radar UI states (req. 31-39)", () => {
  it("distinguishes all-sources-failed (#33) from zero-entries-but-ok (#34)", () => {
    expect(toolRadarAppTsx).toContain("const outage = allSourcesErrored(sources);");
    expect(toolRadarAppTsx).toContain("Tool Radar is temporarily unavailable");
    expect(toolRadarAppTsx).toContain("No tools yet");
  });

  // P1 UI-review finding (round 3): the outage state used to be a top-level
  // early return, which also took the bookmarks toggle (and every saved tool)
  // off-screen whenever all three sources happened to fail. It's now decided
  // inside ToolsBoard, so the filter bar stays mounted.
  it("keeps bookmarks reachable during a full outage, and drops the redundant degraded banner (#33)", () => {
    expect(toolRadarAppTsx).not.toMatch(/if \(allSourcesErrored\(state\.sources\)\)/);
    // Banner suppressed only where the outage EmptyState replaces it — the
    // bookmarks-only view never renders that EmptyState, so it keeps the
    // banner as its sole signal that the run failed.
    expect(toolRadarAppTsx).toContain("degraded.length > 0 && (!outage || bookmarkOnly)");
    // …and when it does survive into the outage case, it must not claim to be
    // "showing results from the sources that did" — none did.
    expect(toolRadarAppTsx).toContain("showing your saved tools from an earlier run.");
    expect(toolRadarAppTsx).toContain("<DegradedBanner sourceNames={degraded} outage={outage} />");
  });

  it("shows a partial-degradation banner naming the failed source(s) (#35)", () => {
    expect(toolRadarAppTsx).toContain("degradedSourceNames(sources)");
    expect(toolRadarAppTsx).toContain("function DegradedBanner");
    expect(toolRadarAppTsx).toContain("didn&rsquo;t respond on the last run");
  });

  it("offers a way back to 'All' when filters combine to zero results (#36)", () => {
    expect(toolRadarAppTsx).toContain("No matching tools");
    expect(toolRadarAppTsx).toContain("Show all tools");
  });

  it("shows a distinct 'no bookmarks yet' message from #34/#36 (#37)", () => {
    expect(toolRadarAppTsx).toContain("No bookmarks yet");
    // `bookmarks?.size === 0` keeps the tri-state: `undefined` (storage
    // inaccessible) is falsy here, so this branch is bookmarks-enabled-but-empty only.
    expect(toolRadarAppTsx).toContain("bookmarkOnly && bookmarks?.size === 0");
  });

  it("mirrors main.tsx's 404-as-normal-empty-state handling for tools.json (#38)", () => {
    expect(mainTsx).toMatch(/if \(res\.status === 404\) \{/);
    expect(mainTsx).toContain("tools.json request failed");
  });

  it("reuses freshness()/stale-badge with a longer, cadence-appropriate threshold (#39)", () => {
    const formattersTs = readFileSync(new URL("../../views/_shared/tools/formatters.ts", import.meta.url), "utf8");
    expect(formattersTs).toContain("toolsFreshness");
    expect(formattersTs).toMatch(/10 \* 24 \* 60 \* 60 \* 1000/);
    expect(toolRadarAppTsx).toContain('<span className="stale-badge">Stale</span>');
  });

  it("never shows the raw numeric trending score anywhere in the card", () => {
    expect(toolRadarAppTsx).not.toContain("trendingScore");
  });
});

describe("Tool Radar section chrome", () => {
  it("paints the section on --bg like the podcast section, not .newsroomFeed's inherited --surface-warm", () => {
    const toolsRule = /\.newsroomTools\s*\{[^}]*\}/.exec(toolsCss)?.[0];
    const podcastCss = readFileSync(new URL("../../views/_shared/podcast/podcast.css", import.meta.url), "utf8");
    const podcastRule = /\.newsroomPodcast\s*\{[^}]*\}/.exec(podcastCss)?.[0];

    expect(toolsRule).toContain("background: var(--bg)");
    expect(podcastRule).toContain("background: var(--bg)");
  });

  it("gives the tool card the same surface/border/radius tokens as .podcast-card and .story-card", () => {
    const feedCss = readFileSync(new URL("../../views/_shared/feed/feed.css", import.meta.url), "utf8");
    const podcastCss = readFileSync(new URL("../../views/_shared/podcast/podcast.css", import.meta.url), "utf8");
    const rules = [
      /^\.tool-card \{[^}]*\}/m.exec(toolsCss)?.[0],
      /^\.podcast-card \{[^}]*\}/m.exec(podcastCss)?.[0],
      /^\.story-card \{[^}]*\}/m.exec(feedCss)?.[0],
    ];

    for (const rule of rules) {
      expect(rule).toContain("background: var(--surface)");
      expect(rule).toContain("border: 1px solid var(--border)");
      expect(rule).toContain("border-radius: var(--radius-lg)");
    }
  });
});

describe("Tool Radar Models/Spaces descriptions and category explanation (P2 UI-review finding)", () => {
  it("keeps the section header to the one-line subtitle, with no verbose kind explainer", () => {
    const formattersTs = readFileSync(new URL("../../views/_shared/tools/formatters.ts", import.meta.url), "utf8");
    expect(toolRadarAppTsx).toContain(
      '<p className="tools-subtitle">Trending AI tools, models, and Spaces.</p>',
    );
    expect(formattersTs).not.toContain("KIND_EXPLAINER");
    expect(toolRadarAppTsx).not.toContain("KIND_EXPLAINER");
    expect(toolRadarAppTsx).not.toContain("tools-kind-explainer");
    expect(toolsCss).not.toContain("tools-kind-explainer");
  });

  it("distinguishes the tool's own name/title from its owner instead of concatenating them into one string", () => {
    expect(toolRadarAppTsx).toContain("{entry.displayName ?? entry.name}");
    expect(toolRadarAppTsx).toContain('<span className="tool-card-owner">{entry.owner}</span>');
  });

  it("renders nothing for a missing model description instead of repeating a placeholder per card (P2 UI-review finding)", () => {
    // No per-card fallback text/class left over — a card with no description simply renders nothing there.
    expect(toolRadarAppTsx).not.toContain("No description available");
    expect(toolRadarAppTsx).not.toContain("tool-card-description--empty");
  });

  it("surfaces downloads/library_name for models and sdk for Spaces, without fabricating a model description", () => {
    const formattersTs = readFileSync(new URL("../../views/_shared/tools/formatters.ts", import.meta.url), "utf8");
    const transformTs = readFileSync(new URL("../../src/tool-radar/transform.ts", import.meta.url), "utf8");
    expect(toolRadarAppTsx).toContain("entry.libraryName");
    expect(toolRadarAppTsx).toContain("entry.sdk");
    expect(toolRadarAppTsx).toContain("entry.downloads");
    expect(transformTs).toContain("deliberately never falls back to a fabricated one"); // models: no fabricated description
    expect(formattersTs).toContain("export function actionLabel(kind: ToolKind): string");
  });

  it("gives kind-appropriate action labels instead of one generic link treatment", () => {
    expect(toolRadarAppTsx).toContain("actionLabel(entry.kind)");
    const formattersTs = readFileSync(new URL("../../views/_shared/tools/formatters.ts", import.meta.url), "utf8");
    expect(formattersTs).toContain('repository: "View repository"');
    expect(formattersTs).toContain('model: "View model"');
    expect(formattersTs).toContain('space: "Open demo"');
  });
});

describe("Tool Radar copy-to-clipboard (req. 29-30)", () => {
  it("only renders the install command block when installCommand is present", () => {
    expect(toolRadarAppTsx).toContain("{entry.installCommand !== undefined && <InstallCommand");
  });

  it("shows a visible 'Copied' confirmation and fails silently on clipboard errors", () => {
    expect(toolRadarAppTsx).toContain('{copied ? "Copied" : "Copy"}');
    expect(toolRadarAppTsx).toMatch(/\.catch\(\(\) => undefined\)/);
  });
});

describe("Tool Radar visual reuse of feed.css tokens", () => {
  it("scopes everything under .newsroomTools, applied alongside the shared .newsroomFeed reset", () => {
    expect(toolRadarAppTsx).toContain('className="newsroomFeed newsroomTools"');
    expect(toolsCss).toContain(".tools-shell {");
    expect(toolsCss).toContain("var(--surface)");
    expect(toolsCss).toContain("var(--radius-lg)");
  });

  it("disables the skeleton shimmer under reduced motion, scoped to this surface", () => {
    expect(toolsCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(toolsCss).toContain(".newsroomTools .skel-bar");
  });

  it("gives touch-sized targets to the bookmark and copy buttons", () => {
    expect(toolsCss).toMatch(/\.tool-card-bookmark[\s\S]*?width: 40px; height: 40px;/);
    expect(toolsCss).toMatch(/\.tool-install-copy[\s\S]*?min-height: 40px;/);
  });
});
