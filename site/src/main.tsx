import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { FeedApp, type FeedState } from "../../shared-ui/feed/FeedApp.js";
import type { FeedStory } from "../../shared-ui/feed/types.js";
import "../../shared-ui/feed/feed.css";

function App() {
  const [state, setState] = useState<FeedState>({ status: "pending" });

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

  return (
    <FeedApp
      variant="site"
      state={state}
      onOpenSource={(url) => {
        window.open(url, "_blank", "noopener");
      }}
    />
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("#root element not found");
createRoot(root).render(<App />);
