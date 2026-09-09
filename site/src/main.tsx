import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { FeedApp, type FeedState } from "../../views/_shared/feed/FeedApp.js";
import type { DigestEntry, FeedStory } from "../../views/_shared/feed/types.js";
import "../../views/_shared/feed/feed.css";
import { latestDigestEntry } from "../../views/_shared/podcast/formatters.js";
import { PodcastApp, type PodcastState } from "../../views/_shared/podcast/PodcastApp.js";
import type { PodcastEpisode } from "../../views/_shared/podcast/types.js";
import "../../views/_shared/podcast/podcast.css";

function App() {
  const [state, setState] = useState<FeedState>({ status: "pending" });
  const [podcastState, setPodcastState] = useState<PodcastState>({ status: "pending" });

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

  // Compact "Weekly digest" header entry point (P1 UI-review finding) —
  // `undefined` while the podcast hasn't loaded (or loaded with zero
  // episodes / an error), so FeedHeader renders nothing rather than a
  // misleading link. The href matches PodcastApp's own section id.
  const digestSummary = podcastState.status === "success" ? latestDigestEntry(podcastState.episodes) : undefined;
  const digestEntry: DigestEntry | undefined =
    digestSummary === undefined ? undefined : { ...digestSummary, href: "#podcast-digest" };

  return (
    <>
      <FeedApp
        variant="site"
        state={state}
        onOpenSource={(url) => {
          window.open(url, "_blank", "noopener");
        }}
        digestEntry={digestEntry}
      />
      <PodcastApp state={podcastState} />
    </>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("#root element not found");
createRoot(root).render(<App />);
