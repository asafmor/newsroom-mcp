import type { ToolRegistrar } from "./tool-registrar.js";

import type { PodcastService } from "../services/podcast-service.js";
import { getPodcastStatusInputSchema, getPodcastStatusOutputSchema } from "./schemas.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerGetPodcastStatusTool(server: ToolRegistrar, podcastService: PodcastService) {
  return server.tool(
    {
      name: "get-podcast-status",
      description:
        "Report the weekly podcast digest's status: the current ISO week identifier, whether an episode " +
        "already exists for it, whether one is due (advisory only — see submit-podcast-episode), and " +
        "metadata-only summaries of the most recent episodes (id, ISO week, title, audio state, submitted-at — " +
        "never the transcript). Call this once per curation run alongside the get-feed confirmation step.",
      inputSchema: getPodcastStatusInputSchema,
      outputSchema: getPodcastStatusOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const status = await podcastService.getStatus(new Date(), input.limit);
        const serialized = {
          ...status,
          recentEpisodes: status.recentEpisodes.map((episode) => ({
            ...episode,
            submittedAt: episode.submittedAt.toISOString(),
          })),
        };

        const note = status.due
          ? " An episode is due for this week."
          : status.episodeExists
            ? " This week's episode already exists."
            : "";

        return {
          content: [{ type: "text", text: `Current ISO week: ${status.currentIsoWeek}.${note}` }],
          structuredContent: serialized,
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
