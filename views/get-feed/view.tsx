import type { ViewConfig } from "mcp-use/react";
import { useHostContext, useOpenExternal, useToolContext } from "mcp-use/react";

import { FeedApp } from "../../shared-ui/feed/FeedApp.js";
import "../../shared-ui/feed/feed.css";

export const viewConfig = {
  autoResize: true,
  displayModes: ["inline"],
} satisfies ViewConfig;

export default function GetFeedView() {
  const context = useToolContext<"get-feed">();
  const { locale } = useHostContext();
  const openExternal = useOpenExternal();

  return (
    <FeedApp
      variant="mcp"
      locale={locale}
      state={
        context.status === "error"
          ? { status: "error", message: context.error.message }
          : context.status === "pending"
            ? { status: "pending" }
            : { status: "success", generatedAt: context.toolOutput.generatedAt, stories: context.toolOutput.stories }
      }
      onOpenSource={(url) => {
        // Views run sandboxed and can't navigate the top window themselves —
        // target="_blank" is silently swallowed, so route through the host.
        void openExternal({ url }).catch(() => undefined);
      }}
    />
  );
}
