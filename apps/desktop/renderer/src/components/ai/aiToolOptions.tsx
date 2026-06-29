import type { SelectOption } from "../ui/CustomSelect";
import { AiToolLogo } from "./AiToolLogo";

export type AiToolTarget = "codex" | "cursor" | "claude" | "generic";

export function getAiToolLabel(tool: string) {
  const normalized = String(tool || "").toLowerCase();

  if (normalized === "codex") {
    return "Codex";
  }

  if (normalized === "cursor") {
    return "Cursor";
  }

  if (normalized === "claude") {
    return "Claude";
  }

  if (normalized === "generic") {
    return "Generic";
  }

  return tool;
}

export function getAiToolDescription(tool: string) {
  const normalized = String(tool || "").toLowerCase();

  if (normalized === "codex") {
    return "OpenAI coding agent";
  }

  if (normalized === "cursor") {
    return "IDE coding agent";
  }

  if (normalized === "claude") {
    return "Anthropic reasoning agent";
  }

  if (normalized === "generic") {
    return "Universal AI agent";
  }

  return "Target coding agent";
}

export const TARGET_TOOL_OPTIONS: SelectOption<AiToolTarget>[] = [
  {
    value: "codex",
    label: "Codex",
    description: "OpenAI coding agent",
    icon: <AiToolLogo tool="codex" />
  },
  {
    value: "cursor",
    label: "Cursor",
    description: "IDE coding agent",
    icon: <AiToolLogo tool="cursor" />
  },
  {
    value: "claude",
    label: "Claude",
    description: "Anthropic reasoning agent",
    icon: <AiToolLogo tool="claude" />
  },
  {
    value: "generic",
    label: "Generic",
    description: "Universal AI agent",
    icon: <AiToolLogo tool="generic" />
  }
];

export function makeAiToolSelectOption(tool: string): SelectOption<string> {
  return {
    value: tool,
    label: getAiToolLabel(tool),
    description: getAiToolDescription(tool),
    icon: <AiToolLogo tool={tool} />
  };
}