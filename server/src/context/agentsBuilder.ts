type AgentsProjectMemory = {
  title: string;
  content: string;
  category: "architecture" | "do_not_change" | "style" | "verification" | "workflow" | "custom";
  isEnabled?: boolean;
};

interface BuildAgentsInput {
  name: string;
  localPath: string;
  packageManager: string | null;
  detectedStack: string[];
  scripts: Record<string, string>;
  readinessReport: {
    score: number;
    checks: {
      key: string;
      label: string;
      passed: boolean;
      points: number;
      message: string;
    }[];
    issues: string[];
  };
  projectMemories?: AgentsProjectMemory[];
}

function formatScripts(scripts: Record<string, string>) {
  const entries = Object.entries(scripts);

  if (entries.length === 0) {
    return "No package scripts detected.";
  }

  return entries
    .map(([name, command]) => `- \`${name}\`: \`${command}\``)
    .join("\n");
}

function formatStack(stack: string[]) {
  if (stack.length === 0) {
    return "- Unknown";
  }

  return stack.map((item) => `- ${item}`).join("\n");
}

function formatIssues(issues: string[]) {
  if (issues.length === 0) {
    return "- No major AI-readiness issues detected.";
  }

  return issues.map((issue) => `- ${issue}`).join("\n");
}

function formatMemoryCategory(category: AgentsProjectMemory["category"]) {
  const labels: Record<AgentsProjectMemory["category"], string> = {
    architecture: "Architecture",
    do_not_change: "Do not change",
    style: "Style",
    verification: "Verification",
    workflow: "Workflow",
    custom: "Custom"
  };

  return labels[category] ?? "Custom";
}

function getActiveProjectMemories(project: BuildAgentsInput) {
  return (project.projectMemories ?? []).filter((memory) => memory.isEnabled !== false);
}

function formatProjectMemories(memories: AgentsProjectMemory[]) {
  if (memories.length === 0) {
    return "";
  }

  return memories
    .map((memory) => [
      `- [${formatMemoryCategory(memory.category)}] ${memory.title}`,
      `  - ${memory.content}`
    ].join("\n"))
    .join("\n");
}

function buildProjectMemorySection(memories: AgentsProjectMemory[]) {
  if (memories.length === 0) {
    return "";
  }

  return `## Project Memory / Decision Log

Persistent project decisions saved in ContextForge. Treat these as stable project rules unless the user explicitly overrides them in the current task.

${formatProjectMemories(memories)}

---

`;
}

export function ensureAgentsProjectMemorySection(
  markdown: string,
  memories: AgentsProjectMemory[] = []
) {
  const activeMemories = memories.filter((memory) => memory.isEnabled !== false);

  if (activeMemories.length === 0) {
    return markdown;
  }

  const memorySection = buildProjectMemorySection(activeMemories).trim();
  const sectionPattern = /\n## Project Memory \/ Decision Log\n[\s\S]*?(?=\n## |$)/;
  const replacement = `\n${memorySection}\n`;

  if (sectionPattern.test(markdown)) {
    return markdown.replace(sectionPattern, replacement);
  }

  const beforeReadiness = "\n## AI Readiness Issues";

  if (markdown.includes(beforeReadiness)) {
    return markdown.replace(beforeReadiness, `${replacement}${beforeReadiness}`);
  }

  const beforeOutput = "\n## Output Expectations";

  if (markdown.includes(beforeOutput)) {
    return markdown.replace(beforeOutput, `${replacement}${beforeOutput}`);
  }

  return `${markdown.trim()}\n\n${memorySection}\n`;
}

export function buildAgentsMarkdown(project: BuildAgentsInput) {
  const hasBuild = Boolean(project.scripts.build);
  const hasDev = Boolean(project.scripts.dev);
  const hasTest = Boolean(project.scripts.test);
  const activeProjectMemories = getActiveProjectMemories(project);

  return `# AGENTS.md

This file contains project-specific instructions for AI coding agents working with **${project.name}**.

## Project Overview

Project name: **${project.name}**

Local path:

\`\`\`text
${project.localPath}
\`\`\`

Detected stack:

${formatStack(project.detectedStack)}

Package manager: **${project.packageManager ?? "unknown"}**

AI readiness score: **${project.readinessReport.score}/100**

---

## Available Commands

${formatScripts(project.scripts)}

---

## Recommended Workflow for AI Agents

Before making changes:

1. Inspect the project structure.
2. Read this file fully.
3. Identify the smallest set of files required for the task.
4. Avoid rewriting unrelated parts of the project.
5. Preserve the existing architecture and naming style.
6. Explain any risky change before applying it.

After making changes:

1. Run the relevant verification commands.
2. Check that existing behavior is preserved.
3. Summarize changed files and reasoning.
4. Mention any command that could not be executed.

---

## Verification Commands

${hasBuild ? `- Build: \`${project.packageManager ?? "npm"} run build\`` : "- Build command is not detected."}
${hasDev ? `- Development: \`${project.packageManager ?? "npm"} run dev\`` : "- Dev command is not detected."}
${hasTest ? `- Tests: \`${project.packageManager ?? "npm"} test\`` : "- Test command is not detected."}

---

## Project Rules

AI agents must follow these rules:

- Do not rewrite the whole project unless explicitly requested.
- Do not change the technology stack without approval.
- Do not remove existing features while implementing a new task.
- Do not change environment variable names without updating documentation.
- Do not introduce large dependencies without explaining why they are needed.
- Do not modify generated or build output files.
- Keep changes focused, small, and reviewable.
- Prefer clear code over clever code.
- Preserve existing UI/UX direction unless the task is specifically about redesign.
- If the task is ambiguous, ask for clarification or make the smallest safe assumption.

---

${buildProjectMemorySection(activeProjectMemories)}## AI Readiness Issues

${formatIssues(project.readinessReport.issues)}

---

## Output Expectations

When finishing a task, the AI agent should respond with:

1. Short summary of what changed.
2. List of changed files.
3. Verification commands that were run.
4. Known limitations or follow-up recommendations.

---

Generated by **ContextForge**.
`;
}