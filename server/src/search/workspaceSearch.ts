import fs from "node:fs/promises";
import path from "node:path";
import { storage } from "../storage/index.js";

export type WorkspaceSearchResultType = "project" | "taskPack" | "file";

export interface WorkspaceSearchResult {
  id: string;
  type: WorkspaceSearchResultType;
  title: string;
  subtitle: string;
  projectId?: number;
  projectName?: string;
  taskPackId?: number;
  absolutePath?: string;
  relativePath?: string;
  line?: number;
  snippet?: string;
  score: number;
}

interface ProjectRow {
  id: number;
  name: string;
  localPath: string;
  packageManager: string | null;
  detectedStack: string[];
  readinessScore: number;
}

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  ".vite",
  ".parcel-cache",
  "target",
  "bin",
  "obj",
  "vendor",
  ".venv",
  "venv",
  "__pycache__"
]);

const SEARCHABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".txt",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".xml",
  ".svg",
  ".yml",
  ".yaml",
  ".toml",
  ".env",
  ".example",
  ".prisma",
  ".sql",
  ".graphql",
  ".gql"
]);

const SEARCHABLE_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "tailwind.config.js",
  "tailwind.config.ts",
  "postcss.config.js",
  "eslint.config.js",
  "eslint.config.mjs",
  "agents.md"
]);

const MAX_FILE_SIZE_BYTES = 220_000;
const MAX_FILES_PER_PROJECT = 900;
const MAX_PROJECTS_FOR_FILE_SEARCH = 12;
const MAX_FILE_RESULTS = 32;
const MAX_DB_RESULTS = 12;

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/");
}

function isSearchableFile(filePath: string) {
  const fileName = path.basename(filePath).toLowerCase();
  const extension = path.extname(filePath).toLowerCase();

  return SEARCHABLE_EXTENSIONS.has(extension) || SEARCHABLE_FILENAMES.has(fileName);
}

function isSafeProjectChild(projectRoot: string, targetPath: string) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(targetPath);

  return target === root || target.startsWith(`${root}${path.sep}`);
}

function createSnippet(content: string, query: string) {
  const normalizedContent = normalize(content);
  const normalizedQuery = normalize(query);
  const index = normalizedContent.indexOf(normalizedQuery);

  if (index < 0) {
    return {
      line: 1,
      snippet: content.slice(0, 180).replace(/\s+/g, " ").trim()
    };
  }

  const before = content.slice(0, index);
  const line = before.split(/\r?\n/).length;

  const start = Math.max(0, index - 90);
  const end = Math.min(content.length, index + normalizedQuery.length + 140);

  const snippet = content
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();

  return {
    line,
    snippet: `${start > 0 ? "…" : ""}${snippet}${end < content.length ? "…" : ""}`
  };
}

async function getProjectsForSearch(): Promise<ProjectRow[]> {
  const projects = await storage.listProjects();
  return projects.slice(0, MAX_PROJECTS_FOR_FILE_SEARCH);
}

async function searchProjectRows(query: string): Promise<WorkspaceSearchResult[]> {
  const normalizedQuery = normalize(query);
  const projects = await storage.listProjects();

  return projects
    .filter((project) =>
      [
        project.name,
        project.localPath,
        project.packageManager,
        project.detectedStack.join(" ")
      ].some((value) => normalize(value).includes(normalizedQuery))
    )
    .slice(0, MAX_DB_RESULTS)
    .map((project) => ({
      id: `project-${project.id}`,
      type: "project",
      title: project.name,
      subtitle: `${project.localPath} · AI ${project.readinessScore}/100`,
      projectId: project.id,
      projectName: project.name,
      score: 80
    }));
}

async function searchTaskPackRows(query: string): Promise<WorkspaceSearchResult[]> {
  const normalizedQuery = normalize(query);
  const taskPacks = await storage.listTaskPacks();

  return taskPacks
    .filter((taskPack) =>
      [
        taskPack.title,
        taskPack.rawTask,
        taskPack.generatedPrompt,
        taskPack.taskType,
        taskPack.targetTool,
        taskPack.projectName
      ].some((value) => normalize(value).includes(normalizedQuery))
    )
    .slice(0, MAX_DB_RESULTS)
    .map((taskPack) => ({
      id: `task-pack-${taskPack.id}`,
      type: "taskPack",
      title: taskPack.title,
      subtitle: `${taskPack.projectName ?? "Project"} · ${taskPack.taskType} · ${taskPack.targetTool}`,
      projectId: taskPack.projectId,
      projectName: taskPack.projectName,
      taskPackId: taskPack.id,
      score: 70
    }));
}

async function collectSearchableFiles(projectRoot: string) {
  const files: string[] = [];
  const queue = [projectRoot];

  while (queue.length > 0 && files.length < MAX_FILES_PER_PROJECT) {
    const currentDir = queue.shift();

    if (!currentDir) {
      continue;
    }

    let entries: import("node:fs").Dirent[];

    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);

      if (!isSafeProjectChild(projectRoot, absolutePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name.toLowerCase())) {
          queue.push(absolutePath);
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!isSearchableFile(absolutePath)) {
        continue;
      }

      files.push(absolutePath);

      if (files.length >= MAX_FILES_PER_PROJECT) {
        break;
      }
    }
  }

  return files;
}

async function searchProjectFiles(query: string): Promise<WorkspaceSearchResult[]> {
  const projects = await getProjectsForSearch();
  const results: WorkspaceSearchResult[] = [];
  const normalizedQuery = normalize(query);

  for (const project of projects) {
    if (results.length >= MAX_FILE_RESULTS) {
      break;
    }

    const projectRoot = project.localPath;
    const files = await collectSearchableFiles(projectRoot);

    for (const absolutePath of files) {
      if (results.length >= MAX_FILE_RESULTS) {
        break;
      }

      let stat;

      try {
        stat = await fs.stat(absolutePath);
      } catch {
        continue;
      }

      if (stat.size > MAX_FILE_SIZE_BYTES) {
        continue;
      }

      let content = "";

      try {
        content = await fs.readFile(absolutePath, "utf8");
      } catch {
        continue;
      }

      const relativePath = normalizePath(path.relative(projectRoot, absolutePath));
      const normalizedRelativePath = normalize(relativePath);

      const pathMatches = normalizedRelativePath.includes(normalizedQuery);
      const contentMatches = normalize(content).includes(normalizedQuery);

      if (!pathMatches && !contentMatches) {
        continue;
      }

      const { line, snippet } = createSnippet(
        contentMatches ? content : relativePath,
        query
      );

      results.push({
        id: `file-${project.id}-${relativePath}`,
        type: "file",
        title: relativePath,
        subtitle: `${project.name}${contentMatches ? ` · line ${line}` : " · path match"}`,
        projectId: project.id,
        projectName: project.name,
        absolutePath,
        relativePath,
        line: contentMatches ? line : undefined,
        snippet: contentMatches ? snippet : "Matched by file path.",
        score: contentMatches ? 95 : 60
      });
    }
  }

  return results;
}

export async function searchWorkspace(query: string) {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 2) {
    return [];
  }

  const [projects, taskPacks, files] = await Promise.all([
    searchProjectRows(trimmedQuery),
    searchTaskPackRows(trimmedQuery),
    searchProjectFiles(trimmedQuery)
  ]);

  return [...files, ...projects, ...taskPacks]
    .sort((a, b) => b.score - a.score)
    .slice(0, 48);
}