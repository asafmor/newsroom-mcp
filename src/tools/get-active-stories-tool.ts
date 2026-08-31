import type { ToolRegistrar } from "./tool-registrar.js";

import type { ContentProviderRegistry } from "../providers/content-provider-registry.js";
import type { StoryRepository } from "../repositories/story-repository.js";
import { getActiveStoriesInputSchema, getActiveStoriesOutputSchema } from "./schemas.js";
import { serializeStory } from "./serialize.js";
import { toolErrorResult } from "./tool-errors.js";

const RECENT_ITEMS_LIMIT = 5;

export function registerGetActiveStoriesTool(
  server: ToolRegistrar,
  stories: StoryRepository,
  providers: ContentProviderRegistry,
) {
  return server.tool(
    {
      name: "get-active-stories",
      description:
        "Return active stories the AI agent can cluster new content into, each with its recent attached items and source names.",
      inputSchema: getActiveStoriesInputSchema,
      outputSchema: getActiveStoriesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ limit, offset }) => {
      try {
        const [active, totalCount] = await Promise.all([
          stories.findActive({ limit, offset }),
          stories.countActive(),
        ]);
        const enriched = await Promise.all(
          active.map(async (story) => {
            const attached = await stories.findAttachedContent(story.id);
            const sourceNames = [...new Set(attached.map((item) => providerName(providers, item.providerId)))];
            const recentItems = attached.slice(-RECENT_ITEMS_LIMIT).map((item) => ({
              contentItemId: item.contentItemId,
              providerName: providerName(providers, item.providerId),
              title: item.title,
              url: item.url,
              publishedAt: item.publishedAt.toISOString(),
              contribution: item.contribution,
            }));

            return { ...serializeStory(story), sourceNames, recentItems };
          }),
        );

        const hasMore = offset + enriched.length < totalCount;
        return {
          content: [
            {
              type: "text",
              text: `${String(enriched.length)} of ${String(totalCount)} active stories (offset ${String(offset)}).`,
            },
          ],
          structuredContent: { stories: enriched, totalCount, hasMore },
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}

function providerName(providers: ContentProviderRegistry, providerId: string): string {
  return providers.get(providerId)?.name ?? providerId;
}
