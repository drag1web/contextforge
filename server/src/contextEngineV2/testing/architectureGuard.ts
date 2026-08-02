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
const TEST_ONLY_LAYERS = new Set(["testing"]);
const KNOWN_LAYERS = new Set([
  ...CORE_LAYERS,
  ...TEST_ONLY_LAYERS,
  "validation",
  "shadow",
  "composer",
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
  validation: new Set(["contracts", "domain", "ports", "application", "adapters", "validation"]),
  shadow: new Set(["contracts", "domain", "ports", "application", "adapters", "facade", "shadow"]),
  composer: new Set(["contracts", "domain", "ports", "application", "adapters", "facade", "composer"]),
};
const LEGACY_SELECTOR_FRAGMENTS = [
  "/ollama/taskfileselector",
  "/selection/finalselectiondecision",
  "/selection/selectorpipelineorchestrator",
];
const ALLOWED_ADAPTER_EXTERNAL_IMPORTS = new Set(["typescript"]);
const ALLOWED_LEGACY_SELECTION_TYPE_IMPORTS = new Set([
  "AssetMode",
  "EffectiveTaskArea",
  "SelectedTaskFile",
  "SelectedTaskFileUsage",
  "TaskFileSelection",
]);

interface ArchitectureModuleReference {
  importPath: string;
  typeOnly: boolean;
  importedNames: string[];
}
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
  return extractModuleReferences(sourceText, filePath).map(
    (reference) => reference.importPath,
  );
}

function extractModuleReferences(
  sourceText: string,
  filePath: string,
): ArchitectureModuleReference[] {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind,
  );
  const references: ArchitectureModuleReference[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const importClause = ts.isImportDeclaration(node)
        ? node.importClause
        : undefined;
      const namedBindings = importClause?.namedBindings;
      const namedImports = namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements
        : [];
      const typeOnly = ts.isExportDeclaration(node)
        ? node.isTypeOnly
        : Boolean(
            importClause?.isTypeOnly ||
            (namedImports.length > 0 &&
              !importClause?.name &&
              namedImports.every((element) => element.isTypeOnly)),
          );
      const importedNames = ts.isExportDeclaration(node)
        ? node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map((element) =>
              (element.propertyName ?? element.name).text)
          : []
        : [
            ...(importClause?.name ? ["default"] : []),
            ...(namedBindings && ts.isNamespaceImport(namedBindings) ? ["*"] : []),
            ...namedImports.map((element) =>
              (element.propertyName ?? element.name).text),
          ];
      references.push({
        importPath: node.moduleSpecifier.text,
        typeOnly,
        importedNames,
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      references.push({
        importPath: node.argument.literal.text,
        typeOnly: true,
        importedNames: [],
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      references.push({
        importPath: node.moduleReference.expression.text,
        typeOnly: false,
        importedNames: [],
      });
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      references.push({
        importPath: node.arguments[0].text,
        typeOnly: false,
        importedNames: [],
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
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

function isAllowedLegacySelectionTypeImport(
  repositoryRoot: string,
  v2Root: string,
  importingFile: string,
  reference: ArchitectureModuleReference,
): boolean {
  if (
    !reference.importPath.startsWith(".") ||
    !reference.typeOnly ||
    reference.importedNames.length === 0 ||
    reference.importedNames.some(
      (name) => !ALLOWED_LEGACY_SELECTION_TYPE_IMPORTS.has(name),
    )
  ) {
    return false;
  }
  const adapterRoot = path.join(v2Root, "adapters", "legacySelection");
  const shadowRoot = path.join(v2Root, "shadow");
  if (!isInside(adapterRoot, importingFile) && !isInside(shadowRoot, importingFile)) return false;
  const normalizeResolvedModulePath = (value: string) => {
    const normalized = normalizePath(path.resolve(value)).replace(
      /\.(?:js|ts|tsx)$/i,
      "",
    );
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const resolved = normalizeResolvedModulePath(
    path.resolve(path.dirname(importingFile), reference.importPath),
  );
  const expected = normalizeResolvedModulePath(
    path.join(repositoryRoot, "server", "src", "ollama", "taskFileSelector"),
  );
  return resolved === expected;
}

function isAllowedShadowScannerTypeImport(
  repositoryRoot: string,
  v2Root: string,
  importingFile: string,
  reference: ArchitectureModuleReference,
): boolean {
  return sourceLayer(importingFile, v2Root) === "shadow" &&
    reference.typeOnly &&
    isAllowedLegacyScannerImport(repositoryRoot, importingFile, reference.importPath);
}

function isAllowedComposerScannerTypeImport(
  repositoryRoot: string,
  v2Root: string,
  importingFile: string,
  reference: ArchitectureModuleReference,
): boolean {
  return sourceLayer(importingFile, v2Root) === "composer" &&
    reference.typeOnly &&
    isAllowedLegacyScannerImport(repositoryRoot, importingFile, reference.importPath);
}

function isAllowedShadowProductIntegration(
  repositoryRoot: string,
  importingFile: string,
  importPath: string,
): boolean {
  if (!importPath.startsWith(".")) return false;
  const relative = normalizePath(path.relative(
    path.join(repositoryRoot, "server", "src"),
    importingFile,
  ));
  if (relative !== "routes/taskPacks.ts" && relative !== "settings/settingsService.ts") return false;
  const resolved = normalizePath(path.resolve(path.dirname(importingFile), importPath))
    .replace(/\.(?:js|ts|tsx)$/iu, "");
  const expected = normalizePath(path.join(repositoryRoot, "server", "src", "contextEngineV2", "shadow", "index"));
  return resolved.toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US");
}

function isAllowedComposerProductIntegration(
  repositoryRoot: string,
  importingFile: string,
  importPath: string,
): boolean {
  if (!importPath.startsWith(".")) return false;
  const relative = normalizePath(path.relative(
    path.join(repositoryRoot, "server", "src"), importingFile,
  ));
  if (relative !== "contextComposer/contextComposerService.ts" && relative !== "settings/settingsService.ts") return false;
  const resolved = normalizePath(path.resolve(path.dirname(importingFile), importPath))
    .replace(/\.(?:js|ts|tsx)$/iu, "");
  const expected = normalizePath(path.join(repositoryRoot, "server", "src", "contextEngineV2", "composer", "index"));
  return resolved.toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US");
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
    for (const reference of extractModuleReferences(
      module.sourceText,
      module.filePath,
    )) {
      const importPath = reference.importPath;
      if (layer && isLegacySelectorImport(module.filePath, importPath)) {
        if (
          layer === "adapters" &&
          isAllowedLegacySelectionTypeImport(
            input.repositoryRoot,
            v2Root,
            module.filePath,
            reference,
          )
        ) {
          continue;
        }
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
          if (isAllowedShadowProductIntegration(input.repositoryRoot, module.filePath, importPath) ||
              isAllowedComposerProductIntegration(input.repositoryRoot, module.filePath, importPath)) {
            continue;
          }
          violations.push({
            filePath: module.filePath,
            importPath,
            rule: "production_isolation",
            message:
              "Production source outside Context Engine v2 may import only the CE2-07 public shadow facade.",
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
      const isValidationLayer = layer === "validation";
      const isShadowLayer = layer === "shadow";
      const isComposerLayer = layer === "composer";
      if (!isCoreLayer && !isAdapterLayer && !isValidationLayer && !isShadowLayer && !isComposerLayer) {
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
        } else if ((isValidationLayer || isShadowLayer || isComposerLayer) && !importPath.startsWith("node:")) {
          violations.push({
            filePath: module.filePath,
            importPath,
            rule: "adapter_boundary_escape",
            message: "Validation may import only Node.js built-ins and Context Engine v2 boundaries.",
          });
        }
        continue;
      }

      const targetPath = path.resolve(path.dirname(module.filePath), importPath);
      if (!isInside(v2Root, targetPath)) {
        if (isShadowLayer && isAllowedShadowScannerTypeImport(
          input.repositoryRoot,
          v2Root,
          module.filePath,
          reference,
        )) {
          continue;
        }
        if (isComposerLayer && isAllowedComposerScannerTypeImport(
          input.repositoryRoot,
          v2Root,
          module.filePath,
          reference,
        )) {
          continue;
        }
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
        if (isValidationLayer || isShadowLayer || isComposerLayer) {
          violations.push({
            filePath: module.filePath,
            importPath,
            rule: "adapter_boundary_escape",
            message: "Validation cannot import production or legacy source outside Context Engine v2.",
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
