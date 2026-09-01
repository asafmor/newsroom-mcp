import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Material-style click feedback: a circle sized to cover the element,
 * centered on the pointer-down point, growing + fading via the "ripple"
 * CSS animation (feed.css), then removed once that animation ends.
 * The element needs `position: relative; overflow: hidden` for this to clip.
 */
export function spawnRipple(e: ReactPointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const span = document.createElement("span");
  span.className = "ripple";
  span.style.width = `${String(size)}px`;
  span.style.height = `${String(size)}px`;
  span.style.left = `${String(e.clientX - rect.left - size / 2)}px`;
  span.style.top = `${String(e.clientY - rect.top - size / 2)}px`;
  span.addEventListener("animationend", () => { span.remove(); });
  el.appendChild(span);
}
