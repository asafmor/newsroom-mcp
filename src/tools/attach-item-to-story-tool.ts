import type { ToolRegistrar } from "./tool-registrar.js";

import type { StoryService } from "../services/story-service.js";
import { attachItemToStoryInputSchema, attachItemToStoryOutputSchema } from "./schemas.js";
import { serializeStory } from "./serialize.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerAttachItemToStoryTool(server: ToolRegistrar, storyService: StoryService) {
  return server.tool(
    {
      name: "attach-item-to-story",
      description:
        'Associate a content item with an existing story. Use contribution "meaningful-update" when the item introduces a new development (bumps story freshness); use "supporting" or "background" otherwise.',
      inputSchema: attachItemToStoryInputSchema,
      outputSchema: attachItemToStoryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const story = await storyService.attachItem(input);
        const serialized = serializeStory(story);

        return {
          content: [{ type: "text", text: `Attached item to story "${story.title}" (${story.id}).` }],
          structuredContent: serialized,
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
