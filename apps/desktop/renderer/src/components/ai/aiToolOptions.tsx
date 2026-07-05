import type { SelectOption } from "../ui/CustomSelect";
import { AiToolLogo } from "./AiToolLogo";

export type AiToolTarget = "codex" | "cursor" | "claude" | "gemini" | "generic";

export function getAiToolLabel(tool: string) {
  const normalized = String(tool || "").toLowerCase();

  if (normalized === "codex") {
    return "Codex";
  }

  if (normalized === "cursor") {
    return "Cursor";
  }

  if (normalized === "claude") {
    return "Claude Code";
  }

  if (normalized === "gemini") {
    return "Gemini";
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
    return "Anthropic CLI coding agent";
  }

  if (normalized === "gemini") {
    return "Google AI coding agent";
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
    icon: <AiToolLogo tool="codex" />,
    activeIcon: <AiToolLogo tool="codex" contrast="onLight" />
  },
  {
    value: "cursor",
    label: "Cursor",
    description: "IDE coding agent",
    icon: <AiToolLogo tool="cursor" />,
    activeIcon: <AiToolLogo tool="cursor" contrast="onLight" />
  },
  {
    value: "claude",
    label: "Claude Code",
    description: "Anthropic CLI coding agent",
    icon: <AiToolLogo tool="claude" />,
    activeIcon: <AiToolLogo tool="claude" contrast="onLight" />
  },
  {
    value: "gemini",
    label: "Gemini",
    description: "Google AI coding agent",
    icon: <AiToolLogo tool="gemini" />,
    activeIcon: <AiToolLogo tool="gemini" contrast="onLight" />
  },
  {
    value: "generic",
    label: "Generic",
    description: "Universal AI agent",
    icon: <AiToolLogo tool="generic" />,
    activeIcon: <AiToolLogo tool="generic" contrast="onLight" />
  }
];

export function makeAiToolSelectOption(tool: string): SelectOption<string> {
  return {
    value: tool,
    label: getAiToolLabel(tool),
    description: getAiToolDescription(tool),
    icon: <AiToolLogo tool={tool} />,
    activeIcon: <AiToolLogo tool={tool} contrast="onLight" />
  };
}
