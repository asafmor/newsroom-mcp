// The HTTP seam to the OpenAI TTS API — injectable so tests never make a
// real network call (the same pattern already used to stub `fetch` in
// provider tests, see docs/testing.md). `defaultTtsRequest` is the one real
// implementation, wired only by scripts/synthesize-podcast.ts — never
// imported by the MCP server (src/composition.ts).

export interface TtsRequestParams {
  readonly text: string;
  readonly voice: string;
  readonly instructions: string;
}

export type TtsRequestFn = (params: TtsRequestParams) => Promise<ArrayBuffer>;

export interface SynthesizeChunkOptions {
  readonly maxAttempts?: number;
  /** Delay before the next attempt, in ms. Tests pass `() => 0` to stay fast. */
  readonly delayMs?: (attemptNumber: number) => number;
}

/**
 * Synthesizes one chunk, retrying a failure (non-2xx, network error, or
 * empty/invalid response body) with backoff up to `maxAttempts` (default: 2
 * retries, 3 attempts total) before throwing.
 */
export async function synthesizeChunkWithRetry(
  params: TtsRequestParams,
  request: TtsRequestFn,
  options?: SynthesizeChunkOptions,
): Promise<ArrayBuffer> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const delayFor = options?.delayMs ?? ((attemptNumber: number) => attemptNumber * 500);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const buffer = await request(params);
      if (buffer.byteLength === 0) {
        throw new Error("empty TTS response body");
      }
      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(delayFor(attempt));
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`TTS chunk synthesis failed after ${String(maxAttempts)} attempts: ${reason}`);
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Real implementation: calls the OpenAI TTS API with `process.env.OPENAI_API_KEY`
 * (script/CI-only — never `src/config.ts`/`NewsroomConfig`, which the MCP
 * server doesn't need this key for). Only ever called by
 * `scripts/synthesize-podcast.ts`.
 */
export async function defaultTtsRequest(params: TtsRequestParams & { readonly apiKey: string }): Promise<ArrayBuffer> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: params.voice,
      input: params.text,
      instructions: params.instructions,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`TTS request failed: ${String(response.status)} ${bodyText.slice(0, 200)}`);
  }

  return response.arrayBuffer();
}
