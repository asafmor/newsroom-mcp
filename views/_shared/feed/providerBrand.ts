/**
 * Per-provider brand identity for avatars. `slug` names the local logo file
 * in ./logos/<slug>.<ext> (any of png/jpg/jpeg/svg/webp) — see that folder's
 * README for the exact filenames expected. A provider with no logo file on
 * disk falls back to initials tinted with a color pulled from its real
 * site/brand palette instead of a generic gray.
 */
const logoFiles = import.meta.glob<string>("./logos/*.{png,jpg,jpeg,svg,webp}", { eager: true, import: "default" });

function findLogo(slug: string): string | undefined {
  const path = Object.keys(logoFiles).find((p) => p.startsWith(`./logos/${slug}.`));
  return path === undefined ? undefined : logoFiles[path];
}

const PROVIDER_BRANDS: Record<string, { slug: string; color: string }> = {
  "OpenAI News": { slug: "openai", color: "10A37F" },
  "Google DeepMind": { slug: "deepmind", color: "4285F4" },
  "Hugging Face Blog": { slug: "huggingface", color: "FFD21E" },
  "TechCrunch AI": { slug: "techcrunch", color: "029F00" },
  "VentureBeat AI": { slug: "venturebeat", color: "ED2025" },
  "MIT AI": { slug: "mit-tech-review", color: "F90E1E" },
  "Anthropic News": { slug: "anthropic", color: "191919" },
  "xAI News": { slug: "xai", color: "313131" },
  "AI at Meta Blog": { slug: "meta", color: "9844FF" },
  "Claude Blog": { slug: "claude", color: "D97757" },
  "Cursor Blog": { slug: "cursor", color: "000000" },
  "Cloudflare Blog": { slug: "cloudflare", color: "F38020" },
  "Wired AI": { slug: "wired", color: "EB0000" },
  "Ars Technica": { slug: "arstechnica", color: "FF4E00" },
  "CNET AI": { slug: "cnet", color: "E71D1D" },
  "Gizmodo AI": { slug: "gizmodo", color: "FF45DC" },
  "Mashable AI": { slug: "mashable", color: "00AEEF" },
  "Engadget AI": { slug: "engadget", color: "2B2D32" },
  VentureBeat: { slug: "venturebeat", color: "ED2025" },
  "Geeky Gadgets AI": { slug: "geeky-gadgets", color: "16A34A" },
  "MCP Blog": { slug: "mcp", color: "000000" },
  "Hacker News": { slug: "hacker-news", color: "FF6600" },
};

const DEFAULT_BRAND = { slug: "", color: "64748B" };

export function providerBrand(providerName: string): { logoUrl: string | undefined; color: string } {
  const brand = PROVIDER_BRANDS[providerName] ?? DEFAULT_BRAND;
  return { logoUrl: findLogo(brand.slug), color: brand.color };
}
