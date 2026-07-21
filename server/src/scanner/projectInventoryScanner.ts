import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

import {
    analyzeJavaScriptTypeScriptSymbols,
    type SourceSymbolSyntaxFacts
} from "./sourceSymbolSyntax.js";

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
    | "types"
    | "utility"
    | "hook"
    | "style"
    | "config"
    | "docs"
    | "test"
    | "asset"
    | "data"
    | "runtime"
    | "unknown";

export interface ProjectInventoryStructuredEntry {
    values: Array<{ key: string; value: string }>;
}

export interface ProjectInventorySemanticFacts {
    declarations: string[];
    references: string[];
    assignments: string[];
    objectProperties: string[];
    typeFields?: string[];
    stateSymbols: string[];
    translationKeys: string[];
    translationEntries: Array<{ key: string; value: string }>;
    stringLiterals?: string[];
    structuredEntries?: ProjectInventoryStructuredEntry[];
    routePaths: string[];
    /** Exact JS/TS lexical syntax evidence used only by canonical symbol ownership. */
    symbolSyntax?: SourceSymbolSyntaxFacts;
}

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
    semanticFacts?: ProjectInventorySemanticFacts;
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
    "/.cache/",
    "/reports/selector-benchmark/"
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
    ".mts",
    ".cts",
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
    ".mts",
    ".cts",
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
const MAX_LARGE_TEXT_ANALYSIS_CHARS = 90_000;
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

    if (lowerName === ".env" || (lowerName.startsWith(".env.") && !lowerName.includes("example"))) return false;
    if (lowerName.endsWith(".env.example") || lowerName === "env.example") return true;

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
        normalized.includes("/__tests__/") ||
        normalized.includes(".smoke.") ||
        normalized.includes(".replay.")
    ) {
        return "test";
    }

    if (
        DOC_FILE_NAMES.has(fileName) ||
        normalized.includes("/docs/") ||
        extension === ".md" ||
        extension === ".mdx"
    ) return "docs";
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
    const stem = path.basename(fileName, path.extname(fileName));

    if (kind === "docs") return "docs";
    if (kind === "style") return "style";
    if (kind === "config") return "config";
    if (kind === "test") return "test";
    if (kind === "asset") return "asset";
    if (kind === "data") return "data";
    if (kind === "runtime") return "runtime";

    if (
        normalized.startsWith("app/api/") ||
        normalized.includes("/app/api/") ||
        normalized.startsWith("pages/api/") ||
        normalized.includes("/pages/api/") ||
        normalized.startsWith("api/") ||
        fileName === "route.ts" ||
        fileName === "route.js" ||
        fileName === "route.mjs" ||
        fileName === "route.cjs"
    ) return "api-route";
    if (normalized.includes("/routes/") || normalized.startsWith("routes/") || normalized.includes("/controllers/") || normalized.startsWith("controllers/")) return "api-route";
    // Frontend structural folders take precedence over domain-looking route names
    // such as pages/repositories or components/services.
    if (["page.tsx", "page.jsx", "page.ts", "page.js"].includes(fileName) || normalized.includes("/pages/")) return "page";
    if (["layout.tsx", "layout.jsx", "layout.ts", "layout.js", "template.tsx", "template.jsx"].includes(fileName)) return "layout";
    if (normalized.includes("/components/ui/") || normalized.includes("/ui/")) return "ui-component";
    if (normalized.includes("/components/")) return "component";
    if (normalized.includes("/db/") || normalized.includes("/database/") || normalized.includes("/schema/") || normalized.endsWith("schema.prisma") || normalized.endsWith("schema.sql") || /^(?:db|database)\.(?:[cm]?[jt]s)$/.test(fileName)) return "db-schema";
    if (normalized.includes("/repositories/") || normalized.includes("/repository/")) return "repository";
    if (
        normalized.includes("/types/") ||
        normalized.includes("/interfaces/") ||
        /(?:^|[.-])types?\.(?:[cm]?[jt]sx?)$/.test(fileName) ||
        /(?:^|[.-])interfaces?\.(?:[cm]?[jt]sx?)$/.test(fileName)
    ) return "types";
    if (
        normalized.includes("/services/") ||
        normalized.includes("/service/") ||
        /service\.(?:[cm]?[jt]sx?)$/.test(fileName)
    ) {
        const clientSideService =
            normalized.includes("/client/") ||
            normalized.includes("/web/") ||
            normalized.includes("/frontend/") ||
            normalized.includes("/renderer/");
        return clientSideService ? "client-api" : "service";
    }
    if (
        normalized.endsWith("/api.ts") ||
        normalized.endsWith("/api.js") ||
        normalized.includes("/api/client") ||
        normalized.includes("/client/api") ||
        normalized.includes("/lib/api") ||
        /(?:api|client)\.(?:[cm]?[jt]sx?)$/.test(fileName) ||
        /(?:api|client)$/.test(stem)
    ) return "client-api";
    if (normalized.includes("/store/") || normalized.includes("/stores/")) return "store";
    if (normalized.includes("/hooks/") || /^use[a-z0-9]/.test(stem)) return "hook";
    if (fileName === "server.ts" || fileName === "server.js" || normalized.startsWith("server/index.")) return "server-entry";
    if (/^(?:robots|sitemap|manifest|middleware)\.(?:[cm]?[jt]s)$/.test(fileName)) return "config";
    if (/^(?:config|settings)\.(?:[cm]?[jt]s)$/.test(fileName) && (normalized.startsWith("server/") || normalized.includes("/server/"))) return "config";
    if (
        normalized.includes("/utils/") ||
        normalized.includes("/utilities/") ||
        normalized.includes("/helpers/") ||
        normalized.includes("/lib/") ||
        /^(?:calculations?|formatters?|validators?|parsers?|classify|scoring|risk|appearance)(?:[.-]|$)/.test(stem)
    ) return "utility";
    if (
        (normalized.startsWith("server/") || normalized.includes("/server/")) &&
        /^(?:auth|session|queue|worker|processor|provider|manager|ai)(?:[.-]|$)/.test(stem)
    ) return "service";
    if (["app.tsx", "app.jsx", "main.tsx", "main.jsx", "index.tsx", "index.jsx"].includes(fileName)) return "app-entry";
    if (/^[A-Z]/.test(path.basename(relativePath.split("/").pop() ?? fileName, path.extname(fileName)))) return "component";
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
    // Runtime repository mirrors/clones are user data, not implementation files of the host project.
    if (/(?:^|\/)storage\/repositories\/[a-z0-9_-]{12,}(?:\/|$)/.test(normalized)) return false;
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
    }
    const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
    if (unique.length <= limit) return unique;

    const headCount = Math.ceil(limit * 0.5);
    const tailCount = Math.floor(limit * 0.3);
    const middleCount = Math.max(0, limit - headCount - tailCount);
    const middleStart = Math.max(headCount, Math.floor((unique.length - middleCount) / 2));
    return getUniqueStrings([
        ...unique.slice(0, headCount),
        ...unique.slice(middleStart, middleStart + middleCount),
        ...unique.slice(-tailCount),
    ], limit);
}

function extractTranslationEntries(content: string, limit: number) {
    const values: Array<{ key: string; value: string }> = [];
    const seen = new Set<string>();
    for (const match of content.matchAll(/(?:^|[{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*["'`]([^"'`]{1,180})["'`]/gm)) {
        const key = match[1]?.trim();
        const value = match[2]?.trim();
        const identity = `${key?.toLowerCase()}:${value?.toLowerCase()}`;
        if (!key || !value || seen.has(identity)) continue;
        seen.add(identity);
        values.push({ key, value });
    }
    if (values.length <= limit) return values;

    const headCount = Math.ceil(limit * 0.45);
    const tailCount = Math.floor(limit * 0.35);
    const middleCount = Math.max(0, limit - headCount - tailCount);
    const middleStart = Math.max(headCount, Math.floor((values.length - middleCount) / 2));
    return [
        ...values.slice(0, headCount),
        ...values.slice(middleStart, middleStart + middleCount),
        ...values.slice(-tailCount),
    ].slice(0, limit);
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


function stripJsxText(value: string) {
    return value
        .replace(/<[^>]+>/g, " ")
        .replace(/[{}()[\]`$]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractPageSemanticHints(content: string) {
    const hints: string[] = [];
    const add = (value: string | undefined) => {
        const cleaned = stripJsxText(String(value ?? ""));
        if (cleaned.length >= 3 && cleaned.length <= 260) hints.push(cleaned);
    };

    const stringPropertyPatterns = [
        /\btitle\s*:\s*["'`]([^"'`]{3,220})["'`]/gi,
        /\bdescription\s*:\s*["'`]([^"'`]{3,260})["'`]/gi,
        /\baria-label\s*=\s*["'`]([^"'`]{3,160})["'`]/gi,
        /\b(?:label|heading|subtitle)\s*:\s*["'`]([^"'`]{3,180})["'`]/gi
    ];

    for (const pattern of stringPropertyPatterns) {
        for (const match of content.matchAll(pattern)) add(match[1]);
    }

    const headingPattern = /<h[1-3][^>]*>([\s\S]{0,260}?)<\/h[1-3]>/gi;
    for (const match of content.matchAll(headingPattern)) add(match[1]);

    return getUniqueStrings(hints, 24);
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

function buildBoundedAnalysisContent(content: string) {
    if (content.length <= MAX_LARGE_TEXT_ANALYSIS_CHARS) return content;

    const headChars = Math.floor(MAX_LARGE_TEXT_ANALYSIS_CHARS * 0.45);
    const middleChars = Math.floor(MAX_LARGE_TEXT_ANALYSIS_CHARS * 0.25);
    const tailChars = MAX_LARGE_TEXT_ANALYSIS_CHARS - headChars - middleChars;
    const middleStart = Math.max(headChars, Math.floor((content.length - middleChars) / 2));

    return [
        content.slice(0, headChars),
        "\n/* ... ContextForge bounded large-file middle sample ... */\n",
        content.slice(middleStart, middleStart + middleChars),
        "\n/* ... ContextForge bounded large-file tail sample ... */\n",
        content.slice(-tailChars),
    ].join("");
}

const CODE_IDENTIFIER_STOP_WORDS = new Set([
    "as", "async", "await", "break", "case", "catch", "class", "const",
    "continue", "default", "delete", "do", "else", "enum", "export", "extends",
    "false", "finally", "for", "from", "function", "if", "implements", "import",
    "in", "instanceof", "interface", "let", "new", "null", "of", "private",
    "protected", "public", "return", "static", "super", "switch", "this", "throw",
    "true", "try", "type", "typeof", "undefined", "var", "void", "while", "with",
    "yield"
]);

function extractTypeFields(content: string, limit = 1000) {
    const fields: string[] = [];
    const blocks = [
        ...content.matchAll(/\b(?:export\s+)?interface\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s+extends\s+[^\{]+)?\s*\{([\s\S]*?)\n\}/g),
        ...content.matchAll(/\b(?:export\s+)?type\s+[A-Za-z_$][A-Za-z0-9_$]*(?:\s*<[^>]*>)?\s*=\s*\{([\s\S]*?)\n\}\s*;?/g),
    ];

    for (const block of blocks) {
        const body = block[1] ?? "";
        for (const match of body.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:/gm)) {
            const field = match[1]?.trim();
            if (field) fields.push(field);
            if (fields.length >= limit) break;
        }
        if (fields.length >= limit) break;
    }

    return getUniqueStrings(fields, limit);
}


function extractStructuredEntries(content: string, limit = 160) {
    const entries: ProjectInventoryStructuredEntry[] = [];
    const objectPattern = /\{([\s\S]{0,1400}?)\}/g;
    const scalarPropertyPattern = /(?:^|[,;]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:["'`]([^"'`\n]{1,220})["'`]|(true|false|-?\d+(?:\.\d+)?))/gm;

    for (const objectMatch of content.matchAll(objectPattern)) {
        const body = objectMatch[1] ?? "";
        const values: Array<{ key: string; value: string }> = [];
        for (const propertyMatch of body.matchAll(scalarPropertyPattern)) {
            const key = propertyMatch[1]?.trim();
            const value = (propertyMatch[2] ?? propertyMatch[3])?.trim();
            if (!key || !value) continue;
            values.push({ key, value });
            if (values.length >= 24) break;
        }

        if (values.length < 2) continue;
        const identityKeys = new Set([
            "id", "name", "label", "title", "action", "type", "kind", "key",
        ]);
        if (!values.some((entry) => identityKeys.has(entry.key.toLowerCase()))) continue;

        entries.push({ values });
        if (entries.length >= limit) break;
    }

    return entries;
}

function extractSemanticFacts(
    content: string,
    declarations: string[],
    targetedContent = content,
): ProjectInventorySemanticFacts {
    const completeDeclarations = extractMatches(
        targetedContent,
        /\b(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
        600,
    );
    const references = extractMatches(
        content,
        /\b([A-Za-z_$][A-Za-z0-9_$]{2,})\b/g,
        640,
    ).filter((value) => !CODE_IDENTIFIER_STOP_WORDS.has(value));
    const assignments = getUniqueStrings([
        ...extractMatches(content, /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=|>)/g, 160),
        ...extractMatches(content, /\bset([A-Z][A-Za-z0-9_$]*)\s*\(/g, 80),
    ], 200);
    const objectProperties = getUniqueStrings([
        ...extractMatches(content, /(?:^|[{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/gm, 240),
        ...extractMatches(content, /["'`]([A-Za-z_$][A-Za-z0-9_$]*)["'`]\s*:/g, 120),
    ], 280);
    const typeFields = extractTypeFields(targetedContent, 1000);
    const stateSymbols = getUniqueStrings([
        ...extractMatches(content, /\[\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*set[A-Z][A-Za-z0-9_$]*\s*\]\s*=\s*(?:React\.)?useState\b/g, 80),
        ...extractMatches(content, /\[\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\]\s*=\s*(?:React\.)?useReducer\b/g, 40),
        ...extractMatches(content, /\b(?:createContext|createStore|configureStore)\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)?/g, 40),
    ], 120);
    const translationKeys = getUniqueStrings([
        ...extractMatches(content, /\b(?:labelKey|descriptionKey|titleKey|translationKey)\s*:\s*["'`]([^"'`]+)["'`]/g, 120),
        ...extractMatches(content, /\b(?:t|translate|i18n\.t)\s*\(\s*["'`]([^"'`]+)["'`]/g, 120),
    ], 180);
    const translationEntries = extractTranslationEntries(targetedContent, 1000);
    const stringLiterals = getUniqueStrings([
        ...extractMatches(targetedContent, /["'`]([^"'`\n]{2,220})["'`]/g, 1200),
        ...extractMatches(targetedContent, />\s*([^<>{}\n]{2,220}?)\s*</g, 400),
        ...extractMatches(targetedContent, /\b([A-Z][A-Z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)\b/g, 240),
    ], 1000);
    const structuredEntries = extractStructuredEntries(targetedContent, 160);
    const routePaths = getUniqueStrings([
        ...extractMatches(content, /\b(?:router|app)\.(?:get|post|put|patch|delete|use)\s*\(\s*["'`]([^"'`]+)["'`]/gi, 80),
        ...extractMatches(content, /\b(?:path|routePath)\s*:\s*["'`]([^"'`]+)["'`]/gi, 80),
    ], 120);

    return {
        declarations: getUniqueStrings([...declarations, ...completeDeclarations], 600),
        references,
        assignments,
        objectProperties,
        typeFields,
        stateSymbols,
        translationKeys,
        translationEntries,
        stringLiterals,
        structuredEntries,
        routePaths,
    };
}

function redactSensitiveText(content: string) {
    return content
        .replace(/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASS|API_KEY|PRIVATE_KEY|DATABASE_URL|CLIENT_SECRET|ACCESS_KEY)[A-Z0-9_]*)\s*[:=]\s*["'`]?[^\s"',`}]+/gi, "$1=<redacted>")
        .replace(/\b(postgres(?:ql)?:\/\/)[^\s@]+@[^\s"')`]+/gi, "$1<redacted>@<host>");
}

async function analyzeTextFile(absolutePath: string, relativePath: string, sizeBytes: number, canReadText: boolean) {
    if (!canReadText || sizeBytes <= 0) {
        return {
            imports: [],
            exports: [],
            symbols: [],
            textHints: getTopHints([relativePath]),
            contentPreview: undefined
        };
    }

    try {
        const fullContent = redactSensitiveText(await fs.readFile(absolutePath, "utf8"));
        const content = sizeBytes > MAX_ANALYZED_TEXT_BYTES
            ? buildBoundedAnalysisContent(fullContent)
            : fullContent;
        const extension = getExtension(path.basename(relativePath));
        const syntaxAnalysis = analyzeJavaScriptTypeScriptSymbols(fullContent, extension);
        const imports = getUniqueStrings([
            ...extractMatches(content, /import\s+(?:type\s+)?[\s\S]{0,4000}?\s+from\s+["']([^"']+)["']/g, 96),
            ...extractMatches(content, /import\s*\(\s*["']([^"']+)["']\s*\)/g, 32),
            ...extractMatches(content, /require\s*\(\s*["']([^"']+)["']\s*\)/g, 32)
        ], 128);
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
        const pageSemanticHints = extractPageSemanticHints(content);
        const textHints = getTopHints([
            relativePath,
            imports.join(" "),
            exports.join(" "),
            symbols.join(" "),
            pageSemanticHints.join(" "),
            pageSemanticHints.join(" "),
            pageSemanticHints.join(" "),
            content.slice(0, 12_000)
        ]);

        return {
            imports,
            exports,
            symbols,
            textHints,
            semanticFacts: {
                ...extractSemanticFacts(content, [...exports, ...symbols], fullContent),
                symbolSyntax: syntaxAnalysis?.facts,
            },
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
                semanticFacts: textAnalysis.semanticFacts,
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
