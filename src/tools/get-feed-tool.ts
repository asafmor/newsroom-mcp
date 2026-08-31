import type { ToolRegistrar } from "./tool-registrar.js";

import type { FeedService } from "../services/feed-service.js";
import { getFeedInputSchema, getFeedOutputSchema } from "./schemas.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerGetFeedTool(server: ToolRegistrar, feedService: FeedService) {
  return server.tool(
    {
      name: "get-feed",
      description: "Retrieve the current curated AI news feed as stories (not raw content items).",
      inputSchema: getFeedInputSchema,
      outputSchema: getFeedOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ limit, offset }) => {
      try {
        const feed = await feedService.getFeed({ limit, offset });
        const serialized = {
          generatedAt: feed.generatedAt.toISOString(),
          stories: feed.stories.map((story) => ({
            ...story,
            firstSeenAt: story.firstSeenAt.toISOString(),
            lastMeaningfulUpdateAt: story.lastMeaningfulUpdateAt.toISOString(),
            sources: story.sources.map((source) => ({
              ...source,
              publishedAt: source.publishedAt.toISOString(),
            })),
          })),
          totalCount: feed.totalCount,
          hasMore: feed.hasMore,
        };

        return {
          content: [
            {
              type: "text",
              text: `${String(feed.stories.length)} of ${String(feed.totalCount)} stories in feed (offset ${String(offset)}).`,
            },
          ],
          structuredContent: serialized,
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
