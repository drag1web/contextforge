import {
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpResultEnvelope } from "./mcpContracts.js";
import { toSafeMcpError } from "./mcpErrors.js";
import type { ContextForgeMcpServices } from "./mcpServices.js";

function resourceText(uri: URL, envelope: McpResultEnvelope) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: "application/json",
        text: JSON.stringify(envelope, null, 2),
      },
    ],
  };
}

function templateValue(value: string | string[] | undefined, name: string) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `MCP_INVALID_INPUT: ${name} must be a positive integer.`,
    );
  }
  return parsed;
}

async function safeResource(
  uri: URL,
  operation: string,
  handler: () => Promise<McpResultEnvelope>,
) {
  try {
    return resourceText(uri, await handler());
  } catch (error) {
    const envelope = toSafeMcpError(error, operation);
    if (
      envelope.error?.code === "MCP_PROJECT_NOT_FOUND" ||
      envelope.error?.code === "MCP_TASK_PACK_NOT_FOUND"
    ) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `${envelope.error.code}: ${envelope.error.message}`,
      );
    }
    return resourceText(uri, envelope);
  }
}

export function registerContextForgeResources(
  server: McpServer,
  services: ContextForgeMcpServices,
) {
  server.registerResource(
    "contextforge-projects",
    "contextforge://projects",
    {
      title: "ContextForge projects",
      description: "Bounded list of registered ContextForge projects.",
      mimeType: "application/json",
    },
    (uri) =>
      safeResource(uri, "contextforge_resource_projects", () =>
        services.listProjects({ limit: 100 }),
      ),
  );

  server.registerResource(
    "contextforge-project",
    new ResourceTemplate("contextforge://projects/{projectId}", {
      list: async () => {
        const result = await services.listProjects({ limit: 100 });
        const projects = (
          result.data as { projects?: Array<{ projectId: number; name: string }> }
        )?.projects;
        return {
          resources: (projects ?? []).map((project) => ({
            name: project.name,
            title: project.name,
            uri: `contextforge://projects/${project.projectId}`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "ContextForge project overview",
      description: "Stored overview for one registered project.",
      mimeType: "application/json",
    },
    (uri, variables) =>
      safeResource(uri, "contextforge_resource_project", () =>
        services.getProjectOverview({
          projectId: templateValue(variables.projectId, "projectId"),
        }),
      ),
  );

  server.registerResource(
    "contextforge-project-memory",
    new ResourceTemplate("contextforge://projects/{projectId}/memory", {
      list: undefined,
    }),
    {
      title: "ContextForge Project Memory",
      description: "Enabled Project Memory for one registered project.",
      mimeType: "application/json",
    },
    (uri, variables) =>
      safeResource(uri, "contextforge_resource_project_memory", () =>
        services.listProjectMemory({
          projectId: templateValue(variables.projectId, "projectId"),
          enabledOnly: true,
          limit: 100,
        }),
      ),
  );

  server.registerResource(
    "contextforge-project-task-packs",
    new ResourceTemplate("contextforge://projects/{projectId}/task-packs", {
      list: undefined,
    }),
    {
      title: "ContextForge project Task Packs",
      description: "Task Pack summaries for one registered project.",
      mimeType: "application/json",
    },
    (uri, variables) =>
      safeResource(uri, "contextforge_resource_project_task_packs", () =>
        services.listTaskPacks({
          projectId: templateValue(variables.projectId, "projectId"),
          limit: 100,
        }),
      ),
  );

  server.registerResource(
    "contextforge-task-pack",
    new ResourceTemplate("contextforge://task-packs/{taskPackId}", {
      list: async () => {
        const result = await services.listTaskPacks({ limit: 100 });
        const taskPacks = (
          result.data as {
            taskPacks?: Array<{ taskPackId: number; title: string }>;
          }
        )?.taskPacks;
        return {
          resources: (taskPacks ?? []).map((taskPack) => ({
            name: taskPack.title,
            title: taskPack.title,
            uri: `contextforge://task-packs/${taskPack.taskPackId}`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "ContextForge Task Pack",
      description: "One explicitly requested saved Task Pack.",
      mimeType: "application/json",
    },
    (uri, variables) =>
      safeResource(uri, "contextforge_resource_task_pack", () =>
        services.getTaskPack({
          taskPackId: templateValue(variables.taskPackId, "taskPackId"),
          includeGeneratedPrompt: true,
          includeDiagnostics: false,
        }),
      ),
  );
}

