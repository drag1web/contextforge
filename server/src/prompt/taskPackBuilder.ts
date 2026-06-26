interface BuildTaskPackInput {
  project: {
    name: string;
    localPath: string;
    packageManager: string | null;
    detectedStack: string[];
    scripts: Record<string, string>;
    readinessScore: number;
    readinessReport: {
      issues: string[];
    };
  };
  rawTask: string;
  targetTool: string;
  taskType: string;
}

function formatStack(stack: string[]) {
  if (stack.length === 0) {
    return "- Unknown";
  }

  return stack.map((item) => `- ${item}`).join("\n");
}

function formatScripts(scripts: Record<string, string>) {
  const entries = Object.entries(scripts);

  if (entries.length === 0) {
    return "- No scripts detected.";
  }

  return entries.map(([name, command]) => `- ${name}: \`${command}\``).join("\n");
}

function getTargetInstruction(targetTool: string) {
  switch (targetTool) {
    case "codex":
      return "Write a clear implementation plan first, then make minimal focused changes. Prefer small, reviewable edits.";
    case "cursor":
      return "Focus on the relevant files. Avoid broad rewrites. Keep the implementation practical and directly editable.";
    case "claude":
      return "Reason carefully about architecture before changing files. Explain risks and trade-offs clearly.";
    default:
      return "Act as a careful AI coding agent. Keep changes focused, safe, and consistent with the project.";
  }
}

function getTaskTypeInstruction(taskType: string) {
  switch (taskType) {
    case "ui":
      return "This is a UI/UX task. Preserve existing behavior while improving visual design, layout, accessibility, and interaction quality.";
    case "backend":
      return "This is a backend task. Preserve existing API contracts, validation, error handling, and database behavior.";
    case "bugfix":
      return "This is a bugfix task. Identify the root cause first, then apply the smallest safe fix.";
    case "refactor":
      return "This is a refactoring task. Do not change external behavior. Keep the refactor incremental and easy to review.";
    case "docs":
      return "This is a documentation task. Keep the documentation accurate, concise, and aligned with the current project.";
    case "tests":
      return "This is a testing task. Add or improve tests without changing production behavior unnecessarily.";
    default:
      return "Use the task description to determine the safest implementation approach.";
  }
}

export function buildTaskPackPrompt(input: BuildTaskPackInput) {
  const { project, rawTask, targetTool, taskType } = input;
  const packageManager = project.packageManager ?? "npm";

  const verificationCommands = [
    project.scripts.build ? `- Build: \`${packageManager} run build\`` : null,
    project.scripts.test ? `- Tests: \`${packageManager} test\`` : null,
    project.scripts.dev ? `- Dev server: \`${packageManager} run dev\`` : null
  ].filter(Boolean);

  return `# AI Task Pack

## Target Tool

${targetTool}

## Task Type

${taskType}

## Task

${rawTask}

---

## Project Context

Project: **${project.name}**

Local path:

\`\`\`text
${project.localPath}
\`\`\`

Detected stack:

${formatStack(project.detectedStack)}

Package manager: **${packageManager}**

AI readiness score: **${project.readinessScore}/100**

Available scripts:

${formatScripts(project.scripts)}

---

## Agent Instructions

${getTargetInstruction(targetTool)}

${getTaskTypeInstruction(taskType)}

---

## Constraints

- Do not rewrite the whole project unless explicitly requested.
- Do not modify unrelated files.
- Preserve the existing architecture and naming style.
- Preserve existing behavior unless the task explicitly asks to change it.
- Do not introduce large dependencies without explaining why.
- Do not change environment variable names without updating documentation.
- Do not modify generated output files.
- Keep changes small, focused, and reviewable.

---

## Known AI-Readiness Issues

${
  project.readinessReport.issues.length > 0
    ? project.readinessReport.issues.map((issue) => `- ${issue}`).join("\n")
    : "- No major AI-readiness issues detected."
}

---

## Acceptance Criteria

The task is complete when:

- The requested change is implemented.
- Existing behavior is not broken.
- The changed code matches the current project style.
- The implementation is focused and does not include unrelated rewrites.
- Any important limitation is mentioned in the final response.

---

## Verification

Run these commands if available:

${
  verificationCommands.length > 0
    ? verificationCommands.join("\n")
    : "- No verification commands detected. Manually inspect the changed behavior."
}

---

## Expected Final Response

When finished, respond with:

1. Summary of what changed.
2. List of changed files.
3. Verification commands that were run.
4. Any risks, skipped checks, or follow-up recommendations.
`;
}