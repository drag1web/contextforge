import type { ProjectInventory } from "../../../scanner/projectInventoryScanner.js";
import type {
  EntityId,
  FileDescriptor,
  RepositorySnapshot,
  SnapshotId,
  SnapshotTruncationReason,
} from "../../contracts/index.js";
import { validateRepositorySnapshot } from "../../domain/index.js";
import { mapLegacyInventoryFiles } from "./legacyInventoryFileMapper.js";
import {
  LEGACY_INVENTORY_ADAPTER_VERSION,
  LEGACY_INVENTORY_COVERAGE_LIMITATIONS,
  LEGACY_INVENTORY_HASH_ALGORITHM,
  LEGACY_INVENTORY_MAX_DEPTH,
  LegacyInventorySnapshotError,
  hashLegacyInventoryValue,
  isDenseArray,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  isSafeRepositoryUri,
  normalizeExcludedPatterns,
  sortedStrings,
  stableCompare,
  type LegacyInventorySnapshotIssue,
} from "./legacyInventorySupport.js";

export interface LegacyInventorySnapshotInput {
  inventory: ProjectInventory;
  projectId: string;
  rootUri: string;
  createdAt: string;
  excludedPatterns?: readonly string[];
  maxFiles?: number;
  maxDepth?: number;
}

function collectInventoryIssues(
  input: LegacyInventorySnapshotInput,
  inventory: ProjectInventory,
): LegacyInventorySnapshotIssue[] {
  const issues: LegacyInventorySnapshotIssue[] = [];
  if (!isNonEmptyString(input.projectId)) {
    issues.push({
      path: "projectId",
      code: "required",
      message: "Project identity is required.",
    });
  }
  if (!isSafeRepositoryUri(input.rootUri)) {
    issues.push({
      path: "rootUri",
      code: "unsafe_path",
      message:
        "Repository URI must be a logical repository:// identity without a local path.",
    });
  }
  for (const [field, value] of [
    ["maxFiles", input.maxFiles],
    ["maxDepth", input.maxDepth],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      issues.push({
        path: field,
        code: "invalid_value",
        message: "Legacy scanner limits must be positive integers.",
      });
    }
  }
  if (!isNonEmptyString(inventory.rootPath)) {
    issues.push({
      path: "inventory.rootPath",
      code: "required",
      message: "Legacy repository root is required for path containment.",
    });
  }
  if (!isDenseArray(inventory.files)) {
    issues.push({
      path: "inventory.files",
      code: "invalid_type",
      message: "Legacy inventory files must be a dense array.",
    });
  }
  if (!isNonNegativeInteger(inventory.totalFiles)) {
    issues.push({
      path: "inventory.totalFiles",
      code: "invalid_value",
      message: "Legacy totalFiles must be a non-negative integer.",
    });
  }
  if (!isNonNegativeInteger(inventory.scannedFiles)) {
    issues.push({
      path: "inventory.scannedFiles",
      code: "invalid_value",
      message: "Legacy scannedFiles must be a non-negative integer.",
    });
  }
  if (typeof inventory.truncated !== "boolean") {
    issues.push({
      path: "inventory.truncated",
      code: "invalid_type",
      message: "Legacy truncated flag must be boolean.",
    });
  }
  sortedStrings(inventory.notes, "inventory.notes", issues);

  if (
    isDenseArray(inventory.files) &&
    isNonNegativeInteger(inventory.scannedFiles) &&
    inventory.scannedFiles !== inventory.files.length
  ) {
    issues.push({
      path: "inventory.scannedFiles",
      code: "invalid_value",
      message: "Legacy scannedFiles must equal the number of inventory files.",
    });
  }
  if (
    isNonNegativeInteger(inventory.totalFiles) &&
    isNonNegativeInteger(inventory.scannedFiles) &&
    inventory.totalFiles < inventory.scannedFiles
  ) {
    issues.push({
      path: "inventory.totalFiles",
      code: "invalid_value",
      message: "Legacy totalFiles cannot be lower than scannedFiles.",
    });
  }
  return issues;
}

export function adaptLegacyInventoryToRepositorySnapshot(
  input: LegacyInventorySnapshotInput,
): RepositorySnapshot {
  if (!isRecord(input.inventory)) {
    throw new LegacyInventorySnapshotError([
      {
        path: "inventory",
        code: "invalid_type",
        message: "Legacy inventory must be an object.",
      },
    ]);
  }
  const inventory = input.inventory;
  const issues = collectInventoryIssues(input, inventory);
  const excludedPatterns = normalizeExcludedPatterns(
    input.excludedPatterns,
    issues,
  );
  const mappedFiles = isDenseArray(inventory.files)
    ? mapLegacyInventoryFiles(inventory.files, inventory.rootPath, issues)
    : [];
  if (issues.length > 0) {
    throw new LegacyInventorySnapshotError(issues);
  }
  const maxDepth = input.maxDepth ?? LEGACY_INVENTORY_MAX_DEPTH;

  const omittedPathCount = Math.max(
    inventory.totalFiles - inventory.scannedFiles,
    0,
  );
  const truncationReasons: SnapshotTruncationReason[] = [];
  if (omittedPathCount > 0) {
    truncationReasons.push("adapter_limit");
  }
  if (inventory.truncated) {
    truncationReasons.push("file_limit");
  }
  truncationReasons.sort(stableCompare);
  const truncated = truncationReasons.length > 0;

  const rootFingerprint = `inventory-metadata-sha256:${hashLegacyInventoryValue(
    JSON.stringify({
      version: LEGACY_INVENTORY_ADAPTER_VERSION,
      files: mappedFiles.map((file) => ({
        path: file.normalizedPath,
        fingerprint: file.contentFingerprint,
        sizeBytes: file.sizeBytes,
        readable: file.readable,
        generated: file.generated,
      })),
      excludedPatterns,
      maxFiles: input.maxFiles ?? null,
      maxDepth,
      truncated,
      truncationReasons,
      omittedPathCount,
    }),
  )}`;
  const snapshotId = `snapshot_${hashLegacyInventoryValue(
    `${LEGACY_INVENTORY_ADAPTER_VERSION}\0${input.projectId}\0${input.rootUri}\0${rootFingerprint}`,
  )}` as SnapshotId;

  const files: FileDescriptor[] = mappedFiles.map((file) => ({
    id: `file_${hashLegacyInventoryValue(
      `${snapshotId}\0${file.normalizedPath}`,
    )}` as EntityId,
    snapshotId,
    path: file.normalizedPath,
    normalizedPath: file.normalizedPath,
    extension: file.extension,
    language: file.language,
    kind: file.kind,
    sizeBytes: file.sizeBytes,
    contentFingerprint: file.contentFingerprint,
    readable: file.readable,
    generated: file.generated,
    secretRisk: file.secretRisk,
    attributes: file.attributes,
  }));

  const snapshot: RepositorySnapshot = {
    id: snapshotId,
    projectId: input.projectId,
    rootUri: input.rootUri,
    rootFingerprint,
    createdAt: input.createdAt,
    source: "legacy_inventory_adapter",
    files,
    limits: {
      excludedPatterns,
      ...(input.maxFiles !== undefined ? { maxFiles: input.maxFiles } : {}),
    },
    truncation: {
      truncated,
      reasons: truncationReasons,
      ...(omittedPathCount > 0 ? { omittedPathCount } : {}),
    },
    metadata: {
      adapterVersion: LEGACY_INVENTORY_ADAPTER_VERSION,
      fingerprintKind: "metadata_derived",
      fingerprintAlgorithm: LEGACY_INVENTORY_HASH_ALGORITHM,
      legacyInventoryTotalFiles: inventory.totalFiles,
      legacyInventoryScannedFiles: inventory.scannedFiles,
      legacyInventoryMaxDepth: maxDepth,
      legacyInventoryCoverage: "best_effort_bounded",
      legacyInventoryKnownLimitations: [
        ...LEGACY_INVENTORY_COVERAGE_LIMITATIONS,
      ],
      languageMetadataAvailable: false,
    },
  };

  const validation = validateRepositorySnapshot(snapshot);
  if (!validation.valid) {
    throw new LegacyInventorySnapshotError(validation.issues);
  }
  return snapshot;
}
