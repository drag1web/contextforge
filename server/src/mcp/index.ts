import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ensureDatabaseSchema } from "../db/schema.js";
import { storage } from "../storage/index.js";
import { createContextForgeMcpServer } from "./createContextForgeMcpServer.js";
import { assertContextForgeMcpDatabaseAvailable } from "./mcpConfig.js";
import { ContextForgeMcpError } from "./mcpErrors.js";
import { readContextForgeMcpPermissions } from "./mcpPermissions.js";

async function main() {
  assertContextForgeMcpDatabaseAvailable();
  await ensureDatabaseSchema();
  const permissions = await readContextForgeMcpPermissions(storage);

  if (!permissions.enabled) {
    throw new ContextForgeMcpError(
      "MCP_SERVER_DISABLED",
      "ContextForge MCP is disabled in Integrations settings.",
    );
  }

  const { server, audit } = await createContextForgeMcpServer({ permissions });
  const transport = new StdioServerTransport();
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`ContextForge MCP received ${signal}; shutting down.\n`);
    await server.close();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await server.connect(transport);
  audit.record("server_started", {
    transport: "stdio",
    readOnly: !permissions.allowCreateTaskPacks,
  });
}

main().catch((error) => {
  const code =
    error instanceof ContextForgeMcpError ? error.code : "MCP_INTERNAL_ERROR";
  const message =
    error instanceof ContextForgeMcpError
      ? error.message
      : "ContextForge MCP failed to start.";
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
});

