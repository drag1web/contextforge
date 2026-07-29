import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

export interface ArchitectureSourceModule {
  filePath: string;
  sourceText: string;
}

export interface ArchitectureViolation {
  filePath: string;
  importPath: string;
  rule:
    | "core_external_dependency"
    | "core_boundary_escape"
    | "adapter_boundary_escape"
    | "forbidden_legacy_dependency"
    | "layer_direction"
    | "production_isolation"
    | "unknown_layer";
  message: string;
}

const CORE_LAYERS = new Set(["contracts", "domain", "ports", "application"]);
const TEST_ONLY_LAYERS = new Set(["testing", "validation"]);
const KNOWN_LAYERS = new Set([
  ...CORE_LAYERS,
  ...TEST_ONLY_LAYERS,
  "adapters",
  "policy",
  "facade",
]);
const ALLOWED_TARGET_LAYERS: Readonly<Record<string, ReadonlySet<string>>> = {
  contracts: new Set(["contracts"]),
  domain: new Set(["contracts", "domain"]),
  ports: new Set(["contracts", "domain", "ports"]),
  application: new Set(["contracts", "domain", "ports", "application"]),
  adapters: new Set([
    "contracts",
    "domain",
    "ports",
    "adapters",
  ]),
  policy: new Set(["contracts", "domain", "policy"]),
  facade: new Set(["contracts", "domain", "ports", "application", "adapters"]),
};
const LEGACY_SELECTOR_FRAGMENTS = [
  "/ollama/taskfileselector",
  "/selection/finalselectiondecision",
  "/selection/selectorpipelineorchestrator",
];
const ALLOWED_ADAPTER_EXTERNAL_IMPORTS = new Set(["typescript"]);
function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sourceLayer(filePath: string, v2Root: string): string | null {
  if (!isInside(v2Root, filePath)) {
    return null;
  }
  const relative = normalizePath(path.relative(v2Root, filePath));
  const firstSegment = relative.split("/")[0];
  if (firstSegment.includes(".")) {
    return firstSegment === "index.ts" ? "facade" : "root";
  }
  return firstSegment;
}

export function extractModuleSpecifiers(
  sourceText: string,
  filePath: string,
): string[] {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function readSourceModules(directory: string): ArchitectureSourceModule[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const modules: ArchitectureSourceModule[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      modules.push(...readSourceModules(entryPath));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      modules.push({
        filePath: entryPath,
        sourceText: fs.readFileSync(entryPath, "utf8"),
      });
    }
  }
  return modules.sort((left, right) =>
    normalizePath(left.filePath).localeCompare(normalizePath(right.filePath)),
  );
}

function isLegacySelectorImport(
  importingFile: string,
  importPath: string,
): boolean {
  const resolved = importPath.startsWith(".")
    ? path.resolve(path.dirname(importingFile), importPath)
    : importPath;
  const normalized = normalizePath(resolved).toLowerCase();
  return LEGACY_SELECTOR_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

function isAllowedLegacyScannerImport(
  repositoryRoot: string,
  importingFile: string,
  importPath: string,
): boolean {
  if (!importPath.startsWith(".")) {
    return false;
  }
  const normalizeResolvedModulePath = (value: string) => {
    const normalized = normalizePath(path.resolve(value)).replace(
      /\.(?:js|ts|tsx)$/i,
      "",
    );
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const resolved = normalizeResolvedModulePath(
    path.resolve(path.dirname(importingFile), importPath),
  );
  const expected = normalizeResolvedModulePath(
    path.join(
      repositoryRoot,
      "server",
      "src",
      "scanner",
      "projectInventoryScanner",
    ),
  );
  return resolved === expected;
}

export function evaluateArchitectureImports(input: {
  repositoryRoot: string;
  modules: readonly ArchitectureSourceModule[];
}): ArchitectureViolation[] {
  const v2Root = path.join(
    input.repositoryRoot,
    "server",
    "src",
    "contextEngineV2",
  );
  const violations: ArchitectureViolation[] = [];

  for (const module of input.modules) {
    const layer = sourceLayer(module.filePath, v2Root);
    if (layer && !KNOWN_LAYERS.has(layer)) {
      violations.push({
        filePath: module.filePath,
        importPath: "<module>",
        rule: "unknown_layer",
        message: `Unknown Context Engine v2 layer: ${layer}.`,
      });
      continue;
    }
    for (const importPath of extractModuleSpecifiers(
      module.sourceText,
      module.filePath,
    )) {
      if (layer && isLegacySelectorImport(module.filePath, importPath)) {
        violations.push({
          filePath: module.filePath,
          importPath,
          rule: "forbidden_legacy_dependency",
          message: "Context Engine v2 must not import the legacy selector core.",
        });
        continue;
      }

      if (!layer) {
        const resolved = importPath.startsWith(".")
          ? path.resolve(path.dirname(module.filePath), importPath)
          : null;
        if (
          (resolved && isInside(v2Root, resolved)) ||
          normalizePath(importPath).toLowerCase().includes("contextenginev2")
        ) {
          violations.push({
            filePath: module.filePath,
            importPath,
            rule: "production_isolation",
            message:
              "Production source outside Context Engine v2 cannot import the subsystem during CE2-03.",
          });
        }
        continue;
      }

      if (TEST_ONLY_LAYERS.has(layer)) {
        continue;
      }

      const isCoreLayer =
        CORE_LAYERS.has(layer) || layer === "facade" || layer === "policy";
      const isAdapterLayer = layer === "adapters";
      if (!isCoreLayer && !isAdapterLayer) {
        continue;
      }
      if (!importPath.startsWith(".")) {
        if (isCoreLayer) {
          violations.push({
            filePath: module.filePath,
            importPath,
            rule: "core_external_dependency",
            message: `The ${layer} layer cannot import external runtime dependencies.`,
          });
        } else if (
          isAdapterLayer &&
          !importPath.startsWith("node:") &&
          !ALLOWED_ADAPTER_EXTERNAL_IMPORTS.has(importPath)
        ) {
          violations.push({
            filePath: module.filePath,
            importPath,
            rule: "adapter_boundary_escape",
            message:
              "Adapters may import only Node.js built-ins and explicitly allowed external parser packages.",
          });
        }
        continue;
      }

      const targetPath = path.resolve(path.dirname(module.filePath), importPath);
      if (!isInside(v2Root, targetPath)) {
        if (
          isAdapterLayer &&
          isAllowedLegacyScannerImport(
            input.repositoryRoot,
            module.filePath,
            importPath,
          )
        ) {
          continue;
        }
        if (isAdapterLayer) {
          violations.push({
            filePath: module.filePath,
            importPath,
            rule: "adapter_boundary_escape",
            message:
              "Adapters may leave Context Engine v2 only through an explicitly allowed legacy scanner boundary.",
          });
          continue;
        }
        if (isCoreLayer) {
          violations.push({
            filePath: module.filePath,
            importPath,
            rule: "core_boundary_escape",
            message: `The ${layer} layer cannot import production or legacy source outside Context Engine v2.`,
          });
        }
        continue;
      }

      const targetLayer = sourceLayer(targetPath, v2Root);
      const allowedTargets = ALLOWED_TARGET_LAYERS[layer];
      if (!targetLayer || !allowedTargets?.has(targetLayer)) {
        violations.push({
          filePath: module.filePath,
          importPath,
          rule: "layer_direction",
          message: `The ${layer} layer cannot depend on the ${targetLayer ?? "unknown"} layer.`,
        });
      }
    }
  }

  return violations;
}

export function scanContextEngineV2Architecture(
  repositoryRoot: string,
): ArchitectureViolation[] {
  const serverSources = readSourceModules(
    path.join(repositoryRoot, "server", "src"),
  );
  const rendererSources = readSourceModules(
    path.join(repositoryRoot, "apps", "desktop", "renderer", "src"),
  );
  return evaluateArchitectureImports({
    repositoryRoot,
    modules: [...serverSources, ...rendererSources],
  });
}
