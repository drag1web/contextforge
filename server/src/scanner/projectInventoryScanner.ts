import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

export type ProjectInventoryFileKind =
    | "source"
    | "style"
    | "asset"
    | "config"
    | "docs"
    | "data"
    | "test"
    | "runtime"
    | "unknown";

export interface ProjectInventoryFile {
    path: string;
    name: string;
    extension: string;
    kind: ProjectInventoryFileKind;
    sizeBytes: number;
    depth: number;
    canReadText: boolean;
    isLikelyGenerated: boolean;
}

export interface ProjectInventory {
    rootPath: string;
    files: ProjectInventoryFile[];
    totalFiles: number;
    scannedFiles: number;
    truncated: boolean;
    notes: string[];
}

const IGNORED_DIRECTORIES = new Set([
    "node_modules",
    ".git",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "dist",
    "build",
    "out",
    "coverage",
    ".turbo",
    ".vercel",
    ".idea",
    ".vscode",
    ".cache",
    "tmp",
    "temp"
]);

const GENERATED_PATH_PARTS = [
    "/dist/",
    "/build/",
    "/out/",
    "/coverage/",
    "/.next/",
    "/.nuxt/",
    "/.svelte-kit/",
    "/.turbo/",
    "/generated/",
    "/.cache/"
];

const GENERATED_FILE_NAMES = new Set([
    "next-env.d.ts",
    "vite-env.d.ts",
    "auto-imports.d.ts",
    "components.d.ts"
]);

const TEXT_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".html",
    ".json",
    ".md",
    ".mdx",
    ".txt",
    ".yml",
    ".yaml",
    ".toml",
    ".env",
    ".example",
    ".sql",
    ".prisma",
    ".graphql",
    ".gql",
    ".xml",
    ".svg"
]);

const SOURCE_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".vue",
    ".svelte",
    ".py",
    ".cs",
    ".java",
    ".go",
    ".rs",
    ".php",
    ".rb",
    ".swift",
    ".kt",
    ".kts"
]);

const STYLE_EXTENSIONS = new Set([
    ".css",
    ".scss",
    ".sass",
    ".less"
]);

const ASSET_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg",
    ".ico",
    ".bmp",
    ".avif",
    ".mp4",
    ".webm",
    ".mov",
    ".mp3",
    ".wav",
    ".ogg",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf"
]);

const DATA_EXTENSIONS = new Set([
    ".db",
    ".sqlite",
    ".sqlite3",
    ".csv",
    ".xlsx",
    ".xls"
]);

const CONFIG_FILE_NAMES = new Set([
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "jsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.cjs",
    "next.config.ts",
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "tailwind.config.ts",
    "tailwind.config.js",
    "tailwind.config.mjs",
    "tailwind.config.cjs",
    "postcss.config.js",
    "postcss.config.mjs",
    "postcss.config.cjs",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".prettierrc",
    ".prettierrc.json",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml"
]);

const DOC_FILE_NAMES = new Set([
    "readme.md",
    "agents.md",
    "claude.md",
    "contributing.md",
    "license.md",
    "changelog.md"
]);

const MAX_FILES = 800;
const MAX_DEPTH = 7;

function normalizePath(value: string) {
    return value.replace(/\\/g, "/");
}

function getDepth(relativePath: string) {
    return normalizePath(relativePath).split("/").filter(Boolean).length;
}

function getExtension(fileName: string) {
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith(".db-wal")) return ".db-wal";
    if (lowerName.endsWith(".db-shm")) return ".db-shm";

    return path.extname(fileName).toLowerCase();
}

function isGeneratedPath(relativePath: string) {
    const normalized = `/${normalizePath(relativePath).toLowerCase()}`;
    const fileName = path.basename(normalized);

    return GENERATED_FILE_NAMES.has(fileName) || GENERATED_PATH_PARTS.some((part) => normalized.includes(part));
}

function canReadTextFile(fileName: string) {
    const lowerName = fileName.toLowerCase();
    const extension = getExtension(lowerName);

    if (lowerName === ".env" || lowerName.endsWith(".env.example")) return true;

    return TEXT_EXTENSIONS.has(extension);
}

function isConfigFileName(fileName: string) {
    const normalized = fileName.toLowerCase();

    if (CONFIG_FILE_NAMES.has(normalized)) return true;
    if (normalized.startsWith("tsconfig") && normalized.endsWith(".json")) return true;
    if (normalized.startsWith("jsconfig") && normalized.endsWith(".json")) return true;
    if (normalized.endsWith(".env.example")) return true;

    return false;
}

function getFileKind(relativePath: string): ProjectInventoryFileKind {
    const normalized = normalizePath(relativePath).toLowerCase();
    const fileName = path.basename(normalized);
    const extension = getExtension(fileName);

    if (
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/tests/") ||
        normalized.includes("/__tests__/")
    ) {
        return "test";
    }

    if (DOC_FILE_NAMES.has(fileName) || normalized.includes("/docs/")) return "docs";
    if (isConfigFileName(fileName)) return "config";
    if (STYLE_EXTENSIONS.has(extension)) return "style";
    if (SOURCE_EXTENSIONS.has(extension)) return "source";
    if (ASSET_EXTENSIONS.has(extension)) return "asset";

    if (DATA_EXTENSIONS.has(extension) || extension === ".db-wal" || extension === ".db-shm") {
        return "data";
    }

    if (normalized.includes("/logs/") || extension === ".log" || extension === ".tmp") {
        return "runtime";
    }

    return "unknown";
}

function shouldSkipDirectory(directoryName: string) {
    return IGNORED_DIRECTORIES.has(directoryName.toLowerCase());
}

function shouldIncludeFile(relativePath: string) {
    const normalized = normalizePath(relativePath).toLowerCase();
    if (normalized.includes("/node_modules/")) return false;
    if (normalized.includes("/.git/")) return false;
    return true;
}

async function getFileSize(absolutePath: string) {
    try {
        const stat = await fs.stat(absolutePath);
        return stat.size;
    } catch {
        return 0;
    }
}

export async function scanProjectInventory(rootPath: string): Promise<ProjectInventory> {
    const files: ProjectInventoryFile[] = [];
    const notes: string[] = [];

    let totalFiles = 0;
    let truncated = false;

    async function walk(currentPath: string, relativeBase = "") {
        if (files.length >= MAX_FILES) {
            truncated = true;
            return;
        }

        const depth = getDepth(relativeBase);
        if (depth > MAX_DEPTH) return;

        let dirEntries: Dirent[];

        try {
            dirEntries = await fs.readdir(currentPath, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of dirEntries) {
            if (files.length >= MAX_FILES) {
                truncated = true;
                return;
            }

            const relativePath = normalizePath(relativeBase ? path.join(relativeBase, entry.name) : entry.name);
            const absolutePath = path.join(rootPath, relativePath);

            if (entry.isDirectory()) {
                if (!shouldSkipDirectory(entry.name)) await walk(absolutePath, relativePath);
                continue;
            }

            if (!entry.isFile()) continue;

            totalFiles += 1;
            if (!shouldIncludeFile(relativePath)) continue;

            const sizeBytes = await getFileSize(absolutePath);
            const name = entry.name;
            const extension = getExtension(name);

            files.push({
                path: relativePath,
                name,
                extension,
                kind: getFileKind(relativePath),
                sizeBytes,
                depth: getDepth(relativePath),
                canReadText: canReadTextFile(name),
                isLikelyGenerated: isGeneratedPath(relativePath)
            });
        }
    }

    await walk(rootPath);

    if (truncated) notes.push(`Inventory was truncated at ${MAX_FILES} files.`);
    if (files.some((file) => file.kind === "asset")) notes.push("Asset files were detected and kept in inventory for asset-related tasks.");
    if (files.some((file) => file.kind === "source")) notes.push("Source files were detected.");
    if (files.some((file) => file.kind === "style")) notes.push("Style files were detected.");
    if (files.some((file) => file.kind === "config")) notes.push("Config files were detected.");
    if (files.some((file) => file.kind === "docs")) notes.push("Documentation files were detected.");

    return {
        rootPath,
        files,
        totalFiles,
        scannedFiles: files.length,
        truncated,
        notes
    };
}
