import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Material-style click feedback: a circle sized to cover the element,
 * centered on the given point, growing + fading via the "ripple" CSS
 * animation (feed.css), then removed once that animation ends. The element
 * needs `position: relative; overflow: hidden` for this to clip.
 */
export function spawnRippleAt(el: HTMLElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const span = document.createElement("span");
  span.className = "ripple";
  span.style.width = `${String(size)}px`;
  span.style.height = `${String(size)}px`;
  span.style.left = `${String(clientX - rect.left - size / 2)}px`;
  span.style.top = `${String(clientY - rect.top - size / 2)}px`;
  span.addEventListener("animationend", () => { span.remove(); });
  el.appendChild(span);
}

/**
 * Pointer-event convenience wrapper around `spawnRippleAt` for the mouse/pen
 * click path. Touch does NOT wire this to `onPointerDown` (see StoryCard's
 * comment) — a touch interaction that turns into a swipe drag must not show
 * ripple "this will open something" feedback (criterion 18), so the touch
 * path calls `spawnRippleAt` directly, only once a gesture actually
 * resolves as a tap.
 */
export function spawnRipple(e: ReactPointerEvent<HTMLElement>) {
  spawnRippleAt(e.currentTarget, e.clientX, e.clientY);
}
