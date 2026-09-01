import type {
  InferToolInput,
  InferToolName,
  InferToolOutput,
  ToolCallback,
  ToolDefinition,
  ToolRef,
} from "mcp-use";

/**
 * The one method every `registerXTool` function needs from its host server.
 * Structurally identical to `MCPServer.tool()` (mcp-use, HTTP transport), so
 * a real `MCPServer` instance satisfies this interface as-is. The stdio
 * entrypoint (`stdio.ts`) implements it as a thin adapter over the raw SDK's
 * `McpServer.registerTool()`, so every tool file works unchanged on both
 * transports. The `ToolRef` return type (rather than `unknown`) is what lets
 * `mcp-env.d.ts`'s `Register.tools` map `index.ts`'s exports to typed view
 * hooks (`useToolContext<"get-feed">()`).
 */
export interface ToolRegistrar {
  tool<const T extends ToolDefinition>(
    definition: T,
    callback: ToolCallback<InferToolInput<T>, InferToolOutput<T>>,
  ): ToolRef<InferToolName<T>, InferToolInput<T>, InferToolOutput<T>>;
}
