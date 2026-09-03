import type { ToolRegistrar } from "./tool-registrar.js";

import type { ContentProviderRegistry } from "../providers/content-provider-registry.js";
import type { StoryRepository } from "../repositories/story-repository.js";
import { getStoryInputSchema, getStoryOutputSchema } from "./schemas.js";
import { serializeStory } from "./serialize.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerGetStoryTool(
  server: ToolRegistrar,
  stories: StoryRepository,
  providers: ContentProviderRegistry,
) {
  return server.tool(
    {
      name: "get-story",
      description:
        "Fetch one story by id with its complete attached-item history (oldest first), regardless of status or history length.",
      inputSchema: getStoryInputSchema,
      outputSchema: getStoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ storyId }) => {
      try {
        const story = await stories.findById(storyId);

        if (!story) {
          throw new Error(`Story not found: ${storyId}`);
        }

        const attached = await stories.findAttachedContent(storyId);
        const attachedItems = attached.map((item) => ({
          contentItemId: item.contentItemId,
          providerName: providers.get(item.providerId)?.name ?? item.providerId,
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt.toISOString(),
          contribution: item.contribution,
          attachedAt: item.attachedAt.toISOString(),
          ...(item.reason !== undefined ? { reason: item.reason } : {}),
        }));

        return {
          content: [
            {
              type: "text",
              text: `Story "${story.title}" (${story.status}) with ${String(attachedItems.length)} attached item(s).`,
            },
          ],
          structuredContent: { ...serializeStory(story), attachedItems },
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
