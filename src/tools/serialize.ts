import type { StoredContentItem } from "../domain/content-item.js";
import type { PodcastEpisode } from "../domain/podcast.js";
import type { Story } from "../domain/story.js";

/** Converts a `StoredContentItem`'s `Date` fields to ISO strings for transport. */
export function serializeContentItem(item: StoredContentItem) {
  return {
    ...item,
    publishedAt: item.publishedAt.toISOString(),
    discoveredAt: item.discoveredAt.toISOString(),
  };
}

/** Converts a `Story`'s `Date` fields to ISO strings for transport. */
export function serializeStory(story: Story) {
  return {
    ...story,
    firstSeenAt: story.firstSeenAt.toISOString(),
    lastItemAttachedAt: story.lastItemAttachedAt.toISOString(),
    lastMeaningfulUpdateAt: story.lastMeaningfulUpdateAt.toISOString(),
  };
}

/** Converts a `PodcastEpisode`'s `Date` field to an ISO string and its `segments` to a plain mutable array for transport. */
export function serializePodcastEpisode(episode: PodcastEpisode) {
  return {
    ...episode,
    segments: [...episode.segments],
    submittedAt: episode.submittedAt.toISOString(),
  };
}
