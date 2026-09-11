import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

import { shouldShowBackToTopMcp, shouldShowBackToTopSite } from "./formatters.js";

// Matches PodcastApp.tsx's `<section id="podcast-digest">` — the site's own
// entry-bar links to the same literal id (see main.tsx's `digestEntry`).
// Looked up directly (not passed a ref) because the podcast section lives in
// a sibling React root, mounted independently of FeedApp — if the id is ever
// renamed this simply never finds the section and the button stays hidden
// on the site (see the "never appears" fallback below), rather than throwing.
const PODCAST_SECTION_ID = "podcast-digest";

/**
 * Floating "back to top" control shared by both hosts (site + MCP View) —
 * see the requirements this satisfies in the PR: appears past a host-
 * specific scroll threshold, scrolls the right region back to its top, and
 * yields to the source sheet while it's open. Rendered as a sibling of
 * `.app-shell` (same reason as SourceSheet — see FeedApp.tsx), so its fixed/
 * absolute positioning always escapes `.app-shell`'s clipping.
 */
export function BackToTopButton({
  variant,
  scrollAreaRef,
  suppressed,
}: {
  readonly variant: "mcp" | "site";
  /** The MCP host's actual scrolling element; unused (but harmless) on the site, where the document itself scrolls. */
  readonly scrollAreaRef: RefObject<HTMLDivElement | null>;
  /** True while the source sheet (or any future overlay) is open — the button must yield to it (criterion 15) rather than merely sit visually behind it. */
  readonly suppressed: boolean;
}) {
  const [pastThreshold, setPastThreshold] = useState(false);

  const evaluate = useCallback(() => {
    if (variant === "mcp") {
      const el = scrollAreaRef.current;
      setPastThreshold(el !== null && shouldShowBackToTopMcp(el.scrollTop, el.clientHeight));
      return;
    }
    const section = document.getElementById(PODCAST_SECTION_ID);
    setPastThreshold(section !== null && shouldShowBackToTopSite(section.getBoundingClientRect().top));
  }, [variant, scrollAreaRef]);

  // Mount-only: attaches the scroll/resize listeners once (`evaluate`'s own
  // identity is stable — variant/scrollAreaRef never change for a mounted
  // instance) to the element that actually scrolls per host.
  useEffect(() => {
    const target: EventTarget | null = variant === "mcp" ? scrollAreaRef.current : window;
    target?.addEventListener("scroll", evaluate, { passive: true });
    window.addEventListener("resize", evaluate);
    return () => {
      target?.removeEventListener("scroll", evaluate);
      window.removeEventListener("resize", evaluate);
    };
  }, [evaluate, scrollAreaRef, variant]);

  // Re-evaluates on every render, not just on scroll/resize — the cheapest
  // way to also cover layout shifts that don't fire either event (more
  // stories loading, a sort-mode change moving the podcast section, the
  // sort-mode scroll-to-top itself, the source sheet closing).
  useEffect(() => {
    evaluate();
  });

  const visible = pastThreshold && !suppressed;

  function handleClick() {
    // `transition-duration: 0.01ms` (feed.css) only shortens CSS
    // transitions — it has no effect on a native `scrollTo`'s own smooth
    // scroll, which otherwise keeps animating regardless of the OS-level
    // reduced-motion preference (UI-review P1 finding).
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (variant === "mcp") {
      scrollAreaRef.current?.scrollTo({ top: 0, behavior });
    } else {
      window.scrollTo({ top: 0, behavior });
    }
    // Focus must land somewhere sensible, not stay on a button that's about
    // to go inert once the resulting scroll is picked up above — the same
    // element (`.scroll-area`) doubles as "top of panel/page" here, and
    // already sits at the top of both hosts' layout.
    scrollAreaRef.current?.focus({ preventScroll: true });
  }

  return (
    <button
      type="button"
      className={`back-to-top${visible ? " back-to-top--visible" : ""}`}
      aria-label="Back to top"
      // Never Tab-reachable, activatable, or exposed to assistive tech while
      // hidden or while an overlay is open (criteria 8, 15) — the CSS
      // transition above still gets to animate the fade since `inert` alone
      // doesn't unmount or hide the element.
      inert={!visible}
      onClick={handleClick}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V6M5 13l7-7 7 7" />
      </svg>
    </button>
  );
}
