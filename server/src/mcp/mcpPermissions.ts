import type { StorageAdapter } from "../storage/types.js";

export interface ContextForgeMcpPermissions {
  enabled: boolean;
  readProjects: true;
  readProjectMemory: true;
  readTaskPacks: true;
  allowCreateTaskPacks: boolean;
}

function parseBoolean(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export async function readContextForgeMcpPermissions(
  storage: StorageAdapter,
): Promise<ContextForgeMcpPermissions> {
  const storedEnabled = await storage.getSettingValue("mcp_enabled", true);
  const storedCreatePermission = await storage.getSettingValue(
    "mcp_allow_create_task_packs",
    false,
  );

  return {
    enabled:
      parseBoolean(process.env.CONTEXTFORGE_MCP_ENABLED) ??
      Boolean(storedEnabled),
    readProjects: true,
    readProjectMemory: true,
    readTaskPacks: true,
    allowCreateTaskPacks:
      parseBoolean(process.env.CONTEXTFORGE_MCP_ALLOW_CREATE_TASK_PACKS) ??
      Boolean(storedCreatePermission),
  };
}

export async function updateContextForgeMcpPermissions(
  storage: StorageAdapter,
  input: { enabled?: boolean; allowCreateTaskPacks?: boolean },
) {
  if (input.enabled !== undefined) {
    await storage.setSettingValue("mcp_enabled", input.enabled);
  }

  if (input.allowCreateTaskPacks !== undefined) {
    await storage.setSettingValue(
      "mcp_allow_create_task_packs",
      input.allowCreateTaskPacks,
    );
  }

  return readContextForgeMcpPermissions(storage);
}

