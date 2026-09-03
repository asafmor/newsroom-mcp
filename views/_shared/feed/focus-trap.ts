// `inert` on the background (see FeedApp.tsx) removes the rest of the page
// from the tab order, but it does nothing to stop focus leaving the dialog
// itself at either end — Tab/Shift+Tab still walk right off into the
// document (and from there, browser chrome). This closes that loop.

const FOCUSABLE_SELECTOR = "a[href], button:not([disabled])";

/** Live query, in DOM order — the source-link count varies per story, so
 * this can't be a fixed list. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/**
 * Decides where a Tab/Shift+Tab keydown should wrap focus to, given the
 * dialog's focusable elements (DOM order) and the currently focused one.
 * Returns `null` when the boundary hasn't been reached — the browser's
 * default Tab handling should run unmodified in that case.
 *
 * Pure and DOM-independent on purpose: the actual element *selection* above
 * needs a real DOM (and a real browser to prove focus really moved, which
 * jsdom won't), but this wrap decision is plain array/identity logic and is
 * exactly the slice worth covering with a unit test.
 */
export function wrapFocus(
  focusables: readonly HTMLElement[],
  active: Element | null,
  shiftKey: boolean,
): HTMLElement | null {
  if (focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return null;
}
