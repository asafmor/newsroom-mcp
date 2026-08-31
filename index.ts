import { MCPServer } from "mcp-use";

import { buildNewsroomServices, registerNewsroomTools } from "./src/composition.js";
import { logger } from "./src/logger.js";

const services = buildNewsroomServices();

const server = new MCPServer({
  name: "newsroom-mcp",
  title: "newsroom-mcp",
  version: "1.0.0",
  description: "A private AI news curation MCP server.",
});

const tools = registerNewsroomTools(server, services);

export const fetchNewItems = tools.fetchNewItems;
export const getUnprocessedItems = tools.getUnprocessedItems;
export const getActiveStories = tools.getActiveStories;
export const createStory = tools.createStory;
export const attachItemToStory = tools.attachItemToStory;
export const updateStory = tools.updateStory;
export const markItemProcessed = tools.markItemProcessed;
export const getFeed = tools.getFeed;

logger.info(
  { dbPath: services.config.dbPath, providers: services.providers.getAll().length },
  "newsroom-mcp ready",
);

export default server;
