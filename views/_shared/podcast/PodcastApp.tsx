import { useId, useState } from "react";

import { EmptyState } from "../feed/EmptyState.js";
import { SkeletonCard } from "../feed/SkeletonCard.js";
import { formatIsoWeekRange } from "./formatters.js";
import type { PodcastEpisode } from "./types.js";

const AI_VOICE_DISCLOSURE = "This episode's narration is AI-generated audio, not a human voice.";

export type PodcastState =
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "success"; readonly episodes: readonly PodcastEpisode[] };

/**
 * Top-level orchestrator for the standalone site's podcast section — owns
 * the loading/error/empty/success states the way `FeedApp` does for the
 * story feed (see views/_shared/feed/FeedApp.tsx), reusing its
 * `EmptyState`/`SkeletonCard` components and `.newsroomFeed` reset/tokens.
 * No MCP View binds to this in this PR (see docs/mcp-tools.md) — it's only
 * ever mounted by site/src/main.tsx today.
 */
export function PodcastApp({ state }: { readonly state: PodcastState }) {
  if (state.status === "error") {
    return (
      <PodcastShell>
        <EmptyState title="Could not load the podcast" message={state.message} tone="error" />
      </PodcastShell>
    );
  }

  if (state.status === "pending") {
    return (
      <PodcastShell>
        <div className="podcast-list" aria-busy="true">
          <SkeletonCard />
        </div>
      </PodcastShell>
    );
  }

  return (
    <PodcastShell>
      {state.episodes.length === 0 ? (
        <EmptyState
          title="No episodes yet"
          message="The weekly podcast digest publishes here once the first episode's audio is ready."
        />
      ) : (
        <EpisodeList episodes={state.episodes} />
      )}
    </PodcastShell>
  );
}

function PodcastShell({ children }: { readonly children: React.ReactNode }) {
  return (
    // id="podcast-digest": the site header's "Weekly digest" entry point
    // (FeedHeader.tsx) links/scrolls here — see the P1 discoverability
    // finding this addresses.
    <section id="podcast-digest" className="newsroomFeed newsroomPodcast" aria-label="Weekly podcast digest">
      <div className="podcast-shell">
        <header className="podcast-header">
          <h2 className="podcast-title">Weekly Podcast Digest</h2>
          <p className="podcast-subtitle">An AI-narrated recap of the week&rsquo;s top AI stories.</p>
        </header>
        {children}
      </div>
    </section>
  );
}

/**
 * Pure presentational list — renders NOTHING (not an error, not a
 * placeholder implying broken state) when given no episodes, so it can be
 * reused later by a dedicated MCP surface without carrying the site's own
 * empty-state messaging along with it.
 */
export function EpisodeList({ episodes }: { readonly episodes: readonly PodcastEpisode[] | undefined }) {
  if (episodes === undefined || episodes.length === 0) {
    return null;
  }

  return (
    <div className="podcast-list">
      {episodes.map((episode) => (
        <EpisodeCard key={episode.id} episode={episode} />
      ))}
    </div>
  );
}

function EpisodeCard({ episode }: { readonly episode: PodcastEpisode }) {
  // Unavailable-audio episodes hide their only usable content otherwise —
  // default the transcript open for pending/failed; `ready` episodes may
  // keep the collapsed-by-default behavior since the player is the primary
  // affordance there.
  const transcriptDefaultOpen = episode.audioStatus !== "ready";

  return (
    <article className="podcast-card">
      <div className="podcast-card-head">
        <h3 className="podcast-card-title">{episode.title}</h3>
        <div className="podcast-card-dates">
          {/* Human calendar range is primary — a raw ISO week code doesn't
              identify the covered dates on its own (see docs/mcp-tools.md
              and criterion 47). The ISO code stays as secondary metadata. */}
          <span className="podcast-card-range">{formatIsoWeekRange(episode.isoWeek)}</span>
          <span className="podcast-card-week">{episode.isoWeek}</span>
        </div>
      </div>

      <AudioSection episode={episode} />

      <Transcript segments={episode.segments} defaultOpen={transcriptDefaultOpen} />
    </article>
  );
}

function AudioSection({ episode }: { readonly episode: PodcastEpisode }) {
  if (episode.audioStatus === "ready" && episode.audio !== null) {
    return (
      <div className="podcast-audio">
        {/* Native controls: keyboard-operable with no extra work, no autoplay. */}
        <audio controls preload="none" src={episode.audio.url}>
          Your browser does not support the audio element.
        </audio>
        <div className="podcast-audio-meta">
          <span>{formatDuration(episode.audio.durationSeconds)}</span>
        </div>
        {/* Adjacent to the player, not just once in a page footer — see G.49. */}
        <p className="podcast-disclosure">{AI_VOICE_DISCLOSURE}</p>
      </div>
    );
  }

  if (episode.audioStatus === "failed") {
    return (
      <p className="podcast-status podcast-status--failed" role="status">
        Audio couldn&rsquo;t be produced. We&rsquo;ll retry automatically. You can read the complete transcript
        below.
      </p>
    );
  }

  if (episode.audioStatus === "pending") {
    return (
      <p className="podcast-status podcast-status--pending" role="status">
        Audio for this episode is still being produced. The transcript below is already finished.
      </p>
    );
  }

  // Unrecognized/future-shaped audioStatus — degrade to a safe, non-crashing state.
  return (
    <p className="podcast-status" role="status">
      Audio status unavailable for this episode.
    </p>
  );
}

function Transcript({
  segments,
  defaultOpen,
}: {
  readonly segments: readonly string[];
  /** `true` for pending/failed episodes, where the transcript is the only usable content on the card. */
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className="podcast-transcript">
      <button
        type="button"
        className="podcast-transcript-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
      >
        {open ? "Hide transcript" : "Show transcript"}
      </button>
      {open && (
        <div id={bodyId} className="podcast-transcript-body">
          {/* Index keys are fine here: segments are an immutable, order-only transcript, never reordered/filtered. */}
          {segments.map((segment, index) => (
            <p key={index}>{segment}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}
