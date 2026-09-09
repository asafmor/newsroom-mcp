// Packs an episode's transcript segments into TTS request chunks — see
// docs/mcp-tools.md and the F acceptance criteria in the podcast digest
// requirements.

/** The OpenAI TTS API's hard limit on request `input` text length. */
export const TTS_CHUNK_CHAR_LIMIT = 4096;

/** Joins segments within one chunk — a paragraph break, so concatenation never audibly runs two segments together. */
export const CHUNK_SEPARATOR = "\n\n";

/**
 * Greedily concatenates consecutive WHOLE segments (original order
 * preserved) into chunks, never exceeding `limit`. A chunk never splits a
 * segment mid-sentence: every segment submitted via `submit-podcast-episode`
 * was already validated to be smaller than `TTS_CHUNK_CHAR_LIMIT` on its
 * own (see `PODCAST_SEGMENT_MAX_CHARS`), so this never needs to split one —
 * it only ever decides where one chunk ends and the next begins.
 */
export function packSegmentsIntoChunks(segments: readonly string[], limit = TTS_CHUNK_CHAR_LIMIT): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const segment of segments) {
    const addedLength = current.length === 0 ? segment.length : CHUNK_SEPARATOR.length + segment.length;

    if (current.length > 0 && currentLength + addedLength > limit) {
      chunks.push(current.join(CHUNK_SEPARATOR));
      current = [segment];
      currentLength = segment.length;
    } else {
      current.push(segment);
      currentLength += addedLength;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join(CHUNK_SEPARATOR));
  }

  return chunks;
}
