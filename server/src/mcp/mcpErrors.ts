import type { McpResultEnvelope } from "./mcpContracts.js";
import { createMcpProvenance } from "./mcpContracts.js";

export type ContextForgeMcpErrorCode =
  | "MCP_PROJECT_NOT_FOUND"
  | "MCP_TASK_PACK_NOT_FOUND"
  | "MCP_INVALID_INPUT"
  | "MCP_WRITE_DISABLED"
  | "MCP_CONFIRMATION_REQUIRED"
  | "MCP_CONTEXT_SELECTION_BLOCKED"
  | "MCP_CLARIFICATION_REQUIRED"
  | "MCP_STORAGE_UNAVAILABLE"
  | "MCP_SERVER_DISABLED"
  | "MCP_INTERNAL_ERROR";

export class ContextForgeMcpError extends Error {
  constructor(
    readonly code: ContextForgeMcpErrorCode,
    message: string,
    readonly ids: { projectId?: number; taskPackId?: number } = {},
  ) {
    super(message);
    this.name = "ContextForgeMcpError";
  }
}

export function toSafeMcpError(
  error: unknown,
  operation: string,
): McpResultEnvelope {
  const safeError =
    error instanceof ContextForgeMcpError
      ? error
      : new ContextForgeMcpError(
          "MCP_INTERNAL_ERROR",
          "ContextForge could not complete the MCP operation.",
        );

  return {
    ok: false,
    operation,
    error: {
      code: safeError.code,
      message: safeError.message,
    },
    warnings: [],
    provenance: createMcpProvenance("contextforge-mcp", safeError.ids),
  };
}
