import { loadConfig, type NewsroomConfig } from "./config.js";
import { buildProviderRegistry } from "./config/providers.js";
import { openDatabase } from "./sqlite/sqlite-database.js";
import { SqliteContentItemRepository } from "./sqlite/sqlite-content-item-repository.js";
import { SqliteProviderStateRepository } from "./sqlite/sqlite-provider-state-repository.js";
import { SqliteStoryRepository } from "./sqlite/sqlite-story-repository.js";
import type { ContentProviderRegistry } from "./providers/content-provider-registry.js";
import { FeedService } from "./services/feed-service.js";
import { IngestionService } from "./services/ingestion-service.js";
import { StoryService } from "./services/story-service.js";
import { registerAttachItemToStoryTool } from "./tools/attach-item-to-story-tool.js";
import { registerCreateStoryTool } from "./tools/create-story-tool.js";
import { registerFetchNewItemsTool } from "./tools/fetch-new-items-tool.js";
import { registerGetActiveStoriesTool } from "./tools/get-active-stories-tool.js";
import { registerGetFeedTool } from "./tools/get-feed-tool.js";
import { registerGetStoryTool } from "./tools/get-story-tool.js";
import { registerGetUnprocessedItemsTool } from "./tools/get-unprocessed-items-tool.js";
import { registerMarkItemProcessedTool } from "./tools/mark-item-processed-tool.js";
import { registerMergeStoriesTool } from "./tools/merge-stories-tool.js";
import { registerUpdateStoryTool } from "./tools/update-story-tool.js";
import type { ToolRegistrar } from "./tools/tool-registrar.js";

/**
 * Every repository/service the tools need, built once regardless of which
 * transport(s) end up serving them. Opens the SQLite database — construct
 * this exactly once per process.
 */
export interface NewsroomServices {
  config: NewsroomConfig;
  providers: ContentProviderRegistry;
  ingestionService: IngestionService;
  storyService: StoryService;
  feedService: FeedService;
  contentItems: SqliteContentItemRepository;
  stories: SqliteStoryRepository;
}

export function buildNewsroomServices(): NewsroomServices {
  const config = loadConfig();

  const db = openDatabase(config.dbPath);
  const contentItems = new SqliteContentItemRepository(db);
  const stories = new SqliteStoryRepository(db);
  const providerStates = new SqliteProviderStateRepository(db);

  const providers = buildProviderRegistry(config);

  return {
    config,
    providers,
    ingestionService: new IngestionService(providers, contentItems, providerStates),
    storyService: new StoryService(stories, contentItems),
    feedService: new FeedService(stories, providers),
    contentItems,
    stories,
  };
}

/**
 * Registers all 10 newsroom-mcp tools onto `registrar`. Transport-agnostic —
 * called once for the HTTP `MCPServer` (index.ts) and once per stdio
 * connection's `McpServer` instance (stdio.ts), against the same
 * already-built `services`.
 */
export function registerNewsroomTools(registrar: ToolRegistrar, services: NewsroomServices) {
  return {
    fetchNewItems: registerFetchNewItemsTool(registrar, services.ingestionService, services.storyService),
    getUnprocessedItems: registerGetUnprocessedItemsTool(registrar, services.contentItems),
    getActiveStories: registerGetActiveStoriesTool(registrar, services.stories, services.providers),
    getStory: registerGetStoryTool(registrar, services.stories, services.providers),
    createStory: registerCreateStoryTool(registrar, services.storyService),
    attachItemToStory: registerAttachItemToStoryTool(registrar, services.storyService),
    updateStory: registerUpdateStoryTool(registrar, services.storyService),
    mergeStories: registerMergeStoriesTool(registrar, services.storyService),
    markItemProcessed: registerMarkItemProcessedTool(registrar, services.contentItems),
    getFeed: registerGetFeedTool(registrar, services.feedService),
  };
}
