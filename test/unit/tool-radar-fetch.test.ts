import { afterEach, describe, expect, it, vi } from "vitest";

import { collectRawToolRadarSources, fetchGithubRepos, fetchHfModels, fetchHfSpaces } from "../../src/tool-radar/fetch.js";

const NOW = new Date("2026-09-10T08:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
  delete process.env.HF_TOKEN;
});

describe("fetchGithubRepos", () => {
  it("(c) every query includes a created:> recency filter", async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        calledUrls.push(url);
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }),
    );

    await fetchGithubRepos(NOW);

    expect(calledUrls.length).toBeGreaterThan(0);
    for (const url of calledUrls) {
      const q = new URL(url).searchParams.get("q") ?? "";
      expect(q).toMatch(/created:>\d{4}-\d{2}-\d{2}/);
    }
  });

  it("never runs without GITHUB_TOKEN set (token stays optional)", async () => {
    const seenHeaders: HeadersInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        seenHeaders.push(init?.headers ?? {});
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }),
    );

    const result = await fetchGithubRepos(NOW);

    expect(result.status).toBe("ok");
    for (const headers of seenHeaders) {
      expect(JSON.stringify(headers)).not.toContain("Authorization");
    }
  });

  it("adds a bearer Authorization header only when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "secret-token";
    let sawAuthHeader = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers?.Authorization === "Bearer secret-token") sawAuthHeader = true;
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }),
    );

    await fetchGithubRepos(NOW);

    expect(sawAuthHeader).toBe(true);
  });

  it("(a) isolates per-topic-query failures — one rejected query still returns the others' items", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        call += 1;
        if (call === 1) return Promise.reject(new Error("network down"));
        return Promise.resolve(new Response(JSON.stringify({ items: [{ id: call }] }), { status: 200 }));
      }),
    );

    const result = await fetchGithubRepos(NOW);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.items.length).toBeGreaterThan(0);
    }
  });

  it("reports a partial failure via onPartialFailure when some-but-not-all topic queries fail, without changing status", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        call += 1;
        if (call === 1) return Promise.reject(new Error("network down"));
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }),
    );

    let message: string | undefined;
    const result = await fetchGithubRepos(NOW, (m) => {
      message = m;
    });

    expect(result.status).toBe("ok");
    expect(message).toMatch(/^1\/4 GitHub topic queries failed/);
  });

  it("reports 'error' only once every topic query fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("all down"))));

    const result = await fetchGithubRepos(NOW);

    expect(result.status).toBe("error");
  });

  it("never leaks a token value into the bounded error message", async () => {
    process.env.GITHUB_TOKEN = "super-secret-value";
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("boom"))));

    const result = await fetchGithubRepos(NOW);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).not.toContain("super-secret-value");
    }
  });
});

describe("fetchHfModels / fetchHfSpaces", () => {
  it("each has its own try/catch — a models failure doesn't affect Spaces", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/models")) return Promise.reject(new Error("models down"));
        return Promise.resolve(new Response(JSON.stringify([{ id: "acme/space-1" }]), { status: 200 }));
      }),
    );

    const models = await fetchHfModels();
    const spaces = await fetchHfSpaces();

    expect(models.status).toBe("error");
    expect(spaces.status).toBe("ok");
  });

  it("sorts by trendingScore server-side via the request URL, never re-sorted locally here", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        requestedUrl = url;
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }),
    );

    await fetchHfModels();

    expect(requestedUrl).toContain("sort=trendingScore");
    expect(requestedUrl).toContain("direction=-1");
  });
});

describe("collectRawToolRadarSources", () => {
  it("(a) fetches all three sources concurrently and isolates failures per source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("api.github.com")) return Promise.reject(new Error("github down"));
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }),
    );

    const result = await collectRawToolRadarSources(NOW);

    expect(result.github.status).toBe("error");
    expect(result.hfModels.status).toBe("ok");
    expect(result.hfSpaces.status).toBe("ok");
  });

  it("surfaces a githubPartialFailure message without affecting github.status", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("api.github.com")) {
          call += 1;
          if (call === 1) return Promise.reject(new Error("one topic down"));
        }
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }),
    );

    const result = await collectRawToolRadarSources(NOW);

    expect(result.github.status).toBe("ok");
    expect(result.githubPartialFailure).toMatch(/GitHub topic queries failed/);
  });
});
