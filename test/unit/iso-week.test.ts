import { describe, expect, it } from "vitest";

import { computeIsoWeek, fridayDueBoundary, isDueForCurrentWeek, isoWeekId } from "../../src/shared/iso-week.js";

describe("computeIsoWeek", () => {
  it("computes a plain mid-year week", () => {
    // 2026-09-09 is a Wednesday — matches the requirements doc's own worked example.
    expect(isoWeekId(new Date("2026-09-09T00:00:00Z"))).toBe("2026-W37");
  });

  it("assigns a late-December date to the FOLLOWING ISO year at a boundary", () => {
    // 2018-12-31 is a Monday, and belongs to ISO week 1 of 2019 (a
    // textbook ISO-8601 boundary case) — the ISO year is later than the
    // calendar year.
    const info = computeIsoWeek(new Date("2018-12-31T00:00:00Z"));
    expect(info).toEqual({ isoYear: 2019, isoWeek: 1, id: "2019-W01" });
  });

  it("assigns an early-January date to the PREVIOUS ISO year at a boundary", () => {
    // 2005-01-01 is a Saturday, and belongs to ISO week 53 of 2004 — the
    // ISO year is earlier than the calendar year.
    const info = computeIsoWeek(new Date("2005-01-01T00:00:00Z"));
    expect(info).toEqual({ isoYear: 2004, isoWeek: 53, id: "2004-W53" });
  });

  it("assigns another early-January date (Sunday) to the previous ISO year", () => {
    const info = computeIsoWeek(new Date("2023-01-01T00:00:00Z"));
    expect(info).toEqual({ isoYear: 2022, isoWeek: 52, id: "2022-W52" });
  });

  it("never reads the wall clock — identical input always yields identical output", () => {
    const date = new Date("2026-03-15T12:34:56Z");
    expect(isoWeekId(date)).toBe(isoWeekId(new Date(date.getTime())));
  });
});

describe("fridayDueBoundary", () => {
  it("is 08:00:00.000 UTC on the Friday inside the reference date's ISO week", () => {
    // 2026-09-09 (Wed) is in ISO week 2026-W37, whose Friday is 2026-09-11.
    const boundary = fridayDueBoundary(new Date("2026-09-09T00:00:00Z"));
    expect(boundary.toISOString()).toBe("2026-09-11T08:00:00.000Z");
  });
});

describe("isDueForCurrentWeek", () => {
  it("is true exactly at the 08:00:00.000 UTC boundary (inclusive)", () => {
    expect(isDueForCurrentWeek(new Date("2026-09-11T08:00:00.000Z"), false)).toBe(true);
  });

  it("is false one second before the boundary", () => {
    expect(isDueForCurrentWeek(new Date("2026-09-11T07:59:59.000Z"), false)).toBe(false);
  });

  it("is true well after the boundary, later in the same ISO week", () => {
    expect(isDueForCurrentWeek(new Date("2026-09-13T23:00:00.000Z"), false)).toBe(true);
  });

  it("is false before the boundary earlier in the same ISO week", () => {
    expect(isDueForCurrentWeek(new Date("2026-09-07T00:00:00.000Z"), false)).toBe(false);
  });

  it("is false once an episode already exists for the current week, even past the boundary", () => {
    expect(isDueForCurrentWeek(new Date("2026-09-11T08:00:00.000Z"), true)).toBe(false);
  });
});
