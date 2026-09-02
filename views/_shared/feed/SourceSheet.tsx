import { useEffect, useRef, useState } from "react";

import type { FeedStory } from "./types.js";
import { earliestPublishedAt, shortDate, shortTime } from "./formatters.js";
import { spawnRipple } from "./ripple.js";
import { Avatar } from "./Avatar.js";

// Matches --motion-base in feed.css — the sheet's own slide/fade transition
// duration. ponytail: duration is duplicated here instead of read from CSS;
// a shared constant module would be the fix if these ever drift apart.
const EXIT_DURATION_MS = 230;

// Drag the handle down past this many px to dismiss on release.
// ponytail: distance-only threshold, no flick/velocity detection — add if a
// fast short drag ever feels like it should dismiss too.
const DISMISS_DRAG_PX = 100;
// Drag the handle up (there's nowhere to expand to — the sheet already opens
// at its max height) and it only follows at 20% of the finger, capped here —
// a rubber-band cue that this is the top, not a real resize.
const OVERDRAG_RESISTANCE = 0.2;
const OVERDRAG_MAX_PX = 8;

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

  // Handle drag: dragY is the live pointer offset applied as an inline
  // transform (down follows the finger 1:1; up is rubber-banded — see
  // OVERDRAG_RESISTANCE). isDragging suppresses the CSS transition while
  // tracking the finger, then re-enables it so the release (snap back or
  // slide the rest of the way closed) animates.
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Let taps on the copy/close buttons behave normally instead of
    // starting a drag — they now sit inside the widened drag area.
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartY.current = e.clientY;
    setIsDragging(true);
  }
  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartY.current === null) return;
    const delta = e.clientY - dragStartY.current;
    setDragY(delta > 0 ? delta : Math.max(delta * OVERDRAG_RESISTANCE, -OVERDRAG_MAX_PX));
  }
  function onHandlePointerUp() {
    if (dragStartY.current === null) return;
    dragStartY.current = null;
    setIsDragging(false);
    if (dragY > DISMISS_DRAG_PX) onClose();
    setDragY(0);
  }

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

  // Freeze the page behind the sheet: no background scroll, and — the main
  // reason this exists — `overscroll-behavior-y: none` stops Chrome mobile
  // reading an accidental downward swipe on the sheet as its own
  // pull-to-refresh gesture (that gesture triggers off document scroll
  // position, ignoring z-index, so blocking pointer events isn't enough).
  useEffect(() => {
    if (!open) return;
    const { style } = document.body;
    const prevOverflow = style.overflow;
    const prevOverscroll = style.overscrollBehaviorY;
    style.overflow = "hidden";
    style.overscrollBehaviorY = "none";
    return () => {
      style.overflow = prevOverflow;
      style.overscrollBehaviorY = prevOverscroll;
    };
  }, [open]);

  async function onCopy() {
    const links = story.sources.map((s) => s.url).join("\n");
    try {
      await navigator.clipboard.writeText(`${story.title}\n\n${story.summary}\n\n${links}`);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1500);
    } catch {
      // clipboard permission denied/unavailable — nothing more we can do
    }
  }

  return (
    <>
      {/* pointerEvents is tied straight to `open`, not the `visible` flag the
          slide/fade transition uses — `visible` flips a render later (it's
          set from a useEffect), so gating on it left the overlay/sheet
          interactive for a frame after a swipe-dismiss, swallowing the very
          next tap (even one on the app header, since the overlay covers the
          whole viewport). */}
      <div
        className={`sheet-overlay${visible ? " open" : ""}`}
        style={{ pointerEvents: open ? "auto" : "none" }}
        onClick={onClose}
      />
      <section
        className={`source-sheet${visible ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheetTitle"
        style={{
          pointerEvents: open ? "auto" : "none",
          ...(dragY === 0 ? undefined : { transform: `translateY(${dragY}px)`, transition: isDragging ? "none" : undefined }),
        }}
      >
        <div
          className="sheet-drag-header"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-head">
            <div className="sheet-head-row">
              <h2 className="sheet-title" id="sheetTitle">
                {story.title}
              </h2>
              <div className="sheet-head-actions">
                <button
                  className="sheet-copy"
                  data-copied={copied}
                  aria-label={copied ? "Copied" : "Copy title, summary, and links"}
                  onClick={() => { void onCopy(); }}
                >
                  {copied ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="12" height="12" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
                <button className="sheet-close" aria-label="Close" onClick={onClose} ref={closeRef}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
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
        </div>
        <div className="sheet-body">
          <p className="sheet-section-label">Sources ({story.sources.length})</p>
          {[...story.sources]
            .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
            .map((s, i) => (
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
