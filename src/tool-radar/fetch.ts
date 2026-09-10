// The HTTP-fetching seam: talks to the three public APIs with native
// `fetch()` (no new dependency, same as every ContentProvider — see
// docs/providers.md), each bounded by a per-request timeout
// (`AbortSignal.timeout`, the same stdlib mechanism RssContentProvider
// already uses) and each independently try/caught so one endpoint's
// failure, timeout, non-2xx, or unparseable body never prevents the other
// two from being fetched. Deliberately separate from transform.ts's pure
// ranking/dedup/cap logic (see that file's header comment) — this module
// only ever returns `RawSourceResult`s, never throws to its caller.
//
// GITHUB_TOKEN / HF_TOKEN are read directly from process.env, script/CI-only
// (never src/config.ts/NewsroomConfig — the MCP server never needs them) —
// see .env.example. Neither is ever required: every request works
// (at a lower rate limit) with no token at all.
import type { RawSourceResult } from "./types.js";
import { GITHUB_RECENCY_DAYS } from "./transform.js";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Curated topics covering AI tools/libraries/frameworks/dev-tools — one
 * `topic:` + one `created:>` qualifier per request, well under GitHub
 * Search's ~5 logical-operator / 256-char query limit, so each topic is its
 * own request rather than one giant OR'd query. Four requests (plus two for
 * Hugging Face) is trivially inside the weekly job's rate budget (10/min
 * unauthenticated, 30/min with GITHUB_TOKEN).
 */
const GITHUB_TOPICS = ["llm", "generative-ai", "ai-agents", "machine-learning"];

/** More than any single per-source cap (see transform.ts) so a later dedup/cap step is never starved by the request's own page size. */
const HF_FETCH_LIMIT = 40;

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Bounded (<=200 chars) and built only from HTTP status/statusText or the
  // runtime's own network-error message — never from a request header, so a
  // token can never leak into this string, and by extension never into
  // tools.json or a log line.
  return message.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function fetchJson(url: string, headers: HeadersInit): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${String(response.status)} ${response.statusText} for ${url}`);
  }
  return response.json();
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token !== undefined && token !== "") headers.Authorization = `Bearer ${token}`;
  return headers;
}

function hfHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  const token = process.env.HF_TOKEN;
  if (token !== undefined && token !== "") headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Runs one request per curated topic (Promise.allSettled — one topic's
 * failure doesn't sink the others), merges every successful query's `items`
 * into one raw list (cross-query duplicates are collapsed later, in
 * transform.ts) and reports "error" only if every single topic query
 * failed (the resolved `RawSourceResult`'s shape never changes because of
 * this). When some-but-not-all topic queries failed, `onPartialFailure` (if
 * given) is called with an operator-facing message — status stays "ok" and
 * no items are dropped, this is visibility only, for
 * scripts/publish-tool-radar.ts to log.
 */
export async function fetchGithubRepos(now: Date, onPartialFailure?: (message: string) => void): Promise<RawSourceResult> {
  const since = formatDateOnly(new Date(now.getTime() - GITHUB_RECENCY_DAYS * 24 * 60 * 60 * 1000));
  const headers = githubHeaders();

  const settled = await Promise.allSettled(
    GITHUB_TOPICS.map((topic) => {
      const q = `topic:${topic} created:>${since}`;
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
      return fetchJson(url, headers);
    }),
  );

  const items: unknown[] = [];
  let anySucceeded = false;
  let firstError: unknown;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      anySucceeded = true;
      const body = result.value;
      const bodyItems = typeof body === "object" && body !== null ? (body as { items?: unknown }).items : undefined;
      // `Array.isArray` narrows `unknown` to `any[]`; re-assert `unknown[]`
      // so the spread stays type-safe (the transform validates each item).
      if (Array.isArray(bodyItems)) items.push(...(bodyItems as unknown[]));
    } else {
      firstError ??= result.reason;
    }
  }

  if (!anySucceeded) {
    return { status: "error", error: boundedErrorMessage(firstError ?? new Error("all GitHub queries failed")) };
  }
  const failedCount = settled.filter((s) => s.status === "rejected").length;
  if (failedCount > 0) {
    onPartialFailure?.(
      `${String(failedCount)}/${String(GITHUB_TOPICS.length)} GitHub topic queries failed this run (first error: ${boundedErrorMessage(firstError)})`,
    );
  }
  return { status: "ok", items };
}

export async function fetchHfModels(): Promise<RawSourceResult> {
  try {
    const url = `https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=${String(HF_FETCH_LIMIT)}&full=true`;
    const data = await fetchJson(url, hfHeaders());
    if (!Array.isArray(data)) throw new Error("unexpected Hugging Face models response shape");
    return { status: "ok", items: data };
  } catch (error) {
    return { status: "error", error: boundedErrorMessage(error) };
  }
}

export async function fetchHfSpaces(): Promise<RawSourceResult> {
  try {
    const url = `https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=${String(HF_FETCH_LIMIT)}&full=true`;
    const data = await fetchJson(url, hfHeaders());
    if (!Array.isArray(data)) throw new Error("unexpected Hugging Face spaces response shape");
    return { status: "ok", items: data };
  } catch (error) {
    return { status: "error", error: boundedErrorMessage(error) };
  }
}

/** Runs all three endpoint fetches concurrently — mirrors IngestionService's per-provider isolation (Promise.all over calls that already never throw). */
export async function collectRawToolRadarSources(now: Date): Promise<{
  readonly github: RawSourceResult;
  readonly hfModels: RawSourceResult;
  readonly hfSpaces: RawSourceResult;
  /** Set when some-but-not-all GitHub topic queries failed even though `github.status` stayed "ok" (see fetchGithubRepos) — operator-visibility only; scripts/publish-tool-radar.ts logs it, nothing else reads it. */
  readonly githubPartialFailure?: string;
}> {
  let githubPartialFailure: string | undefined;
  const [github, hfModels, hfSpaces] = await Promise.all([
    fetchGithubRepos(now, (message) => {
      githubPartialFailure = message;
    }),
    fetchHfModels(),
    fetchHfSpaces(),
  ]);
  return { github, hfModels, hfSpaces, githubPartialFailure };
}
