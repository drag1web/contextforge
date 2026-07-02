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

function isRouteLocal(sourceFile: ProjectInventoryFile, targetFile: ProjectInventoryFile) {
    const sourceDir = getSourceDirectory(sourceFile.path);
    const targetPath = normalizeForCompare(targetFile.path);
    return Boolean(sourceDir && targetPath.startsWith(`${normalizeForCompare(sourceDir)}/`));
}

function classifyImportEdge(sourceFile: ProjectInventoryFile, targetFile: ProjectInventoryFile): SemanticGraphEdgeKind {
    if (targetFile.kind === "style" || targetFile.role === "style") return "style-import";
    if (targetFile.role === "hook") return "hook-import";
    if (targetFile.role === "client-api" || normalizeForCompare(targetFile.path).includes("/api/")) return "client-api-import";
    if (targetFile.role === "component" || targetFile.role === "ui-component") return "component-import";
    if (isRouteLocal(sourceFile, targetFile)) return "route-local";
    return "import";
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
        for (const importPath of sourceFile.imports ?? []) {
            const targetFile = resolveImportToInventoryFile(sourceFile, importPath, filesByPath);
            if (!targetFile) continue;

            addEdge({
                from: sourceFile.path,
                to: targetFile.path,
                importPath,
                kind: classifyImportEdge(sourceFile, targetFile)
            });
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

                const edges = [
                    ...node.imports,
                    ...(includeRouteLocal ? node.routeLocal : []),
                    ...(includeImportedBy ? node.importedBy : [])
                ];

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
