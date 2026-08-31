export function toolErrorResult(error: unknown): {
  isError: true;
  content: { type: "text"; text: string }[];
} {
  return {
    isError: true,
    content: [{ type: "text", text: errorMessage(error) }],
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected newsroom-mcp failure";
}
