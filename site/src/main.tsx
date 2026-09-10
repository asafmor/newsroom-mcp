import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { FeedApp, type FeedState } from "../../views/_shared/feed/FeedApp.js";
import type { DigestEntry, FeedStory } from "../../views/_shared/feed/types.js";
import "../../views/_shared/feed/feed.css";
import { latestDigestEntry } from "../../views/_shared/podcast/formatters.js";
import { PodcastApp, type PodcastState } from "../../views/_shared/podcast/PodcastApp.js";
import type { PodcastEpisode } from "../../views/_shared/podcast/types.js";
import "../../views/_shared/podcast/podcast.css";
import { toolsDigestEntry } from "../../views/_shared/tools/formatters.js";
import { ToolRadarApp, type ToolRadarState } from "../../views/_shared/tools/ToolRadarApp.js";
import type { ToolEntry, ToolRadarSources } from "../../views/_shared/tools/types.js";
import "../../views/_shared/tools/tools.css";

function App() {
  const [state, setState] = useState<FeedState>({ status: "pending" });
  const [podcastState, setPodcastState] = useState<PodcastState>({ status: "pending" });
  const [toolRadarState, setToolRadarState] = useState<ToolRadarState>({ status: "pending" });

  useEffect(() => {
    fetch("./feed.json")
      .then((res) => {
        if (!res.ok) throw new Error(`feed.json request failed: ${String(res.status)}`);
        return res.json() as Promise<{ generatedAt: string; stories: readonly FeedStory[] }>;
      })
      .then((feed) => {
        setState({ status: "success", generatedAt: feed.generatedAt, stories: feed.stories });
      })
      .catch((error: unknown) => {
        setState({ status: "error", message: error instanceof Error ? error.message : "Failed to load the feed." });
      });
  }, []);

  useEffect(() => {
    fetch("./podcast.json")
      .then((res) => {
        // podcast.json genuinely not existing yet (no episode ever
        // published) is a normal "no episodes" state, not an error — a real
        // fetch failure (network error, 5xx, invalid JSON) below is what
        // stays visually distinct as an error state.
        if (res.status === 404) {
          return { generatedAt: new Date(0).toISOString(), episodes: [] };
        }
        if (!res.ok) throw new Error(`podcast.json request failed: ${String(res.status)}`);
        return res.json() as Promise<{ generatedAt: string; episodes: readonly PodcastEpisode[] }>;
      })
      .then((podcast) => {
        setPodcastState({ status: "success", episodes: podcast.episodes });
      })
      .catch((error: unknown) => {
        setPodcastState({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load the podcast.",
        });
      });
  }, []);

  useEffect(() => {
    fetch("./tools.json")
      .then((res) => {
        // Same 404-as-normal-empty-state handling as podcast.json above —
        // tools.json genuinely not existing yet (before the first
        // publish-tool-radar run) is a normal "nothing published yet"
        // state, not an error.
        if (res.status === 404) {
          return {
            generatedAt: new Date(0).toISOString(),
            sources: {
              github: { status: "ok", count: 0 },
              huggingfaceModels: { status: "ok", count: 0 },
              huggingfaceSpaces: { status: "ok", count: 0 },
            } satisfies ToolRadarSources,
            entries: [],
          };
        }
        if (!res.ok) throw new Error(`tools.json request failed: ${String(res.status)}`);
        return res.json() as Promise<{
          generatedAt: string;
          sources: ToolRadarSources;
          entries: readonly ToolEntry[];
        }>;
      })
      .then((snapshot) => {
        setToolRadarState({
          status: "success",
          generatedAt: snapshot.generatedAt,
          sources: snapshot.sources,
          entries: snapshot.entries,
        });
      })
      .catch((error: unknown) => {
        setToolRadarState({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load Tool Radar.",
        });
      });
  }, []);

  // Compact "Weekly digest" header entry point (P1 UI-review finding) —
  // `undefined` while the podcast hasn't loaded (or loaded with zero
  // episodes / an error), so FeedHeader renders nothing rather than a
  // misleading link. The href matches PodcastApp's own section id.
  const digestSummary = podcastState.status === "success" ? latestDigestEntry(podcastState.episodes) : undefined;
  const digestEntry: DigestEntry | undefined =
    digestSummary === undefined ? undefined : { ...digestSummary, href: "#podcast-digest" };

  // Same "render nothing rather than a misleading link" discipline as
  // digestEntry above: undefined until Tool Radar has actually loaded a
  // non-empty, non-all-failed snapshot (see toolsDigestEntry).
  const toolsSummary =
    toolRadarState.status === "success" ? toolsDigestEntry(toolRadarState.entries, toolRadarState.sources) : undefined;
  const toolsEntry: DigestEntry | undefined =
    toolsSummary === undefined ? undefined : { ...toolsSummary, href: "#tool-radar" };

  return (
    <>
      <FeedApp
        variant="site"
        state={state}
        onOpenSource={(url) => {
          window.open(url, "_blank", "noopener");
        }}
        digestEntry={digestEntry}
        toolsEntry={toolsEntry}
      />
      <PodcastApp state={podcastState} />
      <ToolRadarApp state={toolRadarState} />
    </>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("#root element not found");
createRoot(root).render(<App />);
