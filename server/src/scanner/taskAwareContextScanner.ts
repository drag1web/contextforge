import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";

const IGNORED_DIRECTORIES = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "out",
    "coverage",
    ".turbo",
    ".vercel",
    ".idea",
    ".vscode"
]);

const IGNORED_FILES = new Set([
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb"
]);

const SNIPPET_ALLOWED_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".scss",
    ".json",
    ".md"
]);

const MAX_SNIPPET_FILES = 4;
const MAX_SNIPPET_CHARS = 1200;
const MAX_SNIPPET_FILE_SIZE_BYTES = 80_000;

export interface TaskAwareFileSnippet {
    relativePath: string;
    language: string;
    content: string;
    truncated: boolean;
}

export interface TaskAwareProjectContext {
    taskType: string;
    projectTree: string[];
    relevantFiles: string[];
    fileSnippets: TaskAwareFileSnippet[];
    taskIntent?: TaskIntentAnalysis;
    notes: string[];
}

interface FileEntry {
    relativePath: string;
    isDirectory: boolean;
}

function normalizePath(value: string) {
    return value.replaceAll("\\", "/");
}

function normalizeForSearch(value: string) {
    return normalizePath(value).toLowerCase();
}

function pathMatchesSearchTerms(relativePath: string, searchTerms: string[]) {
    const filePath = normalizeForSearch(relativePath);

    return searchTerms.some((term) => {
        const normalizedTerm = normalizeForSearch(term).trim();

        if (!normalizedTerm) {
            return false;
        }

        return filePath.includes(normalizedTerm);
    });
}

function isIgnoredDirectory(name: string) {
    return IGNORED_DIRECTORIES.has(name);
}

function isIgnoredFile(name: string) {
    return IGNORED_FILES.has(name);
}

function isRelevantForTask(
    relativePath: string,
    taskType: string,
    rawTask = "",
    taskIntent?: TaskIntentAnalysis
) {
    const filePath = normalizePath(relativePath).toLowerCase();

    if (taskIntent?.recommendedSearchTerms?.length) {
        if (pathMatchesSearchTerms(relativePath, taskIntent.recommendedSearchTerms)) {
            return true;
        }
    }

    const task = [
        rawTask,
        ...(taskIntent?.intentTags ?? []),
        ...(taskIntent?.mentionedEntities ?? []),
        ...(taskIntent?.recommendedSearchTerms ?? [])
    ]
        .join(" ")
        .toLowerCase();

    const isHomepageTask =
        task.includes("homepage") ||
        task.includes("home page") ||
        task.includes("landing") ||
        task.includes("main page") ||
        task.includes("dashboard");

    const isLayoutTask =
        task.includes("responsive") ||
        task.includes("layout") ||
        task.includes("adaptive") ||
        task.includes("mobile");

    if (taskType === "ui") {
        const isGeneralUiFile =
            filePath.includes("app/") ||
            filePath.includes("pages/") ||
            filePath.includes("components/") ||
            filePath.includes("styles/") ||
            filePath.includes("ui/") ||
            filePath.endsWith("globals.css") ||
            filePath.endsWith("index.css") ||
            filePath.endsWith("tailwind.config.js") ||
            filePath.endsWith("tailwind.config.ts");

        const isHomepageFile =
            filePath.endsWith("app/page.tsx") ||
            filePath.endsWith("app/page.jsx") ||
            filePath.endsWith("pages/index.tsx") ||
            filePath.endsWith("pages/index.jsx") ||
            filePath.includes("home") ||
            filePath.includes("homepage") ||
            filePath.includes("landing") ||
            filePath.includes("dashboard") ||
            filePath.endsWith("app.tsx") ||
            filePath.endsWith("main.tsx");

        const isLayoutFile =
            filePath.includes("layout") ||
            filePath.includes("shell") ||
            filePath.includes("sidebar") ||
            filePath.includes("topbar") ||
            filePath.includes("header") ||
            filePath.includes("navigation") ||
            filePath.endsWith("index.css") ||
            filePath.endsWith("globals.css");

        if (isHomepageTask && isHomepageFile) {
            return true;
        }

        if (isLayoutTask && isLayoutFile) {
            return true;
        }

        return isGeneralUiFile;
    }

    if (taskType === "backend") {
        return (
            filePath.includes("server/") ||
            filePath.includes("api/") ||
            filePath.includes("routes/") ||
            filePath.includes("controllers/") ||
            filePath.includes("services/") ||
            filePath.includes("db/") ||
            filePath.includes("database/") ||
            filePath.includes("prisma/") ||
            filePath.includes("migrations/")
        );
    }

    if (taskType === "docs") {
        return (
            filePath.includes("docs/") ||
            filePath.endsWith("readme.md") ||
            filePath.endsWith("agents.md") ||
            filePath.endsWith("claude.md") ||
            filePath.endsWith(".cursorrules")
        );
    }

    if (taskType === "tests") {
        return (
            filePath.includes("tests/") ||
            filePath.includes("__tests__/") ||
            filePath.includes(".test.") ||
            filePath.includes(".spec.")
        );
    }

    if (taskType === "bugfix" || taskType === "refactor") {
        return (
            filePath.includes("src/") ||
            filePath.includes("app/") ||
            filePath.includes("pages/") ||
            filePath.includes("components/") ||
            filePath.includes("server/") ||
            filePath.includes("api/") ||
            filePath.endsWith("package.json") ||
            filePath.endsWith("tsconfig.json")
        );
    }

    return (
        filePath.includes("src/") ||
        filePath.includes("app/") ||
        filePath.includes("pages/") ||
        filePath.includes("components/") ||
        filePath.includes("server/") ||
        filePath.endsWith("package.json") ||
        filePath.endsWith("tsconfig.json")
    );
}

function scoreRelevantFile(
    relativePath: string,
    taskType: string,
    rawTask = "",
    taskIntent?: TaskIntentAnalysis
) {
    const filePath = normalizePath(relativePath).toLowerCase();
    const task = rawTask.toLowerCase();

    let score = 0;

    if (taskIntent?.recommendedSearchTerms?.length) {
        if (pathMatchesSearchTerms(relativePath, taskIntent.recommendedSearchTerms)) {
            score += 80;
        }
    }

    const isHomepageTask =
        task.includes("homepage") ||
        task.includes("home page") ||
        task.includes("landing") ||
        task.includes("main page") ||
        task.includes("dashboard");

    const isLayoutTask =
        task.includes("responsive") ||
        task.includes("layout") ||
        task.includes("adaptive") ||
        task.includes("mobile");

    if (taskType === "ui") {
        if (filePath.endsWith("app.tsx")) score += 50;
        if (filePath.endsWith("main.tsx")) score += 20;
        if (filePath.includes("applayout")) score += 45;
        if (filePath.includes("layout")) score += 35;
        if (filePath.includes("dashboard")) score += isHomepageTask ? 45 : 20;
        if (filePath.includes("home")) score += isHomepageTask ? 50 : 20;
        if (filePath.includes("landing")) score += isHomepageTask ? 50 : 20;
        if (filePath.includes("pageheader")) score += 35;
        if (filePath.includes("topbar")) score += 35;
        if (filePath.includes("header")) score += 25;
        if (filePath.includes("sidebar")) score += 20;
        if (filePath.includes("navigation")) score += 20;
        if (filePath.endsWith("index.css")) score += isLayoutTask ? 45 : 25;
        if (filePath.endsWith("globals.css")) score += isLayoutTask ? 45 : 25;
        if (filePath.includes("tailwind.config")) score += isLayoutTask ? 40 : 20;
        if (filePath.includes("/ui/button")) score += 22;
        if (filePath.includes("/ui/card")) score += 22;
        if (filePath.includes("/components/")) score += 8;
        if (filePath.includes("/pages/")) score += 6;

        if (filePath.includes("types")) score -= 20;
        if (filePath.includes("utils")) score -= 16;
        if (filePath.includes("pinned")) score -= 18;
        if (filePath.includes("rowmenu")) score -= 10;
        if (filePath.includes("dropdown")) score -= 8;

        return score;
    }

    if (taskType === "backend") {
        if (filePath.includes("routes")) score += 35;
        if (filePath.includes("controllers")) score += 35;
        if (filePath.includes("services")) score += 30;
        if (filePath.includes("db")) score += 25;
        if (filePath.includes("schema")) score += 22;
        if (filePath.includes("server")) score += 20;
        if (filePath.endsWith("package.json")) score += 10;

        return score;
    }

    if (taskType === "docs") {
        if (filePath.endsWith("readme.md")) score += 50;
        if (filePath.endsWith("agents.md")) score += 35;
        if (filePath.includes("docs/")) score += 30;

        return score;
    }

    if (taskType === "tests") {
        if (filePath.includes(".test.")) score += 50;
        if (filePath.includes(".spec.")) score += 50;
        if (filePath.includes("tests/")) score += 35;
        if (filePath.includes("__tests__/")) score += 35;

        return score;
    }

    if (filePath.endsWith("package.json")) score += 20;
    if (filePath.endsWith("tsconfig.json")) score += 15;
    if (filePath.includes("src/")) score += 10;
    if (filePath.includes("app/")) score += 10;
    if (filePath.includes("server/")) score += 10;

    return score;
}

function getLanguageFromPath(relativePath: string) {
    const extension = path.extname(relativePath).toLowerCase();

    const languages: Record<string, string> = {
        ".ts": "ts",
        ".tsx": "tsx",
        ".js": "js",
        ".jsx": "jsx",
        ".css": "css",
        ".scss": "scss",
        ".json": "json",
        ".md": "md"
    };

    return languages[extension] ?? "text";
}

function isSnippetAllowed(relativePath: string) {
    const extension = path.extname(relativePath).toLowerCase();
    return SNIPPET_ALLOWED_EXTENSIONS.has(extension);
}

function cleanupSnippetContent(content: string) {
    return content
        .replace(/\r\n/g, "\n")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//# sourceMappingURL="))
        .join("\n")
        .trim();
}

async function readFileSnippet(rootPath: string, relativePath: string) {
    if (!isSnippetAllowed(relativePath)) {
        return null;
    }

    const absolutePath = path.join(rootPath, relativePath);

    try {
        const stat = await fs.stat(absolutePath);

        if (!stat.isFile() || stat.size > MAX_SNIPPET_FILE_SIZE_BYTES) {
            return null;
        }

        const rawContent = await fs.readFile(absolutePath, "utf-8");
        const content = cleanupSnippetContent(rawContent);

        if (!content) {
            return null;
        }

        const truncated = content.length > MAX_SNIPPET_CHARS;

        return {
            relativePath,
            language: getLanguageFromPath(relativePath),
            content: truncated ? content.slice(0, MAX_SNIPPET_CHARS).trim() : content,
            truncated
        };
    } catch {
        return null;
    }
}

async function buildFileSnippets(rootPath: string, relevantFiles: string[]) {
    const snippets = [];

    for (const relativePath of relevantFiles.slice(0, MAX_SNIPPET_FILES)) {
        const snippet = await readFileSnippet(rootPath, relativePath);

        if (snippet) {
            snippets.push(snippet);
        }
    }

    return snippets;
}

async function collectProjectEntries(
    rootPath: string,
    maxDepth = 4,
    maxEntries = 160
) {
    const entries: FileEntry[] = [];

    async function walk(currentPath: string, depth: number) {
        if (depth > maxDepth || entries.length >= maxEntries) {
            return;
        }

        let dirEntries: Dirent<string>[];

        try {
            dirEntries = await fs.readdir(currentPath, {
                withFileTypes: true,
                encoding: "utf8"
            });
        } catch {
            return;
        }

        for (const entry of dirEntries) {
            if (entries.length >= maxEntries) {
                return;
            }

            const entryName = entry.name;

            if (entry.isDirectory() && isIgnoredDirectory(entryName)) {
                continue;
            }

            if (entry.isFile() && isIgnoredFile(entryName)) {
                continue;
            }

            const absolutePath = path.join(currentPath, entryName);
            const relativePath = normalizePath(path.relative(rootPath, absolutePath));

            entries.push({
                relativePath,
                isDirectory: entry.isDirectory()
            });

            if (entry.isDirectory()) {
                await walk(absolutePath, depth + 1);
            }
        }
    }

    await walk(rootPath, 0);

    return entries;
}

function buildNotes(entries: FileEntry[], relevantFiles: string[], taskType: string) {
    const notes: string[] = [];

    const paths = entries.map((entry) => normalizePath(entry.relativePath).toLowerCase());

    if (paths.some((filePath) => filePath.startsWith("app/"))) {
        notes.push("Project appears to use an app-style frontend structure.");
    }

    if (paths.some((filePath) => filePath.startsWith("pages/"))) {
        notes.push("Project appears to use a pages-style frontend structure.");
    }

    if (paths.some((filePath) => filePath.includes("components/"))) {
        notes.push("Reusable components directory detected.");
    }

    if (paths.some((filePath) => filePath.includes("server/") || filePath.includes("api/"))) {
        notes.push("Backend/API-related structure detected.");
    }

    if (taskType === "ui" && relevantFiles.length === 0) {
        notes.push("No obvious UI files were detected. The agent should inspect the project manually before editing.");
    }

    if (taskType === "backend" && relevantFiles.length === 0) {
        notes.push("No obvious backend files were detected. The agent should inspect API/server folders manually.");
    }

    if (relevantFiles.length > 0) {
        notes.push("Relevant file candidates were selected by ContextForge based on the selected task type.");
    }

    return notes;
}

export async function buildTaskAwareProjectContext(
    projectRoot: string,
    taskType: string,
    rawTask = "",
    taskIntent?: TaskIntentAnalysis
): Promise<TaskAwareProjectContext> {
    const entries = await collectProjectEntries(projectRoot);

    const projectTree = entries
        .slice(0, 120)
        .map((entry) => `${entry.isDirectory ? "dir " : "file"} ${entry.relativePath}`);

    const relevantFiles = entries
        .filter((entry) => !entry.isDirectory)
        .map((entry) => entry.relativePath)
        .filter((relativePath) =>
            isRelevantForTask(relativePath, taskType, rawTask, taskIntent)
        )
        .map((relativePath) => ({
            relativePath,
            score: scoreRelevantFile(relativePath, taskType, rawTask, taskIntent)
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map((item) => item.relativePath);

    const fileSnippets = await buildFileSnippets(projectRoot, relevantFiles);
    const notes = buildNotes(entries, relevantFiles, taskType);

    return {
        taskType,
        projectTree,
        relevantFiles,
        fileSnippets,
        taskIntent,
        notes
    };
}