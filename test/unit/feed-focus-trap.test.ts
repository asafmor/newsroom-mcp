import { describe, expect, it } from "vitest";

import { wrapFocus } from "../../views/_shared/feed/focus-trap.js";

// wrapFocus is deliberately DOM-independent (see focus-trap.ts) so this can
// run without jsdom — plain objects stand in for elements since the
// function only ever compares identity/position, never touches the DOM.
// It cannot prove focus actually moves in a real browser (jsdom doesn't
// enforce `inert`'s focus semantics either); that's covered by the
// browser-driven UI review instead.
describe("wrapFocus", () => {
  const [a, b, c] = [{}, {}, {}] as unknown as HTMLElement[];

  it("wraps Shift+Tab from the first focusable to the last", () => {
    expect(wrapFocus([a, b, c], a, true)).toBe(c);
  });

  it("wraps Tab from the last focusable to the first", () => {
    expect(wrapFocus([a, b, c], c, false)).toBe(a);
  });

  it("does not intervene away from either boundary — lets the browser's default Tab run", () => {
    expect(wrapFocus([a, b, c], b, false)).toBeNull();
    expect(wrapFocus([a, b, c], b, true)).toBeNull();
  });

  it("does not intervene on Tab from the first, or Shift+Tab from the last", () => {
    expect(wrapFocus([a, b, c], a, false)).toBeNull();
    expect(wrapFocus([a, b, c], c, true)).toBeNull();
  });

  it("is a no-op with no focusables", () => {
    expect(wrapFocus([], null, false)).toBeNull();
  });

  it("treats a single focusable as both boundaries", () => {
    expect(wrapFocus([a], a, true)).toBe(a);
    expect(wrapFocus([a], a, false)).toBe(a);
  });
});
