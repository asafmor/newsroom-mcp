import type { FeedStory } from "./types.js";
import { developmentCount, latestPublishedAt, parseSummary, timeAgo } from "./formatters.js";
import { spawnRipple } from "./ripple.js";
import { Avatar } from "./Avatar.js";

export function StoryCard({
  story,
  isRead,
  onOpen,
}: {
  readonly story: FeedStory;
  /** Purely local read-state (see FeedApp's readIds) — never affects layout/content, only the de-emphasis signal.
   * `undefined` means "unknown, storage unavailable" — renders identically to a pre-feature card (no class, no marker),
   * distinct from `false` ("known unread", which shows the marker). */
  readonly isRead: boolean | undefined;
  readonly onOpen: (story: FeedStory, trigger: HTMLElement) => void;
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

  return (
    <article
      className={isRead === true ? "story-card story-card--read" : "story-card"}
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
      onPointerDown={spawnRipple}
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
        {developments > 0 ? (
          <span className="development-badge" title="Sources that reported a new development">
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
          {extra > 0 ? <span className="avatar more">+{extra}</span> : null}
        </span>
        <span className="source-count">
          {names}
          {extra > 0 ? ` +${String(extra)}` : ""}
        </span>
      </div>
    </article>
  );
}
