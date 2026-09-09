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
