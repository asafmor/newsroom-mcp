import type { StoredContentItem } from "../domain/content-item.js";
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
