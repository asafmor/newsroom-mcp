import type { NewsroomConfig } from "../config.js";
import { ContentProviderRegistry } from "../providers/content-provider-registry.js";
import { HackerNewsContentProvider } from "../providers/hacker-news/hacker-news-content-provider.js";
import { RssContentProvider } from "../providers/rss/rss-content-provider.js";

/**
 * Curated AI-news RSS feeds. Each URL was hand-verified to serve real RSS/Atom
 * XML — add more here as new sources are found; this list is data, not logic.
 */
const RSS_FEEDS = [
  {
    id: "rss:openai",
    name: "OpenAI News",
    url: "https://openai.com/news/rss.xml"
  },
  {
    id: "rss:deepmind",
    name: "Google DeepMind",
    url: "https://deepmind.google/blog/rss.xml",
  },
  {
    id: "rss:huggingface",
    name: "Hugging Face Blog",
    url: "https://huggingface.co/blog/feed.xml",
  },
  {
    id: "rss:techcrunch-ai",
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
  {
    id: "rss:venturebeat-ai",
    name: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/feed/",
  },
  {
    id: "rss:mit-tech-review-ai",
    name: "MIT AI",
    url: "https://www.technologyreview.com/topic/artificial-intelligence/feed",
  },
  {
    id: "rss:anthropic",
    name: "Anthropic News",
    url: "https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/anthropic.xml",
  },
  {
    id: "rss:xai",
    name: "xAI News",
    url: "https://raw.githubusercontent.com/alan-turing-institute/ai-rss-feeds/refs/heads/main/feeds/spacex-ai-news.xml",
  },
  {
    id: "rss:meta-ai",
    name: "AI at Meta Blog",
    url: "https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/meta-ai.xml",
  },
  {
    id: "rss:claude-blog",
    name: "Claude Blog",
    url: "https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/claude.xml",
  },
  {
    id: "rss:cursor-blog",
    name: "Cursor Blog",
    url: "https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/cursor-blog.xml",
  },
  {
    id: "rss:cloudflare",
    name: "Cloudflare Blog",
    url: "https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/cloudflare-com.xml",
  },
  {
    id: "rss:wired-ai",
    name: "Wired AI",
    url: "https://www.wired.com/feed/tag/ai/latest/rss",
  },
  {
    id: "rss:arstechnica",
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/technology-lab",
  },
  {
    id: "rss:cnet-ai",
    name: "CNET AI",
    url: "https://www.cnet.com/rss/tech/software-and-services/ai/",
  },
  {
    id: "rss:gizmodo-ai",
    name: "Gizmodo AI",
    url: "https://gizmodo.com/tech/artificial-intelligence/feed",
  },
  {
    id: "rss:mashable-ai",
    name: "Mashable AI",
    url: "https://in.mashable.com/artificial-intelligence.xml",
  },
  {
    id: "rss:engadget-ai",
    name: "Engadget AI",
    url: "https://www.engadget.com/category/ai/feed/",
  },
  {
    id: "rss:venturebeat",
    name: "VentureBeat",
    url: "https://venturebeat.com/feed",
  },
  {
    id: "rss:geeky-gadgets-ai",
    name: "Geeky Gadgets AI",
    url: "https://www.geeky-gadgets.com/category/artificial-intelligence/feed/",
  },
] as const;

/**
 * GitHub repositories whose public release feed is tracked as a "release"
 * content source (see docs on curation criteria in requirements). Keep only
 * repos releasing at a followable cadence (roughly <=2-3/week) — vetted via
 * the GitHub releases API on 2026-09-02. Excluded for flooding the feed:
 * ggml-org/llama.cpp (~8/week, several same-day) and langchain-ai/langchain
 * (~7/week, ~daily). Excluded as stale: microsoft/autogen (no release in a
 * year). Add, remove, or reorder a tracked repository here only — no logic
 * changes needed, but re-check cadence before adding one.
 */
const GITHUB_RELEASE_REPOS = [
  "openai/openai-python",
  "anthropics/anthropic-sdk-python",
  "huggingface/transformers",
  "ollama/ollama",
  "vllm-project/vllm",
] as const;

/** Builds the registry of every configured provider for this deployment. */
export function buildProviderRegistry(config: NewsroomConfig): ContentProviderRegistry {
  const providers = [
    ...RSS_FEEDS.map(
      (feed) =>
        new RssContentProvider({
          id: feed.id,
          name: feed.name,
          url: feed.url,
          fetchTimeoutMs: config.fetchTimeoutMs,
        }),
    ),
    ...GITHUB_RELEASE_REPOS.map((slug) => {
      const repoName = slug.split("/")[1] ?? slug;
      return new RssContentProvider({
        id: `github-release:${slug}`,
        name: repoName,
        url: `https://github.com/${slug}/releases.atom`,
        fetchTimeoutMs: config.fetchTimeoutMs,
        kind: "release",
      });
    }),
    new HackerNewsContentProvider({
      id: "hacker-news",
      name: "Hacker News",
      query: config.hnQuery,
      fetchTimeoutMs: config.fetchTimeoutMs,
    }),
  ];

  return new ContentProviderRegistry(providers);
}
