import type { ToolRegistrar } from "./tool-registrar.js";

import type { StoryService } from "../services/story-service.js";
import { createStoryInputSchema, createStoryOutputSchema } from "./schemas.js";
import { serializeStory } from "./serialize.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerCreateStoryTool(server: ToolRegistrar, storyService: StoryService) {
  return server.tool(
    {
      name: "create-story",
      description: "Create a new curated story from one or more content items that don't belong to an existing story.",
      inputSchema: createStoryInputSchema,
      outputSchema: createStoryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const story = await storyService.createStory(input);
        const serialized = serializeStory(story);

        return {
          content: [{ type: "text", text: `Created story "${story.title}" (${story.id}).` }],
          structuredContent: serialized,
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
