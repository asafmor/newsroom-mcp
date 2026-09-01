import { useEffect, useRef, useState } from "react";

import type { FeedStory } from "./types.js";
import { earliestPublishedAt, shortDate, shortTime } from "./formatters.js";
import { spawnRipple } from "./ripple.js";
import { Avatar } from "./Avatar.js";

// Matches --motion-base in feed.css — the sheet's own slide/fade transition
// duration. ponytail: duration is duplicated here instead of read from CSS;
// a shared constant module would be the fix if these ever drift apart.
const EXIT_DURATION_MS = 230;

export function SourceSheet({
  story,
  open,
  onClose,
  onExited,
  onOpenSource,
}: {
  readonly story: FeedStory;
  /** false starts/plays the close transition; the caller keeps this component mounted (via onExited) until it finishes. */
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called once the close transition has finished — caller unmounts here, not on onClose. */
  readonly onExited: () => void;
  /** Host-specific link handling: an MCP host bridge, or a plain new-tab navigation. */
  readonly onOpenSource: (url: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Mirrors `open`, but flips a frame late on entry so the "open" class is
  // added *after* first paint — otherwise the sheet mounts already in its
  // final position and the CSS transition never has a state change to animate.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      const timer = setTimeout(onExited, EXIT_DURATION_MS);
      return () => {
        clearTimeout(timer);
      };
    }
    const raf = requestAnimationFrame(() => {
      setVisible(true);
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [open, onExited]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <>
      <div className={`sheet-overlay${visible ? " open" : ""}`} onClick={onClose} />
      <section className={`source-sheet${visible ? " open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
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
                {shortDate(earliestPublishedAt(story))}
                <span className="stat-sep">·</span>
                {shortTime(earliestPublishedAt(story))}
              </div>
            </div>
            <div>
              <div className="sheet-stat-label">Updated</div>
              <div className="sheet-stat-value">
                {shortDate(story.lastMeaningfulUpdateAt)}
                <span className="stat-sep">·</span>
                {shortTime(story.lastMeaningfulUpdateAt)}
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
              onPointerDown={spawnRipple}
              onClick={(e) => {
                e.preventDefault();
                onOpenSource(s.url);
              }}
            >
              <Avatar providerName={s.providerName} />
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
