// ISO-8601 week computation and the "due for the current week" predicate for
// the weekly podcast digest. Pure, deterministic functions only — every
// entry point here takes its reference time as a required argument rather
// than reading the wall clock itself, so tests never depend on "now".

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface IsoWeekInfo {
  readonly isoYear: number;
  readonly isoWeek: number;
  /** `<ISO year>-W<zero-padded week number>`, e.g. "2026-W37". */
  readonly id: string;
}

/**
 * ISO-8601 week: Monday-start, week 1 is the week containing that year's
 * first Thursday (the standard "nearest Thursday" algorithm). Operates
 * entirely in UTC so a caller's local timezone never shifts the result.
 */
export function computeIsoWeek(date: Date): IsoWeekInfo {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Monday=0 .. Sunday=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // move to this week's Thursday
  const isoYear = target.getUTCFullYear();

  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);

  const isoWeek = Math.round((target.getTime() - week1Monday.getTime()) / (7 * MS_PER_DAY)) + 1;

  return { isoYear, isoWeek, id: `${String(isoYear)}-W${String(isoWeek).padStart(2, "0")}` };
}

export function isoWeekId(date: Date): string {
  return computeIsoWeek(date).id;
}

/** The Monday 00:00:00.000 UTC that starts `date`'s ISO week. */
function isoWeekMonday(date: Date): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum);
  return target;
}

/** The Monday 00:00:00.000 UTC that starts ISO week `isoWeek` of `isoYear` — the reverse direction of `isoWeekMonday` above. */
function mondayOfIsoWeek(isoYear: number, isoWeek: number): Date {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday = isoWeekMonday(jan4);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (isoWeek - 1) * 7);
  return monday;
}

export interface IsoWeekDateRange {
  /** Monday 00:00:00.000 UTC. */
  readonly start: Date;
  /** Sunday 00:00:00.000 UTC (the same week's last day, not the following Monday). */
  readonly end: Date;
}

/**
 * The Monday-Sunday calendar range covered by ISO week `isoWeek` of
 * `isoYear` — the reverse of `computeIsoWeek`. Exists so callers that only
 * have an ISO week identifier (e.g. `podcast.json`'s `isoWeek` field) can
 * render a human calendar range without hand-rolling date math themselves.
 */
export function isoWeekDateRange(isoYear: number, isoWeek: number): IsoWeekDateRange {
  const start = mondayOfIsoWeek(isoYear, isoWeek);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start, end };
}

/** Parses `<ISO year>-W<zero-padded week>` (e.g. "2026-W37") back into its numeric parts, or `undefined` if malformed. */
export function parseIsoWeekId(id: string): { readonly isoYear: number; readonly isoWeek: number } | undefined {
  const match = /^(\d{4})-W(\d{2})$/.exec(id);
  if (match === null) return undefined;
  const isoWeek = Number(match[2]);
  if (isoWeek < 1 || isoWeek > 53) return undefined;
  return { isoYear: Number(match[1]), isoWeek };
}

/** 08:00:00.000 UTC on the Friday inside `date`'s ISO week (Monday-Sunday). */
export function fridayDueBoundary(date: Date): Date {
  const monday = isoWeekMonday(date);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  friday.setUTCHours(8, 0, 0, 0);
  return friday;
}

/**
 * "Due for the current ISO week" (docs/mcp-tools.md): true iff no episode
 * exists yet for `referenceTime`'s ISO week AND `referenceTime` is at or
 * after 08:00:00.000 UTC on that week's Friday (inclusive at the exact
 * boundary). Advisory only — never a hard precondition on submission; the
 * only hard-enforced rule there is the one-episode-per-ISO-week uniqueness
 * constraint (`src/repositories/podcast-repository.ts`).
 */
export function isDueForCurrentWeek(referenceTime: Date, episodeExistsForCurrentWeek: boolean): boolean {
  if (episodeExistsForCurrentWeek) {
    return false;
  }
  return referenceTime.getTime() >= fridayDueBoundary(referenceTime).getTime();
}
