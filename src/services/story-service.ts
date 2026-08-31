import type { ContentItemRepository } from "../repositories/content-item-repository.js";
import type { StoryRepository } from "../repositories/story-repository.js";
import type {
  AttachItemInput,
  CreateStoryInput,
  Story,
  StoryId,
  UpdateStoryInput,
} from "../domain/story.js";

/** No `meaningful-update` in this long → the story is retired from clustering candidacy. */
const STALE_STORY_AGE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Owns every story mutation. In particular it enforces the
 * `lastMeaningfulUpdateAt` rule: only a `meaningful-update` attachment bumps
 * it, so a late supporting article never resets story freshness.
 */
export class StoryService {
  constructor(
    private readonly stories: StoryRepository,
    private readonly items: ContentItemRepository,
  ) {}

  async createStory(input: CreateStoryInput): Promise<Story> {
    return this.stories.create(input);
  }

  async attachItem(input: AttachItemInput): Promise<Story> {
    const story = await this.stories.findById(input.storyId);

    if (!story) {
      throw new Error(`Story not found: ${input.storyId}`);
    }

    const item = await this.items.findById(input.contentItemId);

    if (!item) {
      throw new Error(`Content item not found: ${input.contentItemId}`);
    }

    // The repository owns the lastItemAttachedAt/lastMeaningfulUpdateAt
    // consequence of `contribution`; this service only expresses the intent.
    await this.stories.attachItem({
      storyId: input.storyId,
      contentItemId: input.contentItemId,
      contribution: input.contribution,
      reason: input.reason,
      attachedAt: new Date(),
    });

    const updated = await this.stories.findById(input.storyId);

    if (!updated) {
      throw new Error(`Story disappeared during attach: ${input.storyId}`);
    }

    return updated;
  }

  async updateStory(id: StoryId, input: UpdateStoryInput): Promise<Story> {
    return this.stories.update(id, input);
  }

  /**
   * Archives every active story that's gone quiet for over
   * `STALE_STORY_AGE_DAYS` — well past `get-feed`'s 7-day cutoff, so a
   * resumed story rarely misses its original and gets duplicated. Intended
   * to run once per `fetch-new-items` poll, the one guaranteed-periodic
   * entry point.
   */
  async archiveStaleStories(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_STORY_AGE_DAYS * MS_PER_DAY);
    return this.stories.archiveStale(cutoff);
  }
}
