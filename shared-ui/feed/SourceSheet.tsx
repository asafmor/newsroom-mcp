import { useEffect, useRef } from "react";

import type { FeedStory } from "./types.js";
import { earliestPublishedAt, initials, shortDate, shortTime } from "./formatters.js";

export function SourceSheet({
  story,
  onClose,
  onOpenSource,
}: {
  readonly story: FeedStory;
  readonly onClose: () => void;
  /** Host-specific link handling: an MCP host bridge, or a plain new-tab navigation. */
  readonly onOpenSource: (url: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <>
      <div className="sheet-overlay open" onClick={onClose} />
      <section className="source-sheet open" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-head-row">
            <h2 className="sheet-title" id="sheetTitle">
              {story.title}
            </h2>
            <button className="sheet-close" aria-label="Close" onClick={onClose} ref={closeRef}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="sheet-stats">
            <div>
              <div className="sheet-stat-label">First seen</div>
              <div className="sheet-stat-value">
                {shortDate(earliestPublishedAt(story))} · {shortTime(earliestPublishedAt(story))}
              </div>
            </div>
            <div>
              <div className="sheet-stat-label">Updated</div>
              <div className="sheet-stat-value">
                {shortDate(story.lastMeaningfulUpdateAt)} · {shortTime(story.lastMeaningfulUpdateAt)}
              </div>
            </div>
          </div>
        </div>
        <div className="sheet-body">
          <p className="sheet-section-label">Sources ({story.sources.length})</p>
          {story.sources.map((s, i) => (
            <a
              className="source-item"
              href={s.url}
              key={i}
              onClick={(e) => {
                e.preventDefault();
                onOpenSource(s.url);
              }}
            >
              <span className="avatar">{initials(s.providerName)}</span>
              <span className="source-item-body">
                <span className="source-provider">{s.providerName}</span>
                <div className="source-title">{s.title}</div>
                <div className="source-date">{shortDate(s.publishedAt)}</div>
              </span>
              <span className="open-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
              </span>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
