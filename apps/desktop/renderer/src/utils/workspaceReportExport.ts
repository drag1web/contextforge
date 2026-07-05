import type { Project, TaskPack } from "../types";
import { downloadTextFile } from "./taskPackExport";

export type WorkspaceReportExportFormat = "md" | "txt";

export interface WorkspaceReportExportInput {
  projects: Project[];
  taskPacks: TaskPack[];
  readinessScore: number | null;
}

type IssueSignal = {
  label: string;
  count: number;
  projects: string[];
};

type CountSignal = {
  label: string;
  count: number;
};

function sanitizeFileNamePart(value: unknown, fallback: string) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return normalized || fallback;
}

function formatExportDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function formatExportedAt() {
  return new Date().toISOString();
}

function getAverageReadiness(projects: Project[]) {
  if (projects.length === 0) {
    return null;
  }

  const total = projects.reduce((sum, project) => sum + project.readinessScore, 0);
  return Math.round(total / projects.length);
}

function getReadinessLabel(score: number | null) {
  if (score === null) return "No scan data";
  if (score >= 80) return "Strong AI readiness";
  if (score >= 50) return "Moderate readiness";
  return "Needs context work";
}

function getProjectFailingLabels(project: Project) {
  const checks = project.readinessReport?.checks ?? [];
  const failedChecks = checks
    .filter((check) => !check.passed)
    .map((check) => check.label)
    .filter(Boolean);

  if (failedChecks.length > 0) {
    return failedChecks;
  }

  return project.readinessReport?.issues ?? [];
}

function getTopIssues(projects: Project[]) {
  const issueMap = new Map<string, IssueSignal>();

  for (const project of projects) {
    for (const label of getProjectFailingLabels(project)) {
      const normalized = label.trim();

      if (!normalized) {
        continue;
      }

      const key = normalized.toLowerCase();
      const existing = issueMap.get(key);

      if (existing) {
        existing.count += 1;
        existing.projects.push(project.name);
        continue;
      }

      issueMap.set(key, {
        label: normalized,
        count: 1,
        projects: [project.name]
      });
    }
  }

  return [...issueMap.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 10);
}

function getCountSignals(values: string[], formatter = (value: string) => value): CountSignal[] {
  const counts = new Map<string, CountSignal>();

  for (const value of values) {
    const key = value || "unknown";
    const existing = counts.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(key, {
      label: formatter(key),
      count: 1
    });
  }

  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function getMostUsedTarget(taskPacks: TaskPack[]) {
  return getCountSignals(taskPacks.map((taskPack) => taskPack.targetTool))[0]?.label ?? "—";
}

function getTaskPackBodyBadge(taskPack: TaskPack) {
  if (taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback) {
    return "AI assisted";
  }

  if (taskPack.generationMode === "ollama" && taskPack.generationUsedFallback) {
    return "AI fallback";
  }

  return "Template";
}

function getTaskTypeLabel(value: string) {
  if (!value) return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getProjectIssuePreview(project: Project) {
  const labels = getProjectFailingLabels(project);

  if (labels.length === 0) {
    return "No major readiness issue detected.";
  }

  return labels.slice(0, 4).join("; ");
}

function getRecommendedActions(projects: Project[], issues: IssueSignal[]) {
  const actions: string[] = [];
  const weakestProject = [...projects].sort((a, b) => a.readinessScore - b.readinessScore)[0];

  if (weakestProject) {
    actions.push(`Improve ${weakestProject.name} first: it has the lowest readiness score.`);
  }

  for (const issue of issues.slice(0, 4)) {
    actions.push(`Fix “${issue.label}” across ${issue.count} project${issue.count === 1 ? "" : "s"}.`);
  }

  if (actions.length === 0) {
    actions.push("Scan more projects or generate Task Packs to build workspace analytics.");
  }

  return actions.slice(0, 5);
}

function formatTextList(values: string[], empty = "—") {
  if (values.length === 0) {
    return empty;
  }

  return values.map((value) => `- ${value}`).join("\n");
}

function formatMarkdownTable(rows: string[][], headers: string[]) {
  const escapeCell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");

  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => escapeCell(String(cell))).join(" | ")} |`)
  ].join("\n");
}

function getTaskPackProjectName(taskPack: TaskPack) {
  return taskPack.projectName ?? `Project #${taskPack.projectId}`;
}

export function getWorkspaceReportExportFileName(format: WorkspaceReportExportFormat) {
  const datePart = formatExportDate();
  const namePart = sanitizeFileNamePart("workspace-report", "workspace-report");
  return `contextforge-${namePart}-${datePart}.${format}`;
}

export function createWorkspaceReportExportContent(
  input: WorkspaceReportExportInput,
  format: WorkspaceReportExportFormat
) {
  const { projects, taskPacks } = input;
  const averageReadiness = input.readinessScore ?? getAverageReadiness(projects);
  const topIssues = getTopIssues(projects);
  const recommendedActions = getRecommendedActions(projects, topIssues);
  const lowReadinessProjects = [...projects]
    .filter((project) => project.readinessScore < 50)
    .sort((a, b) => a.readinessScore - b.readinessScore);
  const readyProjects = projects.filter((project) => project.readinessScore >= 80);
  const recentTaskPacks = [...taskPacks]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);
  const targetSignals = getCountSignals(taskPacks.map((taskPack) => taskPack.targetTool)).slice(0, 8);
  const taskTypeSignals = getCountSignals(taskPacks.map((taskPack) => taskPack.taskType), getTaskTypeLabel).slice(0, 8);
  const assistedCount = taskPacks.filter((taskPack) => taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback).length;
  const fallbackCount = taskPacks.filter((taskPack) => Boolean(taskPack.generationUsedFallback)).length;
  const missingAgentsCount = projects.filter((project) => {
    const checks = project.readinessReport?.checks ?? [];
    return checks.some((check) => /agent|agents/i.test(check.label) && !check.passed);
  }).length;
  const exportedAt = formatExportedAt();

  if (format === "txt") {
    return [
      "CONTEXTFORGE WORKSPACE REPORT",
      "=============================",
      "",
      `Exported: ${exportedAt}`,
      `Workspace status: ${getReadinessLabel(averageReadiness)}`,
      `Projects: ${projects.length}`,
      `Average readiness: ${averageReadiness ?? "—"}`,
      `Need attention: ${lowReadinessProjects.length}`,
      `Ready projects: ${readyProjects.length}`,
      `Task Packs: ${taskPacks.length}`,
      `Top target: ${getMostUsedTarget(taskPacks)}`,
      `Missing AGENTS.md: ${missingAgentsCount}`,
      `AI-assisted runs: ${assistedCount}`,
      `Fallback/template runs: ${fallbackCount}`,
      "",
      "NEXT BEST ACTIONS",
      "-----------------",
      formatTextList(recommendedActions),
      "",
      "PROJECTS NEEDING ATTENTION",
      "--------------------------",
      lowReadinessProjects.length === 0
        ? "No projects below 50/100."
        : lowReadinessProjects
            .slice(0, 10)
            .map((project) => `- ${project.name}: ${project.readinessScore}/100 — ${getProjectIssuePreview(project)}`)
            .join("\n"),
      "",
      "TOP READINESS ISSUES",
      "--------------------",
      topIssues.length === 0
        ? "No recurring readiness issues detected."
        : topIssues
            .map((issue) => `- ${issue.label}: ${issue.count} project${issue.count === 1 ? "" : "s"} (${issue.projects.slice(0, 5).join(", ")})`)
            .join("\n"),
      "",
      "TARGET USAGE",
      "------------",
      targetSignals.length === 0 ? "No target usage yet." : targetSignals.map((signal) => `- ${signal.label}: ${signal.count}`).join("\n"),
      "",
      "TASK CATEGORIES",
      "---------------",
      taskTypeSignals.length === 0 ? "No task type history yet." : taskTypeSignals.map((signal) => `- ${signal.label}: ${signal.count}`).join("\n"),
      "",
      "RECENT TASK PACKS",
      "-----------------",
      recentTaskPacks.length === 0
        ? "No Task Packs generated yet."
        : recentTaskPacks
            .map((taskPack) => `- ${taskPack.title} — ${getTaskPackProjectName(taskPack)} · ${taskPack.targetTool} · ${getTaskPackBodyBadge(taskPack)} · ${taskPack.createdAt}`)
            .join("\n"),
      ""
    ].join("\n");
  }

  const projectRows = lowReadinessProjects.slice(0, 10).map((project) => [
    project.name,
    `${project.readinessScore}/100`,
    getProjectIssuePreview(project)
  ]);
  const issueRows = topIssues.map((issue) => [
    issue.label,
    String(issue.count),
    issue.projects.slice(0, 5).join(", ")
  ]);
  const targetRows = targetSignals.map((signal) => [signal.label, String(signal.count)]);
  const taskTypeRows = taskTypeSignals.map((signal) => [signal.label, String(signal.count)]);
  const recentRows = recentTaskPacks.map((taskPack) => [
    taskPack.title,
    getTaskPackProjectName(taskPack),
    taskPack.targetTool,
    getTaskPackBodyBadge(taskPack),
    taskPack.createdAt
  ]);

  return [
    "# ContextForge Workspace Report",
    "",
    "> Exported from ContextForge local workspace analytics.",
    "",
    "## Summary",
    "",
    `- **Exported:** ${exportedAt}`,
    `- **Workspace status:** ${getReadinessLabel(averageReadiness)}`,
    `- **Projects:** ${projects.length}`,
    `- **Average readiness:** ${averageReadiness ?? "—"}`,
    `- **Need attention:** ${lowReadinessProjects.length}`,
    `- **Ready projects:** ${readyProjects.length}`,
    `- **Task Packs:** ${taskPacks.length}`,
    `- **Top target:** ${getMostUsedTarget(taskPacks)}`,
    `- **Missing AGENTS.md:** ${missingAgentsCount}`,
    `- **AI-assisted runs:** ${assistedCount}`,
    `- **Fallback/template runs:** ${fallbackCount}`,
    "",
    "## Next best actions",
    "",
    formatTextList(recommendedActions),
    "",
    "## Projects needing attention",
    "",
    projectRows.length === 0 ? "No projects below 50/100." : formatMarkdownTable(projectRows, ["Project", "Readiness", "Main issues"]),
    "",
    "## Top readiness issues",
    "",
    issueRows.length === 0 ? "No recurring readiness issues detected." : formatMarkdownTable(issueRows, ["Issue", "Projects", "Examples"]),
    "",
    "## Agent target usage",
    "",
    targetRows.length === 0 ? "No target usage yet." : formatMarkdownTable(targetRows, ["Target", "Task Packs"]),
    "",
    "## Task categories",
    "",
    taskTypeRows.length === 0 ? "No task type history yet." : formatMarkdownTable(taskTypeRows, ["Task type", "Task Packs"]),
    "",
    "## Recent Task Packs",
    "",
    recentRows.length === 0 ? "No Task Packs generated yet." : formatMarkdownTable(recentRows, ["Title", "Project", "Target", "Mode", "Created"]),
    ""
  ].join("\n");
}

export function exportWorkspaceReport(
  input: WorkspaceReportExportInput,
  format: WorkspaceReportExportFormat
) {
  const fileName = getWorkspaceReportExportFileName(format);
  const content = createWorkspaceReportExportContent(input, format);
  const mimeType = format === "md" ? "text/markdown" : "text/plain";

  downloadTextFile(fileName, content, mimeType);

  return fileName;
}
