import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { config } from "../config/index.js";
import { storage as defaultStorage } from "../storage/index.js";
import type { StorageAdapter } from "../storage/types.js";
import {
  createStderrMcpAuditLogger,
  type ContextForgeMcpAuditLogger,
} from "./mcpAudit.js";
import {
  CONTEXTFORGE_MCP_INSTRUCTIONS,
  CONTEXTFORGE_MCP_SERVER_NAME,
} from "./mcpContracts.js";
import type { ContextForgeMcpPermissions } from "./mcpPermissions.js";
import { readContextForgeMcpPermissions } from "./mcpPermissions.js";
import {
  ContextForgeMcpServices,
  type TaskPackCreator,
} from "./mcpServices.js";
import { registerContextForgePrompts } from "./registerPrompts.js";
import { registerContextForgeResources } from "./registerResources.js";
import { registerContextForgeTools } from "./registerTools.js";

export interface CreateContextForgeMcpServerOptions {
  storage?: StorageAdapter;
  permissions?: ContextForgeMcpPermissions;
  audit?: ContextForgeMcpAuditLogger;
  taskPackCreator?: TaskPackCreator;
}

export async function createContextForgeMcpServer(
  options: CreateContextForgeMcpServerOptions = {},
) {
  const storage = options.storage ?? defaultStorage;
  const permissions =
    options.permissions ?? (await readContextForgeMcpPermissions(storage));
  const audit = options.audit ?? createStderrMcpAuditLogger();
  const server = new McpServer(
    {
      name: CONTEXTFORGE_MCP_SERVER_NAME,
      version: config.appVersion,
    },
    {
      instructions: CONTEXTFORGE_MCP_INSTRUCTIONS,
      capabilities: {
        logging: {},
      },
    },
  );
  const services = new ContextForgeMcpServices(
    storage,
    permissions,
    options.taskPackCreator,
  );

  registerContextForgeTools({ server, services, audit });
  registerContextForgeResources(server, services);
  registerContextForgePrompts(server);

  return {
    server,
    services,
    permissions,
    audit,
  };
}

