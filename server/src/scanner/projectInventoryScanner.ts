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

export type ProjectInventoryFileRole =
    | "app-entry"
    | "page"
    | "layout"
    | "component"
    | "ui-component"
    | "api-route"
    | "client-api"
    | "server-entry"
    | "service"
    | "repository"
    | "db-schema"
    | "store"
    | "hook"
    | "style"
    | "config"
    | "docs"
    | "test"
    | "asset"
    | "data"
    | "runtime"
    | "unknown";

export interface ProjectInventoryFile {
    path: string;
    name: string;
    extension: string;
    kind: ProjectInventoryFileKind;
    role: ProjectInventoryFileRole;
    routePath?: string;
    imports: string[];
    exports: string[];
    symbols: string[];
    textHints: string[];
    contentPreview?: string;
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

const HINT_STOP_WORDS = new Set([
    "the", "and", "for", "from", "this", "that", "with", "without", "const", "let", "var",
    "function", "return", "export", "default", "import", "type", "interface", "class", "extends",
    "props", "children", "string", "number", "boolean", "object", "array", "null", "undefined",
    "true", "false", "async", "await", "new", "set", "get", "use", "src", "app", "page",
    "component", "components", "style", "styles", "index", "main", "div", "span", "className",
    "это", "как", "что", "для", "или", "если", "надо", "нужно", "чтобы", "когда", "где",
    "при", "под", "над", "без", "его", "она", "они", "оно", "мне", "тебе", "тут", "все", "всё"
]);

const MAX_FILES = 800;
const MAX_DEPTH = 7;
const MAX_ANALYZED_TEXT_BYTES = 80_000;
const MAX_CONTENT_PREVIEW_CHARS = 360;

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

function classifyFileRole(relativePath: string, kind: ProjectInventoryFileKind): ProjectInventoryFileRole {
    const normalized = normalizePath(relativePath).toLowerCase();
    const fileName = normalized.split("/").pop() ?? normalized;

    if (kind === "docs") return "docs";
    if (kind === "style") return "style";
    if (kind === "config") return "config";
    if (kind === "test") return "test";
    if (kind === "asset") return "asset";
    if (kind === "data") return "data";
    if (kind === "runtime") return "runtime";

    if (normalized.startsWith("app/api/") || normalized.includes("/app/api/") || normalized.startsWith("pages/api/") || normalized.includes("/pages/api/") || fileName === "route.ts" || fileName === "route.js") return "api-route";
    if (normalized.includes("/routes/") || normalized.startsWith("routes/") || normalized.includes("/controllers/") || normalized.startsWith("controllers/")) return "api-route";
    if (normalized.includes("/db/") || normalized.includes("/database/") || normalized.includes("/schema/") || normalized.endsWith("schema.prisma") || normalized.endsWith("schema.sql")) return "db-schema";
    if (normalized.includes("/repositories/") || normalized.includes("/repository/")) return "repository";
    if (normalized.includes("/services/") || normalized.includes("/service/")) return normalized.includes("api") ? "client-api" : "service";
    if (normalized.endsWith("/api.ts") || normalized.endsWith("/api.js") || normalized.includes("/api/client") || normalized.includes("/client/api")) return "client-api";
    if (normalized.includes("/store/") || normalized.includes("/stores/")) return "store";
    if (normalized.includes("/hooks/") || /^use[A-Z]/.test(fileName)) return "hook";
    if (fileName === "server.ts" || fileName === "server.js" || normalized.startsWith("server/index.")) return "server-entry";
    if (["app.tsx", "app.jsx", "main.tsx", "main.jsx", "index.tsx", "index.jsx"].includes(fileName)) return "app-entry";
    if (["page.tsx", "page.jsx", "page.ts", "page.js"].includes(fileName) || normalized.includes("/pages/")) return "page";
    if (["layout.tsx", "layout.jsx", "layout.ts", "layout.js", "template.tsx", "template.jsx"].includes(fileName)) return "layout";
    if (normalized.includes("/components/ui/") || normalized.includes("/ui/")) return "ui-component";
    if (normalized.includes("/components/") || /^[A-Z]/.test(path.basename(fileName, path.extname(fileName)))) return "component";
    if ((normalized.startsWith("src/app/") || normalized.includes("/src/app/") || normalized.startsWith("app/") || normalized.includes("/app/")) && [".tsx", ".jsx"].includes(path.extname(fileName))) return "component";

    return kind === "source" ? "unknown" : kind;
}

function inferRoutePath(relativePath: string) {
    const normalized = normalizePath(relativePath);
    const lower = normalized.toLowerCase();
    const fileName = lower.split("/").pop() ?? lower;

    if (!["page.tsx", "page.jsx", "page.ts", "page.js", "route.ts", "route.js"].includes(fileName)) {
        return undefined;
    }

    const parts = normalized.split("/");
    const appIndex = parts.findIndex((part) => part === "app");
    const pagesIndex = parts.findIndex((part) => part === "pages");
    const startIndex = appIndex >= 0 ? appIndex + 1 : pagesIndex >= 0 ? pagesIndex + 1 : -1;

    if (startIndex < 0) return undefined;

    const routeParts = parts
        .slice(startIndex, -1)
        .filter((part) => !part.startsWith("(") && !part.startsWith("_") && part !== "index")
        .map((part) => part.replace(/^\[(.+?)\]$/, ":$1"));

    return `/${routeParts.join("/")}`.replace(/\/+/g, "/") || "/";
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

function getUniqueStrings(values: string[], limit: number) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function extractMatches(content: string, regex: RegExp, limit: number) {
    const values: string[] = [];
    for (const match of content.matchAll(regex)) {
        const value = match[1]?.trim();
        if (value) values.push(value);
        if (values.length >= limit) break;
    }
    return getUniqueStrings(values, limit);
}

function tokenizeHints(value: string) {
    return value
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-zа-яё0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && token.length <= 32)
        .filter((token) => !HINT_STOP_WORDS.has(token))
        .filter((token) => !/^\d+$/.test(token));
}

function getTopHints(parts: string[]) {
    const counts = new Map<string, number>();
    for (const token of tokenizeHints(parts.join(" "))) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([token]) => token)
        .slice(0, 18);
}

function getContentPreview(content: string) {
    return content
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/.*$/gm, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_CONTENT_PREVIEW_CHARS);
}

async function analyzeTextFile(absolutePath: string, relativePath: string, sizeBytes: number, canReadText: boolean) {
    if (!canReadText || sizeBytes <= 0 || sizeBytes > MAX_ANALYZED_TEXT_BYTES) {
        return {
            imports: [],
            exports: [],
            symbols: [],
            textHints: getTopHints([relativePath]),
            contentPreview: undefined
        };
    }

    try {
        const content = await fs.readFile(absolutePath, "utf8");
        const imports = getUniqueStrings([
            ...extractMatches(content, /import[\s\S]{0,120}?from\s+["']([^"']+)["']/g, 24),
            ...extractMatches(content, /import\s*\(\s*["']([^"']+)["']\s*\)/g, 12),
            ...extractMatches(content, /require\s*\(\s*["']([^"']+)["']\s*\)/g, 12)
        ], 32);
        const exports = getUniqueStrings([
            ...extractMatches(content, /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/g, 24),
            ...extractMatches(content, /export\s*\{([^}]+)\}/g, 12)
                .flatMap((value) => value.split(",").map((item) => item.trim().split(/\s+as\s+/i)[0]))
        ], 32);
        const symbols = getUniqueStrings([
            ...extractMatches(content, /(?:function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g, 24),
            ...extractMatches(content, /const\s+([A-Za-z0-9_$]+)\s*=/g, 24),
            ...exports
        ], 40);
        const textHints = getTopHints([relativePath, imports.join(" "), exports.join(" "), symbols.join(" "), content.slice(0, 12_000)]);

        return {
            imports,
            exports,
            symbols,
            textHints,
            contentPreview: getContentPreview(content)
        };
    } catch {
        return {
            imports: [],
            exports: [],
            symbols: [],
            textHints: getTopHints([relativePath]),
            contentPreview: undefined
        };
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
            const kind = getFileKind(relativePath);
            const canReadText = canReadTextFile(name);
            const textAnalysis = await analyzeTextFile(absolutePath, relativePath, sizeBytes, canReadText);

            files.push({
                path: relativePath,
                name,
                extension,
                kind,
                role: classifyFileRole(relativePath, kind),
                routePath: inferRoutePath(relativePath),
                imports: textAnalysis.imports,
                exports: textAnalysis.exports,
                symbols: textAnalysis.symbols,
                textHints: textAnalysis.textHints,
                contentPreview: textAnalysis.contentPreview,
                sizeBytes,
                depth: getDepth(relativePath),
                canReadText,
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
    if (files.some((file) => file.textHints.length > 0)) notes.push("Inventory includes dynamic text hints extracted from real file names and readable file contents.");
    if (files.some((file) => file.role !== "unknown")) notes.push("Inventory includes generic technical file roles inferred from paths and framework conventions.");

    return {
        rootPath,
        files,
        totalFiles,
        scannedFiles: files.length,
        truncated,
        notes
    };
}
