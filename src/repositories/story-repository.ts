import type { ContentItemId } from "../domain/content-item.js";
import type { ProviderId } from "../domain/provider.js";
import type {
  CreateStoryInput,
  Story,
  StoryContribution,
  StoryId,
  StoryItem,
  UpdateStoryInput,
} from "../domain/story.js";

/**
 * A content item attached to a story, joined with the fields a caller needs
 * to render it as a source. Carries `providerId` rather than a display name
 * — resolving a provider id to its configured name is an application-layer
 * concern (the registry), not a persistence concern.
 */
export interface AttachedContentItem {
  contentItemId: ContentItemId;
  providerId: ProviderId;
  title: string;
  url: string;
  publishedAt: Date;
  contribution: StoryContribution;
  reason?: string;
  attachedAt: Date;
}

/**
 * Persistence for stories and their content-item relationships. `create`
 * inserts the story row and links its founding `contentItemIds` in one
 * transaction; every other content-item relationship goes through
 * `attachItem`.
 */
export interface StoryRepository {
  create(input: CreateStoryInput): Promise<Story>;

  findById(id: StoryId): Promise<Story | null>;

  findActive(options?: { limit?: number; offset?: number }): Promise<Story[]>;

  /** Count of stories with `status = 'active'`, for pagination totals. */
  countActive(): Promise<number>;

  update(id: StoryId, patch: UpdateStoryInput): Promise<Story>;

  archive(id: StoryId): Promise<void>;

  /** Archives every active story last meaningfully updated before `cutoff`. Returns the count archived. */
  archiveStale(cutoff: Date): Promise<number>;

  attachItem(link: StoryItem): Promise<void>;

  findAttachedContent(storyId: StoryId): Promise<AttachedContentItem[]>;
}
