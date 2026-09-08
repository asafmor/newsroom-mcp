// Non-semantic "structure nudge" for the create-story/update-story `summary`
// input — see docs/agent-system-prompt.md and docs/mcp-tools.md. Uses the
// same `parseSummary` the reader-facing renderer (views/_shared/feed's story
// cards, and site/) uses to recognize lede+bullets structure, so this
// predicate and the renderer can never disagree about what "structured"
// means: there is exactly one parser, shared via src/shared/ so neither the
// server nor the view layer depends on the other.
import { parseSummary } from "../shared/summary-format.js";

/**
 * Above this length (in the same JS string-length unit the schemas' `.min(1)`
 * check already uses — no grapheme-cluster counting), a summary is expected
 * to use lede+bullets structure. "Exceeds" is strictly-greater: exactly 280
 * does not trigger.
 */
export const SUMMARY_STRUCTURE_THRESHOLD = 280;

/**
 * Pure function of the string's length and characters only — never a
 * judgment about what the summary says. True when a submitted `summary` is
 * long enough that structure is expected but the text has none.
 */
export function needsStructureNudge(summary: string): boolean {
  return summary.length > SUMMARY_STRUCTURE_THRESHOLD && parseSummary(summary).bullets.length === 0;
}

/**
 * Appended (never substituted) to a tool's existing confirmation text when
 * `needsStructureNudge` is true, so a caller matching the prior prefix still
 * recognizes the message.
 */
export const STRUCTURE_NUDGE =
  " This summary is long without lede+bullets structure — consider rewriting it as a short lede sentence plus '- ' bullets, one per distinct fact.";
