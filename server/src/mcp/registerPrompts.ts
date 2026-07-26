import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const workflowPromptSchema = {
  projectId: z.string().trim().regex(/^\d+$/, "projectId must be a positive integer"),
  task: z.string().trim().min(3).max(6_000),
};

const workflowDefinitions = [
  {
    name: "contextforge_prepare_implementation",
    title: "Prepare implementation with ContextForge",
    taskType: "implementation",
  },
  {
    name: "contextforge_prepare_bugfix",
    title: "Prepare bugfix with ContextForge",
    taskType: "bugfix",
  },
  {
    name: "contextforge_prepare_investigation",
    title: "Prepare investigation with ContextForge",
    taskType: "investigation",
  },
  {
    name: "contextforge_prepare_code_review",
    title: "Prepare code review with ContextForge",
    taskType: "code review",
  },
] as const;

export function registerContextForgePrompts(server: McpServer) {
  for (const definition of workflowDefinitions) {
    server.registerPrompt(
      definition.name,
      {
        title: definition.title,
        description: `Prepare a safe ${definition.taskType} workflow using verified ContextForge context.`,
        argsSchema: workflowPromptSchema,
      },
      ({ projectId, task }) => ({
        description: definition.title,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Prepare this ${definition.taskType} task for ContextForge project ${projectId}:`,
                task,
                "",
                "Workflow:",
                `1. Call contextforge_get_project_overview with projectId=${projectId}.`,
                "2. Read enabled Project Memory with contextforge_list_project_memory.",
                "3. Look for a suitable saved Task Pack; create one only if write permission is enabled and the user explicitly confirms.",
                "4. Stop and ask for the required decision if ContextForge returns clarification_required.",
                "5. Do not edit code when selection is blocked, needs_review is unresolved, or safe authorization is absent.",
                "6. Preserve ContextForge provenance and warnings; do not invent missing metadata.",
              ].join("\n"),
            },
          },
        ],
      }),
    );
  }
}
