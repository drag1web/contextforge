import type {
    ProjectInventory,
    ProjectInventoryFile
} from "../scanner/projectInventoryScanner.js";

export type SemanticGraphEdgeKind =
    | "import"
    | "component-import"
    | "hook-import"
    | "style-import"
    | "client-api-import"
    | "service-import"
    | "storage-import"
    | "types-import"
    | "test-target"
    | "proposed-test"
    | "route-local"
    | "imported-by";

export interface SemanticGraphEdge {
    from: string;
    to: string;
    importPath?: string;
    kind: SemanticGraphEdgeKind;
}

export interface SemanticGraphNode {
    file: ProjectInventoryFile;
    imports: SemanticGraphEdge[];
    importedBy: SemanticGraphEdge[];
    routeLocal: SemanticGraphEdge[];
}

export interface ProjectSemanticGraph {
    nodes: Map<string, SemanticGraphNode>;
    getNode(path: string): SemanticGraphNode | undefined;
    getSupportFiles(targetPaths: string[], options?: {
        includeImportedBy?: boolean;
        includeRouteLocal?: boolean;
        maxPerTarget?: number;
    }): Array<{ file: ProjectInventoryFile; edge: SemanticGraphEdge }>;
}

function normalizePath(value: string) {
    return value.replace(/\\/g, "/").trim();
}

function normalizeForCompare(value: string) {
    return normalizePath(value).toLowerCase();
}

function isPackageImport(importPath: string) {
    return /^[a-z0-9@][a-z0-9_.-]*(?:\/|$)/i.test(importPath) && !importPath.startsWith("@/");
}

function getSourceDirectory(sourcePath: string) {
    return normalizePath(sourcePath).split("/").slice(0, -1).join("/");
}

function getPathWithoutKnownExtension(pathValue: string) {
    return normalizePath(pathValue).replace(/\.(tsx|jsx|ts|js|mjs|cjs|css|scss|sass|less|json)$/i, "");
}

function resolveImportBasePath(sourceFile: ProjectInventoryFile, importPath: string) {
    const rawImport = normalizePath(importPath).trim();
    if (!rawImport || rawImport.startsWith("node:") || isPackageImport(rawImport)) return undefined;

    if (rawImport.startsWith("@/")) {
        return `src/${rawImport.slice(2)}`;
    }

    if (!rawImport.startsWith("./") && !rawImport.startsWith("../")) {
        return undefined;
    }

    const stack = getSourceDirectory(sourceFile.path).split("/").filter(Boolean);
    for (const part of rawImport.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") stack.pop();
        else stack.push(part);
    }

    return stack.join("/");
}

function getImportCandidatePaths(basePath: string) {
    const normalizedBase = getPathWithoutKnownExtension(basePath);

    return [
        basePath,
        `${normalizedBase}.tsx`,
        `${normalizedBase}.jsx`,
        `${normalizedBase}.ts`,
        `${normalizedBase}.js`,
        `${normalizedBase}.mjs`,
        `${normalizedBase}.cjs`,
        `${normalizedBase}.css`,
        `${normalizedBase}.scss`,
        `${normalizedBase}.sass`,
        `${normalizedBase}.less`,
        `${normalizedBase}/index.tsx`,
        `${normalizedBase}/index.jsx`,
        `${normalizedBase}/index.ts`,
        `${normalizedBase}/index.js`,
        `${normalizedBase}/index.css`
    ].map(normalizeForCompare);
}

function resolveImportToInventoryFile(
    sourceFile: ProjectInventoryFile,
    importPath: string,
    filesByPath: Map<string, ProjectInventoryFile>
) {
    const basePath = resolveImportBasePath(sourceFile, importPath);
    if (!basePath) return undefined;

    for (const candidatePath of getImportCandidatePaths(basePath)) {
        const file = filesByPath.get(candidatePath);
        if (file) return file;
    }

    return undefined;
}

function extractImportLikeSpecifiers(file: ProjectInventoryFile) {
    const specifiers = new Set<string>();
    for (const importPath of file.imports ?? []) {
        if (importPath) specifiers.add(importPath);
    }

    const preview = file.contentPreview ?? "";
    const patterns = [
        /\bimport\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
        /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
        /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
        /@import\s+(?:url\()?["'`]([^"'`]+)["'`]\)?/g
    ];

    for (const pattern of patterns) {
        for (const match of preview.matchAll(pattern)) {
            const specifier = match[1]?.trim();
            if (specifier) specifiers.add(specifier);
        }
    }

    return [...specifiers];
}

function isRouteLocal(sourceFile: ProjectInventoryFile, targetFile: ProjectInventoryFile) {
    const sourceDir = getSourceDirectory(sourceFile.path);
    const targetPath = normalizeForCompare(targetFile.path);
    return Boolean(sourceDir && targetPath.startsWith(`${normalizeForCompare(sourceDir)}/`));
}

function classifyImportEdge(sourceFile: ProjectInventoryFile, targetFile: ProjectInventoryFile): SemanticGraphEdgeKind {
    const targetPath = normalizeForCompare(targetFile.path);
    const targetRole = String(targetFile.role ?? "").toLowerCase();
    if (targetFile.kind === "style" || targetRole === "style") return "style-import";
    if (targetRole === "hook" || targetPath.includes("/hooks/")) return "hook-import";
    if (
        targetRole === "client-api" ||
        /(?:^|\/)(?:api|client|clients)\//.test(targetPath) ||
        /(?:^|\/)(?:api|client)\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(targetPath)
    ) return "client-api-import";
    if (
        targetRole === "service" ||
        /(?:^|\/)(?:service|services|controller|controllers|handler|handlers)\//.test(targetPath)
    ) return "service-import";
    if (
        targetRole === "repository" ||
        targetRole === "storage" ||
        /(?:^|\/)(?:storage|repository|repositories|db|data)\//.test(targetPath)
    ) return "storage-import";
    if (
        targetRole === "types" ||
        targetRole === "schema" ||
        targetRole === "db-schema" ||
        /(?:^|\/)(?:types|schemas|schema)\//.test(targetPath) ||
        /\.(?:d\.ts|schema\.ts|schema\.js|sql)$/i.test(targetPath)
    ) return "types-import";
    if (targetFile.role === "component" || targetFile.role === "ui-component") return "component-import";
    if (isRouteLocal(sourceFile, targetFile)) return "route-local";
    return "import";
}

function findLikelySourceForTestFile(
    testFile: ProjectInventoryFile,
    filesByPath: Map<string, ProjectInventoryFile>
) {
    const testPath = normalizePath(testFile.path);
    const candidates = [
        testPath
            .replace(/(?:^|\/)__tests__\//, "/")
            .replace(/\.(test|spec)\.(tsx|jsx|ts|js)$/i, ".$2"),
        testPath
            .replace(/(?:^|\/)tests?\//, "/src/")
            .replace(/\.(test|spec)\.(tsx|jsx|ts|js)$/i, ".$2")
    ];

    for (const candidate of candidates) {
        const file = filesByPath.get(normalizeForCompare(candidate));
        if (file) return file;
    }

    const basename = testPath
        .split("/")
        .pop()
        ?.replace(/\.(test|spec)\.(tsx|jsx|ts|js)$/i, "")
        .toLowerCase();
    if (!basename) return undefined;

    return [...filesByPath.values()].find((file) => {
        if (file.kind === "test") return false;
        const fileBase = file.name.replace(/\.(tsx|jsx|ts|js|mjs|cjs)$/i, "").toLowerCase();
        return fileBase === basename;
    });
}

function makeNode(file: ProjectInventoryFile): SemanticGraphNode {
    return {
        file,
        imports: [],
        importedBy: [],
        routeLocal: []
    };
}

export function buildProjectSemanticGraph(inventory: ProjectInventory): ProjectSemanticGraph {
    const filesByPath = new Map(
        inventory.files.map((file) => [normalizeForCompare(file.path), file])
    );
    const nodes = new Map(
        inventory.files.map((file) => [normalizeForCompare(file.path), makeNode(file)])
    );

    const addEdge = (edge: SemanticGraphEdge) => {
        const fromNode = nodes.get(normalizeForCompare(edge.from));
        const toNode = nodes.get(normalizeForCompare(edge.to));
        if (!fromNode || !toNode) return;

        fromNode.imports.push(edge);
        toNode.importedBy.push({ ...edge, kind: "imported-by" });

        if (edge.kind === "route-local") {
            fromNode.routeLocal.push(edge);
        }
    };

    for (const sourceFile of inventory.files) {
        for (const importPath of extractImportLikeSpecifiers(sourceFile)) {
            const targetFile = resolveImportToInventoryFile(sourceFile, importPath, filesByPath);
            if (!targetFile) continue;

            addEdge({
                from: sourceFile.path,
                to: targetFile.path,
                importPath,
                kind: classifyImportEdge(sourceFile, targetFile)
            });
        }

        if (sourceFile.kind === "test" || sourceFile.role === "test") {
            const targetFile = findLikelySourceForTestFile(sourceFile, filesByPath);
            if (targetFile) {
                addEdge({
                    from: sourceFile.path,
                    to: targetFile.path,
                    kind: "test-target"
                });
                addEdge({
                    from: targetFile.path,
                    to: sourceFile.path,
                    kind: "proposed-test"
                });
            }
        }
    }

    return {
        nodes,
        getNode(pathValue: string) {
            return nodes.get(normalizeForCompare(pathValue));
        },
        getSupportFiles(targetPaths, options = {}) {
            const includeImportedBy = options.includeImportedBy ?? false;
            const includeRouteLocal = options.includeRouteLocal ?? true;
            const maxPerTarget = options.maxPerTarget ?? 6;
            const seen = new Set(targetPaths.map(normalizeForCompare));
            const support: Array<{ file: ProjectInventoryFile; edge: SemanticGraphEdge }> = [];

            for (const targetPath of targetPaths) {
                const node = nodes.get(normalizeForCompare(targetPath));
                if (!node) continue;

                const edgeSeen = new Set<string>();
                const edges = [
                    ...node.imports,
                    ...(includeRouteLocal ? node.routeLocal : []),
                    ...(includeImportedBy ? node.importedBy : [])
                ].filter((edge) => {
                    const key = `${edge.from}->${edge.to}:${edge.kind}`;
                    if (edgeSeen.has(key)) return false;
                    edgeSeen.add(key);
                    return true;
                });

                for (const edge of edges) {
                    if (support.length >= targetPaths.length * maxPerTarget) return support;
                    const nextPath = edge.kind === "imported-by" ? edge.from : edge.to;
                    const normalizedNextPath = normalizeForCompare(nextPath);
                    if (seen.has(normalizedNextPath)) continue;
                    const nextNode = nodes.get(normalizedNextPath);
                    if (!nextNode) continue;

                    seen.add(normalizedNextPath);
                    support.push({ file: nextNode.file, edge });
                }
            }

            return support;
        }
    };
}
