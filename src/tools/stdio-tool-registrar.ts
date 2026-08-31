import type { McpServer } from "@modelcontextprotocol/server";
import type { InferToolInput, InferToolOutput, ToolCallback, ToolDefinition } from "mcp-use";

import type { ToolRegistrar } from "./tool-registrar.js";

/**
 * Adapts the raw SDK's `McpServer.registerTool(name, config, callback)`
 * (three args, name separate, two incompatible overloads) to mcp-use's
 * `.tool(definition, callback)` shape (two args, name embedded) so every
 * `registerXTool` function works unchanged against a stdio-connected server,
 * not just the HTTP one.
 */
export class StdioToolRegistrar implements ToolRegistrar {
  constructor(private readonly mcpServer: McpServer) {}

  tool<const T extends ToolDefinition>(
    definition: T,
    callback: ToolCallback<InferToolInput<T>, InferToolOutput<T>>,
  ): unknown {
    const { name, ...config } = definition;

    // `registerTool`'s two overloads (StandardSchemaWithJSON vs. legacy
    // ZodRawShape) and its `ServerContext` type don't structurally match
    // mcp-use's generic-inference types; the actual runtime shape —
    // (input, ctx) => { content, structuredContent } over the same zod
    // schemas — matches, so this cast is contained to this one adapter.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- property access resolves to the deprecated legacy overload's type, but the runtime call always hits the modern StandardSchemaWithJSON overload.
    const registerTool = this.mcpServer.registerTool.bind(this.mcpServer) as unknown as (
      name: string,
      config: Omit<T, "name">,
      callback: ToolCallback<InferToolInput<T>, InferToolOutput<T>>,
    ) => unknown;

    return registerTool(name, config, callback);
  }
}
