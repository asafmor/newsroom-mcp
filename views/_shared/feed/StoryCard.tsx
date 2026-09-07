import type { FeedStory } from "./types.js";
import { developmentCount, latestPublishedAt, parseSummary, timeAgo } from "./formatters.js";
import type { StoryDelta } from "./formatters.js";
import { spawnRipple } from "./ripple.js";
import { useSwipeToRead } from "./useSwipeToRead.js";
import { Avatar } from "./Avatar.js";

export function StoryCard({
  story,
  isRead,
  delta,
  onOpen,
  onMarkRead,
}: {
  readonly story: FeedStory;
  /** Purely local read-state (see FeedApp's readIds) — never affects layout/content, only the de-emphasis signal.
   * `undefined` means "unknown, storage unavailable" — renders identically to a pre-feature card (no class, no marker),
   * distinct from `false` ("known unread", which shows the marker). Also gates the swipe affordance entirely
   * when `undefined` (criterion 26), and its "commit flash" when already `true` (criterion 10) — see useSwipeToRead. */
  readonly isRead: boolean | undefined;
  /** "What changed since you last looked" (see FeedApp's snapshot cache) — `undefined` when there's no prior
   * snapshot, storage is unavailable, or nothing tracked changed. Only ever surfaced on a read card (see below). */
  readonly delta: StoryDelta | undefined;
  readonly onOpen: (story: FeedStory, trigger: HTMLElement) => void;
  /** Touch-only swipe-to-mark-read (see useSwipeToRead.ts) — same idempotent readIds transition `onOpen` performs, without opening the sheet. */
  readonly onMarkRead: (story: FeedStory) => void;
}) {
  const n = story.sources.length;
  // One avatar per provider, even if that provider contributed multiple articles.
  const uniqueSources = [...new Map(story.sources.map((s) => [s.providerName, s])).values()];
  const shown = uniqueSources.slice(0, 3);
  const extra = uniqueSources.length - shown.length;
  const names = shown.map((s) => s.providerName.replace(" AI", "").replace(" News", "")).join(", ");
  const developments = developmentCount(story);
  // Structured summaries (see docs/agent-system-prompt.md) show only the
  // lede here — the bullets are reserved for the detail sheet. An
  // unstructured summary's "lede" is the full raw string, unchanged.
  const { lede } = parseSummary(story.summary);
  // Delta precedence rule: an unread card never shows a delta badge, even
  // when one exists — only a read card with a real, non-empty delta swaps
  // it in for the cumulative development badge below (never both).
  const badgeText = isRead === true ? delta?.badgeText : undefined;

  // Touch-only swipe-to-mark-read. Mouse/keyboard interaction below
  // (onClick/onKeyDown) is completely untouched by this — cardStyle and
  // affordance only ever move away from their rest values in response to
  // native touch events this hook wires up itself (criterion 20).
  const { cardRef, cardStyle, affordance } = useSwipeToRead({
    isRead,
    onTap: () => {
      const el = cardRef.current;
      if (el !== null) onOpen(story, el);
    },
    onSwipeCommit: () => { onMarkRead(story); },
  });

  return (
    // Wrapper for the swipe reveal layer: .story-card itself is
    // position:relative/overflow:hidden for the ripple and .unread-marker,
    // so a background that has to stay put while .story-card translates
    // can't live inside it — this wrapper is the .story-feed flex/grid item
    // now, and .story-card is its only other child, so gap/grid sizing are
    // unaffected (see feed.css).
    <div className="story-card-wrap">
      {affordance.visible ? (
        <div
          className={`swipe-affordance${affordance.armed ? " swipe-affordance--armed" : ""}`}
          style={affordance.style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
      ) : null}
      <article
        ref={cardRef}
        className={isRead === true ? "story-card story-card--read" : "story-card"}
        style={cardStyle}
        tabIndex={0}
        role="button"
        aria-haspopup="dialog"
        onPointerDown={(e) => {
          // Touch: ripple is deliberately NOT spawned here (see ripple.ts's
          // spawnRipple comment) — a touch interaction that turns into a
          // swipe drag must not show "this will open something" feedback
          // (criterion 18). useSwipeToRead spawns it itself, only once a
          // touch gesture actually resolves as a tap.
          if (e.pointerType === "touch") return;
          spawnRipple(e);
        }}
        onClick={(e) => { onOpen(story, e.currentTarget); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(story, e.currentTarget);
          }
        }}
      >
        {/* Non-text unread signal (design decision #4/#12) — present only on
            known-unread cards (isRead === false), never affects
            .story-title/.story-summary color or opacity. isRead === undefined
            (storage unavailable) renders no marker, same as a pre-feature card. */}
        {isRead === false ? <span className="unread-marker" aria-hidden="true" /> : null}
        <div className="story-meta-row">
          <span>{timeAgo(latestPublishedAt(story))}</span>
          <span className="dot-sep">
            {n} source{n === 1 ? "" : "s"}
          </span>
          {badgeText !== undefined ? (
            <span className="delta-badge" title="What changed since you last opened this story">
              {badgeText}
            </span>
          ) : developments > 0 ? (
            // On a card the reader has already opened, this cumulative count is
            // history they've seen — it drops to neutral metadata so the accent
            // treatment means exactly one thing: changed since your last visit.
            // On an unread card it's still news, and keeps the accent.
            <span
              className={isRead === true ? "development-badge is-historical" : "development-badge"}
              title="Sources that reported a new development"
            >
              {developments} update{developments === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <h3 className="story-title">{story.title}</h3>
        <p className="story-summary">{lede}</p>
        <div className="source-row">
          <span className="avatar-stack">
            {shown.map((s, i) => (
              <Avatar providerName={s.providerName} key={i} />
            ))}
            {/* Exactly 1 overflow provider: show its real avatar instead of a
                generic "+1" circle — it's concrete enough to render like any
                other avatar. 2+ providers still fall back to the "+N" circle
                since their names wouldn't fit here. */}
            {extra === 1 ? (
              <Avatar providerName={uniqueSources[shown.length].providerName} />
            ) : extra > 1 ? (
              <span className="avatar more">+{extra}</span>
            ) : null}
          </span>
          <span className="source-count">
            {names}
            {/* Caption stays numeric even at extra === 1 — provider names can
                be too long to fit next to the summarized list above. */}
            {extra > 0 ? ` +${String(extra)}` : ""}
          </span>
        </div>
      </article>
    </div>
  );
}
