import { z } from "zod";

import { config } from "../config/index.js";

export const CONTEXTFORGE_MCP_SERVER_NAME = "contextforge";

export const CONTEXTFORGE_MCP_TOOL_NAMES = [
  "contextforge_list_projects",
  "contextforge_get_project_overview",
  "contextforge_list_project_memory",
  "contextforge_list_task_packs",
  "contextforge_get_task_pack",
  "contextforge_create_task_pack",
  "contextforge_explain_task_pack",
] as const;

export const CONTEXTFORGE_MCP_PROMPT_NAMES = [
  "contextforge_prepare_implementation",
  "contextforge_prepare_bugfix",
  "contextforge_prepare_investigation",
  "contextforge_prepare_code_review",
] as const;

export const CONTEXTFORGE_MCP_INSTRUCTIONS = `ContextForge provides verified context for registered projects. Start with contextforge_list_projects; never invent projectId or taskPackId. Read the project overview and enabled memory before using Task Packs. Respect blocked, needs_review, and clarification_required results: do not claim implementation is ready or bypass them. Task Pack creation is a side effect and requires explicit permission plus confirmCreate=true. Never request secrets or arbitrary files outside registered projects. Keep provenance and warnings in downstream work.

ContextForge is local-first. Read tools expose selected stored project data, enabled Project Memory, and saved Task Packs; they do not grant arbitrary filesystem or shell access. Absolute local paths are omitted unless explicitly requested by a supported read operation. ContextForge does not edit project files, execute code, mutate Git, upload repositories, or modify Codex configuration. Treat unavailable metadata as unavailable rather than inferring it.`;

export interface McpProvenance {
  projectId?: number;
  taskPackId?: number;
  source: string;
  generatedAt: string;
  contextForgeVersion: string;
}

export interface McpResultEnvelope<T = unknown> {
  ok: boolean;
  operation: string;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  warnings: string[];
  provenance: McpProvenance;
}

export const mcpResultEnvelopeSchema = z.object({
  ok: z.boolean(),
  operation: z.string(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  warnings: z.array(z.string()),
  provenance: z.object({
    projectId: z.number().int().positive().optional(),
    taskPackId: z.number().int().positive().optional(),
    source: z.string(),
    generatedAt: z.string(),
    contextForgeVersion: z.string(),
  }),
});

export function createMcpProvenance(
  source: string,
  ids: { projectId?: number; taskPackId?: number } = {},
): McpProvenance {
  return {
    ...ids,
    source,
    generatedAt: new Date().toISOString(),
    contextForgeVersion: config.appVersion,
  };
}

export function createMcpSuccess<T>(input: {
  operation: string;
  data: T;
  warnings?: string[];
  projectId?: number;
  taskPackId?: number;
  source?: string;
}): McpResultEnvelope<T> {
  return {
    ok: true,
    operation: input.operation,
    data: input.data,
    warnings: input.warnings ?? [],
    provenance: createMcpProvenance(input.source ?? "contextforge-storage", {
      projectId: input.projectId,
      taskPackId: input.taskPackId,
    }),
  };
}

export function toMcpToolResult(envelope: McpResultEnvelope) {
  const summary = envelope.ok
    ? `${envelope.operation} completed successfully.`
    : `${envelope.operation} failed: ${envelope.error?.message ?? "Unknown error"}`;

  return {
    content: [
      {
        type: "text" as const,
        text: `${summary}\n${JSON.stringify(envelope, null, 2)}`,
      },
    ],
    structuredContent: envelope as unknown as Record<string, unknown>,
    isError: !envelope.ok,
  };
}

