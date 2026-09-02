import type { ToolRegistrar } from "./tool-registrar.js";

import type { StoryService } from "../services/story-service.js";
import { mergeStoriesInputSchema, mergeStoriesOutputSchema } from "./schemas.js";
import { serializeStory } from "./serialize.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerMergeStoriesTool(server: ToolRegistrar, storyService: StoryService) {
  return server.tool(
    {
      name: "merge-stories",
      description:
        "Merge two active stories that represent the same real-world event into one. Reassigns every content item from the losing story onto the surviving story, reconciles the surviving story's timestamps, and archives the losing story. Does not rewrite title/summary/scores — use update-story for that.",
      inputSchema: mergeStoriesInputSchema,
      outputSchema: mergeStoriesOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ survivingStoryId, losingStoryId }) => {
      try {
        const story = await storyService.mergeStories(survivingStoryId, losingStoryId);
        const serialized = serializeStory(story);

        return {
          content: [
            { type: "text", text: `Merged story ${losingStoryId} into "${story.title}" (${story.id}).` },
          ],
          structuredContent: serialized,
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
