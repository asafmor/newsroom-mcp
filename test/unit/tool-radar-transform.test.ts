import { describe, expect, it } from "vitest";

import {
  DESCRIPTION_MAX,
  GITHUB_CAP,
  HF_MODELS_CAP,
  HF_SPACES_CAP,
  TOTAL_CAP,
  allSourcesFailed,
  buildToolRadarSnapshot,
  normalizeGithubRepo,
  normalizeHfModel,
  normalizeHfSpace,
  truncateDescription,
} from "../../src/tool-radar/transform.js";
import type { RawSourceResult, RawToolRadarSources } from "../../src/tool-radar/types.js";

const NOW = new Date("2026-09-10T08:00:00.000Z");

function githubRepo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    owner: { login: "acme" },
    name: "widget",
    html_url: "https://github.com/acme/widget",
    created_at: "2026-08-01T00:00:00Z",
    pushed_at: "2026-09-01T00:00:00Z",
    stargazers_count: 100,
    description: "A widget for making widgets.",
    language: "TypeScript",
    license: { name: "MIT" },
    topics: ["llm", "agents"],
    ...overrides,
  };
}

function hfModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "acme/model-1",
    createdAt: "2026-08-01T00:00:00Z",
    pipeline_tag: "text-generation",
    library_name: "transformers",
    downloads: 12_345,
    likes: 42,
    trendingScore: 999,
    ...overrides,
  };
}

function hfSpace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "acme/space-1",
    createdAt: "2026-08-02T00:00:00Z",
    cardData: { title: "Acme Space Demo", short_description: "A Space.", sdk: "gradio" },
    likes: 7,
    trendingScore: 888,
    ...overrides,
  };
}

const okSource = (items: readonly unknown[]): RawSourceResult => ({ status: "ok", items });
const errorSource = (error: string): RawSourceResult => ({ status: "error", error });

function raw(overrides: Partial<RawToolRadarSources> = {}): RawToolRadarSources {
  return {
    github: okSource([githubRepo()]),
    hfModels: okSource([hfModel()]),
    hfSpaces: okSource([hfSpace()]),
    ...overrides,
  };
}

describe("truncateDescription", () => {
  it("leaves short text untouched", () => {
    expect(truncateDescription("short")).toBe("short");
  });

  it("(f) truncates long text at a word boundary, under DESCRIPTION_MAX, with an ellipsis", () => {
    const long = `${"word ".repeat(60)}tail`;
    const result = truncateDescription(long);

    expect(result).toBeDefined();
    expect(result?.length).toBeLessThanOrEqual(DESCRIPTION_MAX + 1); // +1 for the ellipsis char
    expect(result?.endsWith("…")).toBe(true);
    expect(result?.endsWith(" …")).toBe(false); // no trailing space before the ellipsis
  });

  it("omits (never empty-strings) a blank/missing description", () => {
    expect(truncateDescription(undefined)).toBeUndefined();
    expect(truncateDescription("   ")).toBeUndefined();
  });
});

describe("normalizeGithubRepo", () => {
  it("(h) drops an item missing a required field instead of publishing a placeholder", () => {
    expect(normalizeGithubRepo(githubRepo({ owner: undefined }))).toBeUndefined();
    expect(normalizeGithubRepo(githubRepo({ name: undefined }))).toBeUndefined();
    expect(normalizeGithubRepo(githubRepo({ html_url: undefined }))).toBeUndefined();
    expect(normalizeGithubRepo(githubRepo({ created_at: undefined }))).toBeUndefined();
  });

  it("(i) never emits an installCommand for a GitHub repo", () => {
    const entry = normalizeGithubRepo(githubRepo());
    expect(entry?.installCommand).toBeUndefined();
  });

  it("caps topics at 5", () => {
    const entry = normalizeGithubRepo(githubRepo({ topics: ["a", "b", "c", "d", "e", "f", "g"] }));
    expect(entry?.topics).toHaveLength(5);
  });
});

describe("normalizeHfModel", () => {
  it("(i) always emits huggingface-cli download <id> as the install command", () => {
    const entry = normalizeHfModel(hfModel());
    expect(entry?.installCommand).toBe("huggingface-cli download acme/model-1");
  });

  it("(h) drops an item missing owner/name (no slash in id)", () => {
    expect(normalizeHfModel(hfModel({ id: "no-owner" }))).toBeUndefined();
  });

  it("never reads/emits the raw trendingScore field", () => {
    const entry = normalizeHfModel(hfModel());
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain("trendingScore");
    expect(JSON.stringify(entry)).not.toContain("999");
  });

  it("(P2) surfaces downloads and library_name, and never fabricates a description", () => {
    const entry = normalizeHfModel(hfModel());
    expect(entry?.downloads).toBe(12_345);
    expect(entry?.libraryName).toBe("transformers");
    expect(entry?.description).toBeUndefined();
  });

  it("(P2) omits downloads/library_name rather than faking them when the source didn't provide them", () => {
    const entry = normalizeHfModel(hfModel({ library_name: undefined, downloads: undefined }));
    expect(entry?.libraryName).toBeUndefined();
    expect(entry?.downloads).toBeUndefined();
  });
});

describe("normalizeHfSpace", () => {
  it("(i) never emits an installCommand for a Space", () => {
    const entry = normalizeHfSpace(hfSpace());
    expect(entry?.installCommand).toBeUndefined();
  });

  it("(P2) reads description from cardData.short_description, display name from cardData.title, and sdk", () => {
    const entry = normalizeHfSpace(hfSpace());
    expect(entry?.description).toBe("A Space.");
    expect(entry?.displayName).toBe("Acme Space Demo");
    expect(entry?.sdk).toBe("gradio");
  });

  it("(P2) omits description/displayName/sdk (never fakes them) when cardData is missing entirely", () => {
    const entry = normalizeHfSpace(hfSpace({ cardData: undefined }));
    expect(entry?.description).toBeUndefined();
    expect(entry?.displayName).toBeUndefined();
    expect(entry?.sdk).toBeUndefined();
  });

  it("(P2) omits description when cardData is present but short_description is missing", () => {
    const entry = normalizeHfSpace(hfSpace({ cardData: { title: "Acme Space Demo" } }));
    expect(entry?.description).toBeUndefined();
    expect(entry?.displayName).toBe("Acme Space Demo");
  });
});

describe("buildToolRadarSnapshot", () => {
  it("(a) isolates per-source failures — one erroring source doesn't drop the others' entries", () => {
    const snapshot = buildToolRadarSnapshot(
      raw({ github: errorSource("boom") }),
      NOW,
    );

    expect(snapshot.sources.github.status).toBe("error");
    expect(snapshot.sources.github.error).toBe("boom");
    expect(snapshot.sources.huggingfaceModels.status).toBe("ok");
    expect(snapshot.sources.huggingfaceSpaces.status).toBe("ok");
    expect(snapshot.entries.some((e) => e.source === "huggingface")).toBe(true);
    expect(snapshot.entries.some((e) => e.source === "github")).toBe(false);
  });

  it("(b) all three sources failing publishes entries: [] with every source status 'error', and allSourcesFailed is true", () => {
    const snapshot = buildToolRadarSnapshot(
      raw({ github: errorSource("g"), hfModels: errorSource("m"), hfSpaces: errorSource("s") }),
      NOW,
    );

    expect(snapshot.entries).toEqual([]);
    expect(snapshot.sources.github.status).toBe("error");
    expect(snapshot.sources.huggingfaceModels.status).toBe("error");
    expect(snapshot.sources.huggingfaceSpaces.status).toBe("error");
    expect(allSourcesFailed(snapshot)).toBe(true);
  });

  it("partial failure (1-2 of 3) does not count as allSourcesFailed", () => {
    const snapshot = buildToolRadarSnapshot(raw({ github: errorSource("g") }), NOW);
    expect(allSourcesFailed(snapshot)).toBe(false);
  });

  it("(d) preserves Hugging Face's own response order verbatim (no local re-sort)", () => {
    const models = [
      hfModel({ id: "acme/second", trendingScore: 50 }),
      hfModel({ id: "acme/first", trendingScore: 9999 }),
    ];
    const snapshot = buildToolRadarSnapshot(raw({ hfModels: okSource(models) }), NOW);

    const modelEntries = snapshot.entries.filter((e) => e.kind === "model");
    expect(modelEntries.map((e) => e.name)).toEqual(["second", "first"]);
  });

  it("ranks GitHub entries by starCount descending", () => {
    const repos = [
      githubRepo({ name: "low", stargazers_count: 5 }),
      githubRepo({ name: "high", stargazers_count: 500 }),
    ];
    const snapshot = buildToolRadarSnapshot(raw({ github: okSource(repos) }), NOW);

    const repoEntries = snapshot.entries.filter((e) => e.kind === "repository");
    expect(repoEntries.map((e) => e.name)).toEqual(["high", "low"]);
  });

  it("sorts before capping — a high-star repo listed after the cap boundary in raw order still survives", () => {
    // GITHUB_CAP low-star filler repos first (simulating GITHUB_TOPICS[0]'s
    // full page), then one huge-star repo from a later topic query — a
    // cap-then-sort bug drops it since it never makes the positional slice.
    const filler = Array.from({ length: GITHUB_CAP }, (_, i) =>
      githubRepo({ name: `filler-${String(i)}`, html_url: `https://github.com/acme/filler-${String(i)}`, stargazers_count: 10 }),
    );
    const popular = githubRepo({ name: "popular", html_url: "https://github.com/acme/popular", stargazers_count: 99_999 });
    const snapshot = buildToolRadarSnapshot(raw({ github: okSource([...filler, popular]) }), NOW);

    const repoEntries = snapshot.entries.filter((e) => e.kind === "repository");
    expect(repoEntries).toHaveLength(GITHUB_CAP);
    expect(repoEntries[0]?.name).toBe("popular");
    expect(repoEntries.some((e) => e.name === "popular")).toBe(true);
  });

  it("(g) collapses a cross-query GitHub duplicate to a single entry", () => {
    const repo = githubRepo();
    const snapshot = buildToolRadarSnapshot(raw({ github: okSource([repo, repo]) }), NOW);

    const repoEntries = snapshot.entries.filter((e) => e.kind === "repository");
    expect(repoEntries).toHaveLength(1);
  });

  it("(e) enforces the per-source caps and the total cap", () => {
    const manyRepos = Array.from({ length: GITHUB_CAP + 10 }, (_, i) =>
      githubRepo({ name: `repo-${String(i)}`, html_url: `https://github.com/acme/repo-${String(i)}` }),
    );
    const manyModels = Array.from({ length: HF_MODELS_CAP + 10 }, (_, i) => hfModel({ id: `acme/model-${String(i)}` }));
    const manySpaces = Array.from({ length: HF_SPACES_CAP + 10 }, (_, i) => hfSpace({ id: `acme/space-${String(i)}` }));

    const snapshot = buildToolRadarSnapshot(
      raw({ github: okSource(manyRepos), hfModels: okSource(manyModels), hfSpaces: okSource(manySpaces) }),
      NOW,
    );

    expect(snapshot.sources.github.count).toBe(GITHUB_CAP);
    expect(snapshot.sources.huggingfaceModels.count).toBe(HF_MODELS_CAP);
    expect(snapshot.sources.huggingfaceSpaces.count).toBe(HF_SPACES_CAP);
    expect(snapshot.entries).toHaveLength(TOTAL_CAP);
    expect(snapshot.entries.length).toBeLessThanOrEqual(60);
  });

  it("(j) a maximal-cap snapshot stays well within the tens-of-KB publish budget", () => {
    const manyRepos = Array.from({ length: GITHUB_CAP }, (_, i) =>
      githubRepo({
        name: `repo-${String(i)}`,
        html_url: `https://github.com/acme/repo-${String(i)}`,
        description: "word ".repeat(60),
        topics: ["a", "b", "c", "d", "e"],
      }),
    );
    const manyModels = Array.from({ length: HF_MODELS_CAP }, (_, i) => hfModel({ id: `acme/model-${String(i)}` }));
    const manySpaces = Array.from({ length: HF_SPACES_CAP }, (_, i) =>
      hfSpace({
        id: `acme/space-${String(i)}`,
        cardData: { title: `Space ${String(i)}`, short_description: "word ".repeat(60), sdk: "gradio" },
      }),
    );

    const snapshot = buildToolRadarSnapshot(
      raw({ github: okSource(manyRepos), hfModels: okSource(manyModels), hfSpaces: okSource(manySpaces) }),
      NOW,
    );

    const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
    expect(bytes).toBeLessThan(200_000);
  });
});
