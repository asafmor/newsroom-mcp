import type { ToolRegistrar } from "./tool-registrar.js";

import type { StoryService } from "../services/story-service.js";
import { updateStoryInputSchema, updateStoryOutputSchema } from "./schemas.js";
import { serializeStory } from "./serialize.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerUpdateStoryTool(server: ToolRegistrar, storyService: StoryService) {
  return server.tool(
    {
      name: "update-story",
      description:
        "Update the AI-maintained interpretation of a story (title, summary, scores, topic tags) after new information arrives. Omitted fields are left unchanged; a supplied 'tags' array replaces the story's tags entirely.",
      inputSchema: updateStoryInputSchema,
      outputSchema: updateStoryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ storyId, ...patch }) => {
      try {
        const story = await storyService.updateStory(storyId, patch);
        const serialized = serializeStory(story);

        return {
          content: [{ type: "text", text: `Updated story "${story.title}" (${story.id}).` }],
          structuredContent: serialized,
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
