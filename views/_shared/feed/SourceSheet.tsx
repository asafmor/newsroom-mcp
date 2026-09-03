import { useEffect, useRef, useState } from "react";

import type { FeedStory } from "./types.js";
import { contributionLabel, earliestPublishedAt, parseSummary, shortDate, shortTime } from "./formatters.js";
import { getFocusable, wrapFocus } from "./focus-trap.js";
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
  const dialogRef = useRef<HTMLElement>(null);
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
  const dragYRef = useRef(0);
  const dragHeaderRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [copied, setCopied] = useState(false);
  const summary = parseSummary(story.summary);

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Touch uses native Touch Events below. Chrome cancels a Pointer Events
    // drag once it recognizes native panning when touch-action permits it.
    if (e.pointerType === "touch") return;
    // Let taps on the copy/close buttons behave normally instead of
    // starting a drag — they now sit inside the widened drag area.
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartY.current = e.clientY;
    setIsDragging(true);
  }

  function updateHandleDrag(clientY: number) {
    if (dragStartY.current === null) return;
    const delta = clientY - dragStartY.current;
    const nextDragY = delta > 0 ? delta : Math.max(delta * OVERDRAG_RESISTANCE, -OVERDRAG_MAX_PX);
    dragYRef.current = nextDragY;
    setDragY(nextDragY);
  }

  function finishHandleDrag(canceled = false) {
    if (dragStartY.current === null) return;

    // Read the ref rather than React state: several pointermove events can be
    // batched before pointerup renders the latest dragY value.
    const shouldDismiss = !canceled && dragYRef.current > DISMISS_DRAG_PX;
    dragStartY.current = null;
    dragYRef.current = 0;
    setIsDragging(false);
    setDragY(0);

    if (shouldDismiss) onCloseRef.current();
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "touch") updateHandleDrag(e.clientY);
  }

  function onHandlePointerEnd(e: React.PointerEvent<HTMLDivElement>, canceled = false) {
    if (e.pointerType === "touch") return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    finishHandleDrag(canceled);
  }

  useEffect(() => {
    const header = dragHeaderRef.current;
    if (header === null) return;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1 || !(e.target instanceof Element) || e.target.closest("button")) return;
      const touch = e.touches.item(0);
      if (touch === null) return;
      dragStartY.current = touch.clientY;
      dragYRef.current = 0;
      setIsDragging(true);
    }

    function onTouchMove(e: TouchEvent) {
      if (dragStartY.current === null || e.touches.length !== 1) return;
      const touch = e.touches.item(0);
      if (touch === null) return;
      e.preventDefault();
      updateHandleDrag(touch.clientY);
    }

    function onTouchEnd() {
      finishHandleDrag(false);
    }

    function onTouchCancel() {
      finishHandleDrag(true);
    }

    header.addEventListener("touchstart", onTouchStart, { passive: true });
    header.addEventListener("touchmove", onTouchMove, { passive: false });
    header.addEventListener("touchend", onTouchEnd);
    header.addEventListener("touchcancel", onTouchCancel);
    return () => {
      header.removeEventListener("touchstart", onTouchStart);
      header.removeEventListener("touchmove", onTouchMove);
      header.removeEventListener("touchend", onTouchEnd);
      header.removeEventListener("touchcancel", onTouchCancel);
    };
  }, []);

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
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // `inert` (see FeedApp.tsx) already keeps the background out of the
      // tab order; this closes the other side of the loop — without it,
      // Tab/Shift+Tab walk off the end of the dialog's own controls.
      if (e.key !== "Tab" || dialogRef.current === null) return;
      const target = wrapFocus(getFocusable(dialogRef.current), document.activeElement, e.shiftKey);
      if (target === null) return;
      e.preventDefault();
      target.focus();
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
      {/* Keep exit-animation state (`visible`) separate from interactivity:
          closing layers stop receiving input as soon as `open` changes. */}
      <div
        className={`sheet-overlay${visible ? " open" : ""}`}
        style={{ pointerEvents: open ? "auto" : "none" }}
        onClick={onClose}
      />
      <section
        ref={dialogRef}
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
          ref={dragHeaderRef}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerEnd}
          onPointerCancel={(e) => { onHandlePointerEnd(e, true); }}
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
          {/* The card's own .story-summary is line-clamped to a short preview
              (see feed.css) — this is the full, untruncated text, the same
              copy Copy already includes. Bullets (see docs/agent-system-prompt.md's
              optional lede+`- `-bullets convention) render as a real <ul> when
              present; an unstructured summary is unchanged, one paragraph. */}
          <p className="sheet-summary">{summary.lede}</p>
          {summary.bullets.length > 0 ? (
            <ul className="sheet-summary-bullets">
              {summary.bullets.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          ) : null}
          <p className="sheet-section-label">Sources ({story.sources.length})</p>
          {[...story.sources]
            .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
            .map((s, i) => {
              const tag = contributionLabel(s.contribution);
              return (
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
                    <span className="source-provider">
                      {s.providerName}
                      {tag === undefined ? null : (
                        <span
                          className={`contribution-tag${s.contribution === "meaningful-update" ? " is-development" : ""}`}
                        >
                          {tag}
                        </span>
                      )}
                    </span>
                    <div className="source-title">{s.title}</div>
                    <div className="source-date">{shortDate(s.publishedAt)}</div>
                  </span>
                  <span className="open-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17L17 7M9 7h8v8" />
                    </svg>
                  </span>
                </a>
              );
            })}
        </div>
      </section>
    </>
  );
}
