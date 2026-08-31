#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { buildNewsroomServices, registerNewsroomTools } from "./src/composition.js";
import { logger } from "./src/logger.js";
import { StdioToolRegistrar } from "./src/tools/stdio-tool-registrar.js";

// An MCP client spawns this process with its own cwd, not necessarily this
// repo's root — but .env and the default (relative) NEWSROOM_DB_PATH are
// both resolved against cwd. Anchor to this file's directory so stdio mode
// behaves the same regardless of where the client launches it from.
process.chdir(import.meta.dirname);

// Services (SQLite connection, provider registry) are built once per process
// — stdio clients spawn/kill this process per session, so there's exactly
// one connection to serve, but `serveStdio`'s factory may still be invoked
// more than once during era negotiation. Keep the expensive, side-effecting
// setup (opening the DB) outside the factory; only tool registration runs
// per McpServer instance the factory produces.
const services = buildNewsroomServices();

logger.info(
  { dbPath: services.config.dbPath, providers: services.providers.getAll().length },
  "newsroom-mcp ready (stdio)",
);

serveStdio(() => {
  const mcpServer = new McpServer({ name: "newsroom-mcp", version: "1.0.0" });
  registerNewsroomTools(new StdioToolRegistrar(mcpServer), services);
  return mcpServer;
});
