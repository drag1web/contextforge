export type ContextForgeMcpAuditEvent =
  | "server_started"
  | "tools_listed"
  | "tool_called"
  | "tool_succeeded"
  | "tool_failed"
  | "write_denied"
  | "task_pack_created";

export interface ContextForgeMcpAuditLogger {
  record(
    event: ContextForgeMcpAuditEvent,
    metadata?: Record<string, string | number | boolean | null>,
  ): void;
}

export function createStderrMcpAuditLogger(): ContextForgeMcpAuditLogger {
  return {
    record(event, metadata = {}) {
      process.stderr.write(
        `${JSON.stringify({
          scope: "contextforge-mcp",
          event,
          at: new Date().toISOString(),
          ...metadata,
        })}\n`,
      );
    },
  };
}

export const silentMcpAuditLogger: ContextForgeMcpAuditLogger = {
  record() {},
};

