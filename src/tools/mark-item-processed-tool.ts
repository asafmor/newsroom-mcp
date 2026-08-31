import type { ToolRegistrar } from "./tool-registrar.js";

import type { ContentItemRepository } from "../repositories/content-item-repository.js";
import { markItemProcessedInputSchema, markItemProcessedOutputSchema } from "./schemas.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerMarkItemProcessedTool(server: ToolRegistrar, items: ContentItemRepository) {
  return server.tool(
    {
      name: "mark-item-processed",
      description:
        'Finalize a content item that should not be linked to a story (status "ignored"), or mark it "linked" without attaching it to a story tool call. Prevents the same item from being reconsidered on the next poll.',
      inputSchema: markItemProcessedInputSchema,
      outputSchema: markItemProcessedOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ contentItemId, status }) => {
      try {
        const item = await items.findById(contentItemId);

        if (!item) {
          throw new Error(`Content item not found: ${contentItemId}`);
        }

        if (status === "ignored") {
          await items.markIgnored(contentItemId);
        } else {
          await items.markLinked(contentItemId);
        }

        const result = { contentItemId, status };

        return {
          content: [{ type: "text", text: `Marked item ${contentItemId} as ${status}.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
