import type { FeedStory } from "./types.js";
import { initials, latestPublishedAt, timeAgo } from "./formatters.js";

export function StoryCard({ story, onOpen }: { readonly story: FeedStory; readonly onOpen: (story: FeedStory, trigger: HTMLElement) => void }) {
  const n = story.sources.length;
  const shown = story.sources.slice(0, 3);
  const extra = n - shown.length;
  const names = [...new Set(shown.map((s) => s.providerName.replace(" AI", "").replace(" News", "")))].join(", ");

  return (
    <article
      className="story-card"
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
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
            <span className="avatar" title={s.providerName} key={i}>
              {initials(s.providerName)}
            </span>
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
