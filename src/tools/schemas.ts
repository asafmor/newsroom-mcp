import { z } from "zod";

import {
  PODCAST_INSTRUCTIONS_MAX_LENGTH,
  PODCAST_MAX_SEGMENTS,
  PODCAST_SEGMENT_MAX_CHARS,
  PODCAST_STATUS_DEFAULT_LIMIT,
  PODCAST_STATUS_MAX_LIMIT,
  PODCAST_TITLE_MAX_LENGTH,
  PODCAST_TOTAL_MAX_CHARS,
  PODCAST_TOTAL_MIN_CHARS,
  PODCAST_VOICES,
} from "../domain/podcast.js";

// Content items & providers -------------------------------------------------

const contentKindSchema = z.enum([
  "article",
  "discussion",
  "paper",
  "release",
  "model",
  "video",
  "social-post",
]);

const processingStatusSchema = z.enum(["pending", "linked", "ignored"]);

/** A `StoredContentItem`, dates serialized to ISO 8601 strings for transport. */
export const contentItemSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  externalId: z.string(),
  kind: contentKindSchema,
  title: z.string(),
  url: z.string(),
  publishedAt: z.string(),
  authors: z.array(z.string()).optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  discoveredAt: z.string(),
  processingStatus: processingStatusSchema,
});

// Stories ---------------------------------------------------------------

const storyContributionSchema = z.enum(["supporting", "meaningful-update", "background"]);

/** Closed vocabulary for agent-assigned story topic tags — fixed, no free text, no catch-all. */
const storyTagSchema = z.enum([
  "model-release",
  "research",
  "regulation",
  "funding",
  "product-launch",
  "safety",
  "infrastructure",
  "enterprise-adoption",
  "open-source",
  "opinion",
]);

/** At most 3 tags, no duplicates. Shared by create/update inputs and every story output. */
const storyTagsSchema = z
  .array(storyTagSchema)
  .max(3, "A story may have at most 3 tags")
  .refine((tags) => new Set(tags).size === tags.length, { message: "Duplicate tags are not allowed" })
  .describe(
    "Topic tags from a closed vocabulary — at most 3, no duplicates, and only ones that clearly apply. There is deliberately no catch-all value: if none fit, pass no tags at all. On update, this replaces the story's whole tag set (omit to preserve, [] to clear).",
  );

/** A `Story`, dates serialized to ISO 8601 strings for transport. */
export const storySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  relevanceScore: z.number(),
  importanceScore: z.number(),
  firstSeenAt: z.string(),
  lastItemAttachedAt: z.string(),
  lastMeaningfulUpdateAt: z.string(),
  status: z.enum(["active", "archived"]),
  tags: storyTagsSchema,
});

const attachedContentItemSummarySchema = z.object({
  contentItemId: z.string(),
  providerName: z.string(),
  title: z.string(),
  url: z.string(),
  publishedAt: z.string(),
  contribution: storyContributionSchema,
});

/** A story plus the enriched context an AI agent needs for clustering. */
export const activeStorySchema = storySchema.extend({
  sourceNames: z.array(z.string()),
  recentItems: z.array(attachedContentItemSummarySchema),
});

// fetch_new_items ------------------------------------------------------

export const fetchNewItemsInputSchema = z.object({});

export const fetchNewItemsOutputSchema = z.object({
  providersProcessed: z.number().int().nonnegative(),
  itemsFetched: z.number().int().nonnegative(),
  itemsInserted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  providers: z.array(
    z.object({
      providerId: z.string(),
      status: z.enum(["ok", "failed"]),
      itemsFetched: z.number().int().nonnegative(),
      itemsInserted: z.number().int().nonnegative(),
      duplicates: z.number().int().nonnegative(),
      error: z.string().optional(),
    }),
  ),
  storiesArchived: z.number().int().nonnegative(),
});

export type FetchNewItemsOutput = z.infer<typeof fetchNewItemsOutputSchema>;

// get_unprocessed_items --------------------------------------------------

export const getUnprocessedItemsInputSchema = z.object({
  limit: z.number().int().positive().max(500).default(50),
});
export type GetUnprocessedItemsInput = z.infer<typeof getUnprocessedItemsInputSchema>;

export const getUnprocessedItemsOutputSchema = z.object({
  items: z.array(contentItemSchema),
});
export type GetUnprocessedItemsOutput = z.infer<typeof getUnprocessedItemsOutputSchema>;

// get_active_stories -----------------------------------------------------

export const getActiveStoriesInputSchema = z.object({
  limit: z.number().int().positive().max(500).default(100),
  offset: z.number().int().nonnegative().default(0),
});
export type GetActiveStoriesInput = z.infer<typeof getActiveStoriesInputSchema>;

export const getActiveStoriesOutputSchema = z.object({
  stories: z.array(activeStorySchema),
  totalCount: z.number(),
  hasMore: z.boolean(),
});
export type GetActiveStoriesOutput = z.infer<typeof getActiveStoriesOutputSchema>;

// create_story -------------------------------------------------------------

// Readers include many non-native English speakers — see
// docs/agent-system-prompt.md's "How to write titles and summaries".
const PLAIN_ENGLISH_GUIDANCE =
  "Write in plain, simple English for readers who may not be native speakers: short common words, short sentences (about 20 words or fewer), active voice, no idioms, slang, hype, or puns, and explain any jargon or acronym in a few plain words.";

const TITLE_DESCRIPTION =
  PLAIN_ENGLISH_GUIDANCE +
  " The title is a clear, human headline that says who did what, in sentence case, under about 12 words — no clickbait, questions, or teasers. Example: 'Meta releases a smaller Llama model that runs on phones'.";

const SUMMARY_EXAMPLE =
  'Example (condensed from a real six-fact story, "OpenAI releases GPT-6 Astra, its most powerful model for cyber security tasks"): ' +
  '"OpenAI released GPT-6 Astra. The company calls it the start of a new era for AI.\n\n' +
  "- It is the first OpenAI model that the company rates as 'critical' risk for cyber attacks\n" +
  "- OpenAI will spend $1B to help security teams use the model safely\n" +
  "- It scores well on tests, but some experts question how OpenAI presents the results\n" +
  "- At launch, some paying users could not access it. CEO Sam Altman apologized and reset their usage limits\n" +
  '- Critics say it is harder for people to follow how the model reaches its answers, so it is harder to check its work"';

export const createStoryInputSchema = z.object({
  contentItemIds: z.array(z.string()).min(1),
  title: z.string().min(1).describe(TITLE_DESCRIPTION),
  summary: z
    .string()
    .min(1)
    .describe(
      "A short paragraph is correct and preferred for a story with one clear fact. Once the summary is genuinely long (over ~280 characters) or covers 3+ distinct facts, lede+bullets is the expected shape, not an optional nicety: write a short lede sentence, then a blank line, then one '- '-prefixed line per distinct fact (2-6 bullets). " +
        PLAIN_ENGLISH_GUIDANCE +
        " " +
        SUMMARY_EXAMPLE,
    ),
  relevanceScore: z.number().min(0).max(1),
  importanceScore: z.number().min(0).max(1),
  tags: storyTagsSchema.optional(),
});
export type CreateStoryInputSchema = z.infer<typeof createStoryInputSchema>;

export const createStoryOutputSchema = storySchema;
export type CreateStoryOutput = z.infer<typeof createStoryOutputSchema>;

// attach_item_to_story ------------------------------------------------------

export const attachItemToStoryInputSchema = z.object({
  storyId: z.string(),
  contentItemId: z.string(),
  contribution: storyContributionSchema,
  reason: z.string().optional(),
});
export type AttachItemToStoryInput = z.infer<typeof attachItemToStoryInputSchema>;

export const attachItemToStoryOutputSchema = storySchema;
export type AttachItemToStoryOutput = z.infer<typeof attachItemToStoryOutputSchema>;

// update_story ---------------------------------------------------------

export const updateStoryInputSchema = z.object({
  storyId: z.string(),
  title: z.string().min(1).optional().describe(TITLE_DESCRIPTION),
  summary: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Same convention as create-story: a short paragraph for one clear fact; lede+bullets (a short lede sentence, a blank line, then one '- '-prefixed line per distinct fact) is the expected shape once the summary is genuinely long (over ~280 characters) or covers 3+ distinct facts. " +
        "Restructure trigger: if this update adds a new distinct fact to an already-substantial summary, rewrite the WHOLE summary into lede+bullets rather than appending a clause or sentence onto the existing prose — accreting one fact per update call into a single paragraph is exactly the pattern this convention exists to prevent. " +
        PLAIN_ENGLISH_GUIDANCE +
        " " +
        SUMMARY_EXAMPLE,
    ),
  relevanceScore: z.number().min(0).max(1).optional(),
  importanceScore: z.number().min(0).max(1).optional(),
  tags: storyTagsSchema.optional(),
});
export type UpdateStoryInput = z.infer<typeof updateStoryInputSchema>;

export const updateStoryOutputSchema = storySchema;
export type UpdateStoryOutput = z.infer<typeof updateStoryOutputSchema>;

// mark_item_processed ------------------------------------------------------

export const markItemProcessedInputSchema = z.object({
  contentItemId: z.string(),
  status: z.enum(["linked", "ignored"]),
  reason: z.string().optional(),
});
export type MarkItemProcessedInput = z.infer<typeof markItemProcessedInputSchema>;

export const markItemProcessedOutputSchema = z.object({
  contentItemId: z.string(),
  status: z.enum(["linked", "ignored"]),
});
export type MarkItemProcessedOutput = z.infer<typeof markItemProcessedOutputSchema>;

// merge_stories --------------------------------------------------------

export const mergeStoriesInputSchema = z.object({
  survivingStoryId: z.string(),
  losingStoryId: z.string(),
});
export type MergeStoriesInput = z.infer<typeof mergeStoriesInputSchema>;

export const mergeStoriesOutputSchema = storySchema;
export type MergeStoriesOutput = z.infer<typeof mergeStoriesOutputSchema>;

// get_story ---------------------------------------------------------------

export const getStoryInputSchema = z.object({
  storyId: z.string().min(1),
});
export type GetStoryInput = z.infer<typeof getStoryInputSchema>;

const attachedContentItemSchema = attachedContentItemSummarySchema.extend({
  attachedAt: z.string(),
  reason: z.string().optional(),
});

export const getStoryOutputSchema = storySchema.extend({
  attachedItems: z.array(attachedContentItemSchema),
});
export type GetStoryOutput = z.infer<typeof getStoryOutputSchema>;

// get_feed -----------------------------------------------------------------

export const getFeedInputSchema = z.object({
  limit: z.number().int().positive().max(200).default(20),
  offset: z.number().int().nonnegative().default(0),
});
export type GetFeedInput = z.infer<typeof getFeedInputSchema>;

const feedSourceSchema = z.object({
  providerName: z.string(),
  title: z.string(),
  url: z.string(),
  publishedAt: z.string(),
  contribution: storyContributionSchema,
});

const feedStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  importanceScore: z.number(),
  relevanceScore: z.number(),
  firstSeenAt: z.string(),
  lastMeaningfulUpdateAt: z.string(),
  sources: z.array(feedSourceSchema),
  tags: storyTagsSchema,
});

export const getFeedOutputSchema = z.object({
  generatedAt: z.string(),
  stories: z.array(feedStorySchema),
  totalCount: z.number(),
  hasMore: z.boolean(),
});
export type GetFeedOutput = z.infer<typeof getFeedOutputSchema>;

// Weekly podcast digest ------------------------------------------------------

const podcastVoiceSchema = z.enum(PODCAST_VOICES);
const podcastAudioStateSchema = z.enum(["pending", "ready", "failed"]);

/** A persisted `PodcastEpisode`, dates serialized to ISO 8601 strings for transport. */
export const podcastEpisodeSchema = z.object({
  id: z.string(),
  isoWeek: z.string(),
  title: z.string(),
  segments: z.array(z.string()),
  totalCharacterCount: z.number().int().nonnegative(),
  voice: podcastVoiceSchema,
  instructions: z.string(),
  submittedAt: z.string(),
  audioState: podcastAudioStateSchema,
});
export type PodcastEpisodeSchema = z.infer<typeof podcastEpisodeSchema>;

// get-podcast-status ---------------------------------------------------------

export const getPodcastStatusInputSchema = z.object({
  limit: z.number().int().positive().max(PODCAST_STATUS_MAX_LIMIT).default(PODCAST_STATUS_DEFAULT_LIMIT),
});
export type GetPodcastStatusInput = z.infer<typeof getPodcastStatusInputSchema>;

const podcastEpisodeSummarySchema = z.object({
  id: z.string(),
  isoWeek: z.string(),
  title: z.string(),
  audioState: podcastAudioStateSchema,
  submittedAt: z.string(),
});

export const getPodcastStatusOutputSchema = z.object({
  currentIsoWeek: z.string(),
  episodeExists: z.boolean(),
  due: z.boolean(),
  recentEpisodes: z.array(podcastEpisodeSummarySchema),
});
export type GetPodcastStatusOutput = z.infer<typeof getPodcastStatusOutputSchema>;

// submit-podcast-episode ------------------------------------------------------

const podcastSegmentSchema = z
  .string()
  .trim()
  .min(1, "Each segment must be non-empty after trimming")
  .max(PODCAST_SEGMENT_MAX_CHARS, `Each segment must not exceed ${String(PODCAST_SEGMENT_MAX_CHARS)} characters`);

export const submitPodcastEpisodeInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title must be non-empty")
      .max(PODCAST_TITLE_MAX_LENGTH, `Title must not exceed ${String(PODCAST_TITLE_MAX_LENGTH)} characters`),
    segments: z
      .array(podcastSegmentSchema)
      .min(1, "At least one segment is required")
      .max(PODCAST_MAX_SEGMENTS, `No more than ${String(PODCAST_MAX_SEGMENTS)} segments are allowed`)
      .describe(
        "Ordered transcript segments, spoken-style prose. Start a new segment at each story transition. " +
          `Each segment: 1-${String(PODCAST_SEGMENT_MAX_CHARS)} characters. Segments are joined with a paragraph ` +
          "break for synthesis, so each one should read as a complete thought on its own.",
      ),
    voice: podcastVoiceSchema
      .optional()
      .describe(`Optional TTS voice; defaults to a fixed narrator voice if omitted. One of: ${PODCAST_VOICES.join(", ")}.`),
    instructions: z
      .string()
      .trim()
      .min(1)
      .max(PODCAST_INSTRUCTIONS_MAX_LENGTH, `Instructions must not exceed ${String(PODCAST_INSTRUCTIONS_MAX_LENGTH)} characters`)
      .optional()
      .describe("Optional tone/delivery instructions for the narrator; defaults to a fixed canned description if omitted."),
  })
  .superRefine((input, ctx) => {
    const total = input.segments.reduce((sum, segment) => sum + segment.length, 0);
    if (total < PODCAST_TOTAL_MIN_CHARS || total > PODCAST_TOTAL_MAX_CHARS) {
      ctx.addIssue({
        code: "custom",
        path: ["segments"],
        message:
          `Total script length is ${String(total)} characters; it must be between ` +
          `${String(PODCAST_TOTAL_MIN_CHARS)} and ${String(PODCAST_TOTAL_MAX_CHARS)} characters ` +
          "(~5-10 minutes at 150 wpm).",
      });
    }
  });
export type SubmitPodcastEpisodeInput = z.infer<typeof submitPodcastEpisodeInputSchema>;

export const submitPodcastEpisodeOutputSchema = podcastEpisodeSchema;
export type SubmitPodcastEpisodeOutput = z.infer<typeof submitPodcastEpisodeOutputSchema>;
