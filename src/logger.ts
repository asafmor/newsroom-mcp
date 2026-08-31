import pino from "pino";

export const logger = pino({
  name: "newsroom-mcp",
  serializers: {
    err: pino.stdSerializers.err,
  },
});
