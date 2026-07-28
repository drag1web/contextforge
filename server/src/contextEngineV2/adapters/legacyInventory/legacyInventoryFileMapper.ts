import type { ProjectInventoryFile } from "../../../scanner/projectInventoryScanner.js";
import type {
  FileDescriptor,
  FileKind,
  JsonObject,
} from "../../contracts/index.js";
import { normalizeLegacyInventoryPath } from "./legacyInventoryPath.js";
import {
  LEGACY_INVENTORY_ADAPTER_VERSION,
  LEGACY_INVENTORY_HASH_ALGORITHM,
  hashLegacyInventoryValue,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  sortedStrings,
  stableCompare,
  type LegacyInventorySnapshotIssue,
} from "./legacyInventorySupport.js";

const LEGACY_FILE_KINDS = new Set<ProjectInventoryFile["kind"]>([
  "source",
  "style",
  "asset",
  "config",
  "docs",
  "data",
  "test",
  "runtime",
  "unknown",
]);

const LEGACY_FILE_ROLES = new Set<ProjectInventoryFile["role"]>([
  "app-entry",
  "page",
  "layout",
  "component",
  "ui-component",
  "api-route",
  "client-api",
  "server-entry",
  "service",
  "repository",
  "db-schema",
  "store",
  "types",
  "utility",
  "hook",
  "style",
  "config",
  "docs",
  "test",
  "asset",
  "data",
  "runtime",
  "unknown",
]);

export interface MappedLegacyInventoryFile {
  normalizedPath: string;
  extension: string | null;
  language: null;
  kind: FileKind;
  sizeBytes: number;
  contentFingerprint: string;
  readable: boolean;
  generated: boolean;
  secretRisk: FileDescriptor["secretRisk"];
  attributes: JsonObject;
}

function toFileKind(file: ProjectInventoryFile): FileKind {
  if (file.isLikelyGenerated) {
    return "generated";
  }
  switch (file.kind) {
    case "source":
    case "style":
      return "source";
    case "test":
      return "test";
    case "config":
      return "configuration";
    case "docs":
      return "documentation";
    case "asset":
      return "asset";
    case "data":
      return "data";
    case "runtime":
    case "unknown":
      return "unknown";
  }
}

function hasObservedReadableText(file: ProjectInventoryFile): boolean {
  return Boolean(
    file.canReadText &&
      (file.sizeBytes === 0 ||
        file.contentPreview !== undefined ||
        file.semanticFacts !== undefined),
  );
}

function mapSecretRisk(
  normalizedPath: string,
  readable: boolean,
): FileDescriptor["secretRisk"] {
  const fileName = normalizedPath.split("/").at(-1)?.toLowerCase() ?? "";
  if (
    (fileName === ".env" || fileName.startsWith(".env.")) &&
    !fileName.includes("example") &&
    !fileName.includes("sample") &&
    !fileName.includes("template")
  ) {
    return "known";
  }
  return readable ? "none" : "possible";
}

function mapLegacyFile(
  value: unknown,
  index: number,
  repositoryRoot: string,
  issues: LegacyInventorySnapshotIssue[],
): MappedLegacyInventoryFile | null {
  const issuePath = `inventory.files[${index}]`;
  const issueCountBefore = issues.length;
  if (!isRecord(value)) {
    issues.push({
      path: issuePath,
      code: "invalid_type",
      message: "Legacy file descriptor must be an object.",
    });
    return null;
  }
  const file = value as unknown as ProjectInventoryFile;
  if (!isNonEmptyString(file.path)) {
    issues.push({
      path: `${issuePath}.path`,
      code: "required",
      message: "Legacy file path is required.",
    });
    return null;
  }
  const normalizedPath = normalizeLegacyInventoryPath(
    file.path,
    repositoryRoot,
  );
  if (!normalizedPath) {
    issues.push({
      path: `${issuePath}.path`,
      code: "unsafe_path",
      message:
        "Legacy file path must resolve inside the repository and normalize to repository-relative POSIX form.",
    });
    return null;
  }
  if (!isNonEmptyString(file.name)) {
    issues.push({
      path: `${issuePath}.name`,
      code: "required",
      message: "Legacy file name is required.",
    });
  }
  if (typeof file.extension !== "string") {
    issues.push({
      path: `${issuePath}.extension`,
      code: "invalid_type",
      message: "Legacy extension must be a string.",
    });
  }
  if (!LEGACY_FILE_KINDS.has(file.kind)) {
    issues.push({
      path: `${issuePath}.kind`,
      code: "invalid_value",
      message: "Legacy file kind is not supported.",
    });
  }
  if (!LEGACY_FILE_ROLES.has(file.role)) {
    issues.push({
      path: `${issuePath}.role`,
      code: "invalid_value",
      message: "Legacy file role is not supported.",
    });
  }
  if (!isNonNegativeInteger(file.sizeBytes)) {
    issues.push({
      path: `${issuePath}.sizeBytes`,
      code: "invalid_value",
      message: "Legacy file size must be a non-negative integer.",
    });
  }
  if (!isNonNegativeInteger(file.depth)) {
    issues.push({
      path: `${issuePath}.depth`,
      code: "invalid_value",
      message: "Legacy file depth must be a non-negative integer.",
    });
  }
  if (typeof file.canReadText !== "boolean") {
    issues.push({
      path: `${issuePath}.canReadText`,
      code: "invalid_type",
      message: "Legacy text-readability flag must be boolean.",
    });
  }
  if (typeof file.isLikelyGenerated !== "boolean") {
    issues.push({
      path: `${issuePath}.isLikelyGenerated`,
      code: "invalid_type",
      message: "Legacy generated flag must be boolean.",
    });
  }
  if (
    file.contentPreview !== undefined &&
    typeof file.contentPreview !== "string"
  ) {
    issues.push({
      path: `${issuePath}.contentPreview`,
      code: "invalid_type",
      message: "Legacy content preview must be a string when present.",
    });
  }

  const imports = sortedStrings(file.imports, `${issuePath}.imports`, issues);
  const exports = sortedStrings(file.exports, `${issuePath}.exports`, issues);
  const symbols = sortedStrings(file.symbols, `${issuePath}.symbols`, issues);
  const textHints = sortedStrings(
    file.textHints,
    `${issuePath}.textHints`,
    issues,
  );
  if (issues.length > issueCountBefore) {
    return null;
  }

  const readable = hasObservedReadableText(file);
  const fingerprintBasis = JSON.stringify({
    version: LEGACY_INVENTORY_ADAPTER_VERSION,
    normalizedPath,
    name: file.name,
    extension: file.extension,
    kind: file.kind,
    role: file.role,
    imports,
    exports,
    symbols,
    textHints,
    contentPreview: file.contentPreview ?? null,
    sizeBytes: file.sizeBytes,
    depth: file.depth,
    canReadText: file.canReadText,
    isLikelyGenerated: file.isLikelyGenerated,
  });

  return {
    normalizedPath,
    extension: file.extension.length > 0 ? file.extension : null,
    language: null,
    kind: toFileKind(file),
    sizeBytes: file.sizeBytes,
    contentFingerprint: `metadata-sha256:${hashLegacyInventoryValue(
      fingerprintBasis,
    )}`,
    readable,
    generated: file.isLikelyGenerated,
    secretRisk: mapSecretRisk(normalizedPath, readable),
    attributes: {
      legacyKind: file.kind,
      legacyRole: file.role,
      fingerprintKind: "metadata_derived",
      fingerprintAlgorithm: LEGACY_INVENTORY_HASH_ALGORITHM,
    },
  };
}

export function mapLegacyInventoryFiles(
  files: readonly unknown[],
  repositoryRoot: string,
  issues: LegacyInventorySnapshotIssue[],
): MappedLegacyInventoryFile[] {
  const seenPaths = new Set<string>();
  const mappedFiles: MappedLegacyInventoryFile[] = [];
  files.forEach((file, index) => {
    const mapped = mapLegacyFile(file, index, repositoryRoot, issues);
    if (!mapped) {
      return;
    }
    if (seenPaths.has(mapped.normalizedPath)) {
      issues.push({
        path: `inventory.files[${index}].path`,
        code: "duplicate",
        message: "Normalized legacy file paths must be unique.",
      });
      return;
    }
    seenPaths.add(mapped.normalizedPath);
    mappedFiles.push(mapped);
  });
  return mappedFiles.sort((left, right) =>
    stableCompare(left.normalizedPath, right.normalizedPath),
  );
}
