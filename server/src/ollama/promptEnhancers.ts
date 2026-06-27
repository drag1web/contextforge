interface ProjectLike {
    name: string;
    localPath?: string;
    packageManager?: string | null;
    detectedStack?: string[];
    scripts?: Record<string, string>;
    readinessScore?: number;
}

interface BuildAgentsEnhancementPromptInput {
    project: ProjectLike;
    templateMarkdown: string;
}

interface BuildTaskPackEnhancementPromptInput {
    project: ProjectLike;
    templatePrompt: string;
    rawTask: string;
    taskType: string;
    targetTool: string;
}

function formatJson(value: unknown) {
    return JSON.stringify(value, null, 2);
}

function getTargetToolLabel(targetTool: string) {
    const labels: Record<string, string> = {
        codex: "Codex",
        cursor: "Cursor",
        claude: "Claude Code",
        generic: "Generic AI Agent"
    };

    return labels[targetTool] ?? targetTool;
}

function getTaskTypeLabel(taskType: string) {
    const labels: Record<string, string> = {
        general: "General",
        ui: "UI / UX",
        backend: "Backend",
        bugfix: "Bugfix",
        refactor: "Refactor",
        docs: "Docs",
        tests: "Tests"
    };

    return labels[taskType] ?? taskType;
}

export function buildAgentsEnhancementPrompt({
    project,
    templateMarkdown
}: BuildAgentsEnhancementPromptInput) {
    return `
You are ContextForge's local AI generation engine.

Your job:
Improve an AGENTS.md file for AI coding agents.

Output contract:
- Output the final AGENTS.md content only.
- The first line must be exactly: # AGENTS.md
- Do not write introductions like "Here is", "Sure", or "Below is".
- Do not write final notes, explanations, disclaimers, or commentary after the document.
- Do not wrap the answer in code fences.
- Do not output a table of contents.
- Do not output an empty outline of headings.
- Each required section must contain useful content.
- Use Markdown only.
- Preserve factual project information.
- Do not invent technologies, scripts, files, APIs, folders, dependencies, or architecture.
- If information is missing, write cautious notes instead of inventing details.
- Keep the document concise, practical, and useful for AI coding agents.
- Prefer direct instructions over generic advice.
- Add a short "ContextForge Assisted Notes" section with project-specific advice.
- Keep existing project rules strict and review-friendly.
- Do not remove important warnings from the template.

Required document structure:
# AGENTS.md
## Project Overview
## Available Commands
## Recommended Workflow for AI Agents
## Verification Commands
## Project Rules
## AI Readiness Issues
## ContextForge Assisted Notes
## Output Expectations

Project metadata:
${formatJson({
        name: project.name,
        localPath: project.localPath,
        packageManager: project.packageManager,
        detectedStack: project.detectedStack,
        scripts: project.scripts,
        readinessScore: project.readinessScore
    })}

Template AGENTS.md:
${templateMarkdown}
`.trim();
}

export function buildTaskPackEnhancementPrompt({
    project,
    templatePrompt,
    rawTask,
    taskType,
    targetTool
}: BuildTaskPackEnhancementPromptInput) {
    const targetToolLabel = getTargetToolLabel(targetTool);
    const taskTypeLabel = getTaskTypeLabel(taskType);
    const hasTestScript = Boolean(project.scripts?.test);

    return `
You are ContextForge's local AI generation engine.

Your job:
Improve a task pack prompt for an AI coding agent.

Output contract:
- Output the final AGENTS.md content only.
- The first line must be exactly: # AGENTS.md
- Do not write introductions like "Here is", "Sure", or "Below is".
- Do not write final notes, explanations, disclaimers, or commentary after the document.
- Do not output a table of contents.
- Do not output an empty outline of headings.
- Each required section must contain useful content.
- Do not wrap the answer in code fences.
- Use Markdown only.
- Preserve the user's actual task.
- Do not invent project files, APIs, scripts, folders, dependencies, or implementation details.
- Do not recommend npm scripts that are not present in project metadata.
- ${hasTestScript
            ? "The project has a test script. You may include it in verification."
            : "The project has no detected test script. Do not recommend npm run test."
        }
- Make the prompt more actionable for ${targetToolLabel}.
- Make acceptance criteria clear and specific.
- Make verification steps practical.
- Keep the prompt structured, concise, and copy-ready.
- Avoid generic filler.
- Add a short "ContextForge Assisted Notes" section with project-specific advice.

Required document structure:
# AI Task Pack
## Target Tool
## Task Type
## Task
## Project Context
## Agent Instructions
## Constraints
## Known AI-Readiness Issues
## Acceptance Criteria
## Verification
## Expected Final Response

Target tool display name:
${targetToolLabel}

Task type display name:
${taskTypeLabel}

Project metadata:
${formatJson({
            name: project.name,
            localPath: project.localPath,
            packageManager: project.packageManager,
            detectedStack: project.detectedStack,
            scripts: project.scripts,
            readinessScore: project.readinessScore
        })}

User task:
${rawTask}

Template task pack:
${templatePrompt}
`.trim();
}