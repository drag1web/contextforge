import type { TaskPack } from "../types";

export type TaskPackExportFormat = "md" | "txt";

function sanitizeFileNamePart(value: unknown, fallback: string) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return normalized || fallback;
}

function formatExportDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function formatMetaValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return String(value);
}

function getExportedAt() {
  return new Date().toISOString();
}

function getClarificationLines(taskPack: TaskPack) {
  return (taskPack.generationRecipe?.taskClarifications ?? []).flatMap(
    (item, index) => [
      `Clarification ${index + 1}:`,
      `Question: ${item.question}`,
      `Answer: ${item.answer}`,
      ""
    ]
  );
}

export function getTaskPackExportFileName(
  taskPack: TaskPack,
  format: TaskPackExportFormat
) {
  const projectPart = sanitizeFileNamePart(taskPack.projectName, `project-${taskPack.projectId}`);
  const titlePart = sanitizeFileNamePart(taskPack.title, "task-pack");
  const datePart = formatExportDate(taskPack.createdAt);

  return `contextforge-${projectPart}-${titlePart}-${datePart}.${format}`;
}

export function createTaskPackExportContent(
  taskPack: TaskPack,
  format: TaskPackExportFormat
) {
  const generatedPrompt = taskPack.generatedPrompt?.trim() || "";
  const exportedAt = getExportedAt();
  const recipe = taskPack.generationRecipe;

  if (format === "txt") {
    return [
      "CONTEXTFORGE TASK PACK",
      "======================",
      "",
      `Title: ${formatMetaValue(taskPack.title)}`,
      `Project: ${formatMetaValue(taskPack.projectName ?? `Project #${taskPack.projectId}`)}`,
      `Target tool: ${formatMetaValue(taskPack.targetTool)}`,
      `Task type: ${formatMetaValue(taskPack.taskType)}`,
      `Generation mode: ${formatMetaValue(taskPack.generationMode ?? "template")}`,
      `Model: ${formatMetaValue(taskPack.generationModel)}`,
      `Created: ${formatMetaValue(taskPack.createdAt)}`,
      `Exported: ${exportedAt}`,
      "",
      "RAW TASK",
      "--------",
      taskPack.rawTask?.trim() || "—",
      "",
      ...(getClarificationLines(taskPack).length > 0
        ? [
            "USER CLARIFICATIONS",
            "-------------------",
            ...getClarificationLines(taskPack)
          ]
        : []),
      "RECIPE",
      "------",
      `Template: ${formatMetaValue(recipe?.template?.name)}`,
      `Rule profile: ${formatMetaValue(recipe?.ruleProfile?.name)}`,
      `Enabled rules: ${formatMetaValue(recipe?.counts.enabledRules)}`,
      `Custom rules: ${formatMetaValue(recipe?.counts.customRules)}`,
      `Acceptance criteria: ${formatMetaValue(recipe?.counts.acceptanceCriteria)}`,
      "",
      "GENERATED PROMPT",
      "----------------",
      generatedPrompt || "—",
      ""
    ].join("\n");
  }

  const metadataLines = [
    `- **Project:** ${formatMetaValue(taskPack.projectName ?? `Project #${taskPack.projectId}`)}`,
    `- **Target tool:** ${formatMetaValue(taskPack.targetTool)}`,
    `- **Task type:** ${formatMetaValue(taskPack.taskType)}`,
    `- **Generation mode:** ${formatMetaValue(taskPack.generationMode ?? "template")}`,
    `- **Model:** ${formatMetaValue(taskPack.generationModel)}`,
    `- **Created:** ${formatMetaValue(taskPack.createdAt)}`,
    `- **Exported:** ${exportedAt}`
  ];

  const recipeLines = [
    `- **Template:** ${formatMetaValue(recipe?.template?.name)}`,
    `- **Rule profile:** ${formatMetaValue(recipe?.ruleProfile?.name)}`,
    `- **Enabled rules:** ${formatMetaValue(recipe?.counts.enabledRules)}`,
    `- **Custom rules:** ${formatMetaValue(recipe?.counts.customRules)}`,
    `- **Acceptance criteria:** ${formatMetaValue(recipe?.counts.acceptanceCriteria)}`
  ];

  const clarificationLines = (recipe?.taskClarifications ?? []).flatMap(
    (item, index) => [
      `### Clarification ${index + 1}`,
      "",
      `**Question:** ${item.question}`,
      "",
      `**Answer:** ${item.answer}`,
      ""
    ]
  );

  return [
    `# ${taskPack.title || "ContextForge Task Pack"}`,
    "",
    "> Exported from ContextForge as an agent-ready Task Pack.",
    "",
    "## Metadata",
    "",
    ...metadataLines,
    "",
    "## Raw task",
    "",
    taskPack.rawTask?.trim() || "—",
    "",
    ...(clarificationLines.length > 0
      ? ["## User clarifications", "", ...clarificationLines]
      : []),
    "## Recipe",
    "",
    ...recipeLines,
    "",
    "---",
    "",
    generatedPrompt || "_No generated prompt body was saved._",
    ""
  ].join("\n");
}

export function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export function exportTaskPack(taskPack: TaskPack, format: TaskPackExportFormat) {
  const fileName = getTaskPackExportFileName(taskPack, format);
  const content = createTaskPackExportContent(taskPack, format);
  const mimeType = format === "md" ? "text/markdown" : "text/plain";

  downloadTextFile(fileName, content, mimeType);

  return fileName;
}
