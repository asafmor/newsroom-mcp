import type { FeedStory } from "./types.js";
import { latestPublishedAt, timeAgo } from "./formatters.js";
import { spawnRipple } from "./ripple.js";
import { Avatar } from "./Avatar.js";

export function StoryCard({ story, onOpen }: { readonly story: FeedStory; readonly onOpen: (story: FeedStory, trigger: HTMLElement) => void }) {
  const n = story.sources.length;
  // One avatar per provider, even if that provider contributed multiple articles.
  const uniqueSources = [...new Map(story.sources.map((s) => [s.providerName, s])).values()];
  const shown = uniqueSources.slice(0, 3);
  const extra = uniqueSources.length - shown.length;
  const names = shown.map((s) => s.providerName.replace(" AI", "").replace(" News", "")).join(", ");

  return (
    <article
      className="story-card"
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
      <div className="story-meta-row">
        <span>{timeAgo(latestPublishedAt(story))}</span>
        <span className="dot-sep">
          {n} source{n === 1 ? "" : "s"}
        </span>
      </div>
      <h3 className="story-title">{story.title}</h3>
      <p className="story-summary">{story.summary}</p>
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
