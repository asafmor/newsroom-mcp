import { z } from "zod";

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

export const createStoryInputSchema = z.object({
  contentItemIds: z.array(z.string()).min(1),
  title: z.string().min(1),
  summary: z
    .string()
    .min(1)
    .describe(
      "Plain prose by default: a short paragraph. Optionally, for a story with genuinely multiple discrete facets, a short lede sentence followed by a blank line and 2-4 short lines each starting with '- ' — this structure is never required and a single paragraph is always correct.",
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
  title: z.string().min(1).optional(),
  summary: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Plain prose by default: a short paragraph. Optionally, for a story with genuinely multiple discrete facets, a short lede sentence followed by a blank line and 2-4 short lines each starting with '- ' — this structure is never required and a single paragraph is always correct.",
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
