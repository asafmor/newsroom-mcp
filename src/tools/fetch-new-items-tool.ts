import type { ToolRegistrar } from "./tool-registrar.js";

import type { IngestionService } from "../services/ingestion-service.js";
import type { StoryService } from "../services/story-service.js";
import { fetchNewItemsInputSchema, fetchNewItemsOutputSchema } from "./schemas.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerFetchNewItemsTool(
  server: ToolRegistrar,
  ingestion: IngestionService,
  storyService: StoryService,
) {
  return server.tool(
    {
      name: "fetch-new-items",
      description:
        "Fetch new content from every configured provider (RSS feeds, Hacker News) and store it, " +
        "then archive stories that have gone quiet for 30+ days. Performs no semantic AI decisions.",
      inputSchema: fetchNewItemsInputSchema,
      outputSchema: fetchNewItemsOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await ingestion.fetchNewItems();
        const storiesArchived = await storyService.archiveStaleStories();
        const failed = result.providers.filter((provider) => provider.status === "failed");
        const failedNote = failed.length
          ? ` Failed: ${failed.map((provider) => provider.providerId).join(", ")}.`
          : "";

        return {
          content: [
            {
              type: "text",
              text: `Processed ${String(result.providersProcessed)}/${String(result.providers.length)} providers, fetched ${String(result.itemsFetched)} items, inserted ${String(result.itemsInserted)} new (${String(result.duplicates)} duplicates), archived ${String(storiesArchived)} stale stories.${failedNote}`,
            },
          ],
          structuredContent: { ...result, storiesArchived },
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
