import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { taskClarificationsSchema } from "../taskPacks/taskClarifications.js";
import type { ContextForgeMcpAuditLogger } from "./mcpAudit.js";
import {
  mcpResultEnvelopeSchema,
  toMcpToolResult,
} from "./mcpContracts.js";
import { toSafeMcpError } from "./mcpErrors.js";
import type { ContextForgeMcpServices } from "./mcpServices.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const createAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

function registerSafeTool<Args extends z.ZodRawShape>(
  server: McpServer,
  audit: ContextForgeMcpAuditLogger,
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: Args;
    annotations: typeof readOnlyAnnotations;
  },
  handler: (args: z.infer<z.ZodObject<Args>>) => Promise<unknown>,
) {
  server.registerTool(
    name,
    {
      ...config,
      outputSchema: mcpResultEnvelopeSchema,
    } as never,
    (async (args: unknown) => {
      audit.record("tool_called", { tool: name });
      try {
        const envelope = await handler(args as z.infer<z.ZodObject<Args>>);
        audit.record("tool_succeeded", { tool: name });
        return toMcpToolResult(envelope as never);
      } catch (error) {
        const envelope = toSafeMcpError(error, name);
        audit.record(
          envelope.error?.code === "MCP_WRITE_DISABLED"
            ? "write_denied"
            : "tool_failed",
          { tool: name, code: envelope.error?.code ?? "MCP_INTERNAL_ERROR" },
        );
        return toMcpToolResult(envelope);
      }
    }) as never,
  );
}

export function registerContextForgeTools(input: {
  server: McpServer;
  services: ContextForgeMcpServices;
  audit: ContextForgeMcpAuditLogger;
}) {
  const { server, services, audit } = input;

  registerSafeTool(
    server,
    audit,
    "contextforge_list_projects",
    {
      title: "List ContextForge projects",
      description:
        "List registered ContextForge projects without exposing local paths by default.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        query: z.string().trim().max(200).optional(),
        includeLocalPath: z.boolean().default(false),
      },
      annotations: readOnlyAnnotations,
    },
    (args) => services.listProjects(args),
  );

  registerSafeTool(
    server,
    audit,
    "contextforge_get_project_overview",
    {
      title: "Get ContextForge project overview",
      description:
        "Read stored project metadata, readiness, scanner summary, memory count, and Task Pack history.",
      inputSchema: {
        projectId: z.number().int().positive(),
        includeLocalPath: z.boolean().default(false),
        includeScripts: z.boolean().default(true),
        includeReadiness: z.boolean().default(true),
      },
      annotations: readOnlyAnnotations,
    },
    (args) => services.getProjectOverview(args),
  );

  registerSafeTool(
    server,
    audit,
    "contextforge_list_project_memory",
    {
      title: "List Project Memory",
      description:
        "List bounded Project Memory records. Disabled records remain hidden by default.",
      inputSchema: {
        projectId: z.number().int().positive(),
        enabledOnly: z.boolean().default(true),
        category: z
          .enum([
            "architecture",
            "do_not_change",
            "style",
            "verification",
            "workflow",
            "custom",
          ])
          .optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: readOnlyAnnotations,
    },
    (args) => services.listProjectMemory(args),
  );

  registerSafeTool(
    server,
    audit,
    "contextforge_list_task_packs",
    {
      title: "List Task Packs",
      description:
        "List Task Pack metadata and summaries without returning generated prompts.",
      inputSchema: {
        projectId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        taskType: z.string().trim().max(80).optional(),
        targetTool: z.string().trim().max(80).optional(),
      },
      annotations: readOnlyAnnotations,
    },
    (args) => services.listTaskPacks(args),
  );

  registerSafeTool(
    server,
    audit,
    "contextforge_get_task_pack",
    {
      title: "Get Task Pack",
      description:
        "Read one saved Task Pack with explicit prompt and diagnostics controls.",
      inputSchema: {
        taskPackId: z.number().int().positive(),
        includeGeneratedPrompt: z.boolean().default(true),
        includeDiagnostics: z.boolean().default(false),
        maxPromptChars: z.number().int().min(1_000).max(120_000).optional(),
      },
      annotations: readOnlyAnnotations,
    },
    (args) => services.getTaskPack(args),
  );

  registerSafeTool(
    server,
    audit,
    "contextforge_create_task_pack",
    {
      title: "Create Task Pack",
      description:
        "Run the existing ContextForge Task Pack pipeline. Requires write opt-in and confirmCreate=true; never edits project files.",
      inputSchema: {
        projectId: z.number().int().positive(),
        rawTask: z.string().trim().min(3).max(6_000),
        taskType: z.string().trim().min(1).default("general"),
        targetTool: z.string().trim().min(1).default("generic"),
        selectedFilePaths: z
          .array(z.string().trim().min(1).max(500))
          .max(48)
          .optional(),
        clarifications: taskClarificationsSchema.optional(),
        templateId: z.string().trim().min(1).max(180).optional(),
        ruleProfileId: z.string().trim().min(1).max(180).optional(),
        enabledRuleIds: z
          .array(z.string().trim().min(1).max(180))
          .max(80)
          .optional(),
        customRules: z
          .array(z.string().trim().min(1).max(700))
          .max(20)
          .optional(),
        acceptanceCriteriaPresetId: z
          .string()
          .trim()
          .min(1)
          .max(180)
          .optional(),
        acceptanceCriteria: z
          .array(z.string().trim().min(1).max(700))
          .max(30)
          .optional(),
        confirmCreate: z
          .boolean()
          .default(false)
          .describe("Must be the literal value true."),
      },
      annotations: createAnnotations,
    },
    async (args) => {
      const result = await services.createTaskPack(args as never);
      audit.record("task_pack_created", {
        projectId: args.projectId,
        taskPackId:
          (result.provenance as { taskPackId?: number }).taskPackId ?? null,
      });
      return result;
    },
  );

  registerSafeTool(
    server,
    audit,
    "contextforge_explain_task_pack",
    {
      title: "Explain Task Pack",
      description:
        "Explain stored Task Pack selection, quality, rules, and execution metadata without a new AI call.",
      inputSchema: {
        taskPackId: z.number().int().positive(),
      },
      annotations: readOnlyAnnotations,
    },
    (args) => services.explainTaskPack(args),
  );

  audit.record("tools_listed", { count: 7 });
}
