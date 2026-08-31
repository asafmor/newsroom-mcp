import type { ToolRegistrar } from "./tool-registrar.js";

import type { ContentItemRepository } from "../repositories/content-item-repository.js";
import { getUnprocessedItemsInputSchema, getUnprocessedItemsOutputSchema } from "./schemas.js";
import { serializeContentItem } from "./serialize.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerGetUnprocessedItemsTool(server: ToolRegistrar, items: ContentItemRepository) {
  return server.tool(
    {
      name: "get-unprocessed-items",
      description:
        "Return content items awaiting AI evaluation (relevant? existing story? new story?), " +
        "oldest first. Items with a published_at older than 1 week are excluded.",
      inputSchema: getUnprocessedItemsInputSchema,
      outputSchema: getUnprocessedItemsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ limit }) => {
      try {
        const pending = await items.findPending(limit);
        const result = { items: pending.map(serializeContentItem) };

        return {
          content: [{ type: "text", text: `${String(pending.length)} unprocessed items.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
