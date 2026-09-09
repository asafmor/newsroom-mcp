import type { ToolRegistrar } from "./tool-registrar.js";

import type { PodcastService } from "../services/podcast-service.js";
import { serializePodcastEpisode } from "./serialize.js";
import { submitPodcastEpisodeInputSchema, submitPodcastEpisodeOutputSchema } from "./schemas.js";
import { toolErrorResult } from "./tool-errors.js";

export function registerSubmitPodcastEpisodeTool(server: ToolRegistrar, podcastService: PodcastService) {
  return server.tool(
    {
      name: "submit-podcast-episode",
      description:
        "Submit this week's podcast episode script — a title and an ordered array of spoken-style transcript " +
        "segments — for the CURRENT ISO week. Exactly one episode is allowed per ISO week: a second submission " +
        "for a week that already has one is rejected with the existing episode's id. The script is IMMUTABLE " +
        "once submitted — there is no edit/delete tool. On success the episode is persisted with audio state " +
        "'pending'; a separate, fully mechanical pipeline turns it into real audio later.",
      inputSchema: submitPodcastEpisodeInputSchema,
      outputSchema: submitPodcastEpisodeOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const episode = await podcastService.submitEpisode(new Date(), input);

        return {
          content: [
            {
              type: "text",
              text:
                `Submitted episode "${episode.title}" (${episode.id}) for ${episode.isoWeek}: ` +
                `${String(episode.segments.length)} segments, ${String(episode.totalCharacterCount)} characters. ` +
                "Audio state: pending.",
            },
          ],
          structuredContent: serializePodcastEpisode(episode),
        };
      } catch (error) {
        // PodcastWeekConflictError's message already identifies the
        // existing episode's id/ISO week (B.15) — no special-casing needed,
        // toolErrorResult surfaces it exactly as a clear, non-crashing error.
        return toolErrorResult(error);
      }
    },
  );
}
