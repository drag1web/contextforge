import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  ProjectInventory,
  ProjectInventoryFile,
} from "../../scanner/projectInventoryScanner.js";
import {
  LegacyInventorySnapshotError,
  adaptLegacyInventoryToRepositorySnapshot,
} from "../adapters/legacyInventory/index.js";
import { createLegacyInventorySnapshotPort } from "../adapters/index.js";
import { validateRepositorySnapshot } from "../domain/index.js";
import type { ClockPort } from "../ports/index.js";
import { FixedClock } from "./fakes.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const projectId = "project-fixture";
const rootUri = "repository://fixture";

class AdvancingClock implements ClockPort {
  private nextIndex = 0;

  constructor(private readonly timestamps: readonly string[]) {}

  nowIso(): string {
    const value = this.timestamps[this.nextIndex];
    if (!value) {
      throw new Error("AdvancingClock fixture is exhausted.");
    }
    this.nextIndex += 1;
    return value;
  }

  monotonicMs(): number {
    return this.nextIndex;
  }
}

function file(
  filePath = "src/feature.ts",
  patch: Partial<ProjectInventoryFile> = {},
): ProjectInventoryFile {
  const name = filePath.split(/[\\/]/).at(-1) ?? filePath;
  return {
    path: filePath,
    name,
    extension: ".ts",
    kind: "source",
    role: "service",
    imports: [],
    exports: ["feature"],
    symbols: ["feature"],
    textHints: ["feature"],
    contentPreview: "export const feature = true;",
    sizeBytes: 28,
    depth: 2,
    canReadText: true,
    isLikelyGenerated: false,
    ...patch,
  };
}

function inventory(
  files: ProjectInventoryFile[] = [file()],
  patch: Partial<ProjectInventory> = {},
): ProjectInventory {
  return {
    rootPath: "C:\\Users\\fixture\\repository",
    files,
    totalFiles: files.length,
    scannedFiles: files.length,
    truncated: false,
    notes: [],
    ...patch,
  };
}

function adapt(
  sourceInventory: ProjectInventory,
  excludedPatterns?: readonly string[],
) {
  return adaptLegacyInventoryToRepositorySnapshot({
    inventory: sourceInventory,
    projectId,
    rootUri,
    createdAt: timestamp,
    excludedPatterns,
  });
}

function withoutTimestamp<T extends { createdAt: string }>(value: T) {
  const { createdAt: _createdAt, ...rest } = value;
  return rest;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStringValues);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(collectStringValues);
  }
  return [];
}

function testMinimalInventoryCreatesValidSnapshot(): void {
  const snapshot = adapt(inventory());
  assert.equal(snapshot.source, "legacy_inventory_adapter");
  assert.equal(snapshot.files.length, 1);
  assert.deepEqual(validateRepositorySnapshot(snapshot), {
    valid: true,
    issues: [],
  });
}

function testIdenticalInventoryIsDeterministic(): void {
  const sourceInventory = inventory();
  const first = adaptLegacyInventoryToRepositorySnapshot({
    inventory: sourceInventory,
    projectId,
    rootUri,
    createdAt: timestamp,
  });
  const second = adaptLegacyInventoryToRepositorySnapshot({
    inventory: structuredClone(sourceInventory),
    projectId,
    rootUri,
    createdAt: "2026-01-02T00:00:00.000Z",
  });
  assert.deepEqual(withoutTimestamp(first), withoutTimestamp(second));
}

function testInputFileOrderDoesNotAffectIdentity(): void {
  const firstFile = file("src/a.ts", { name: "a.ts" });
  const secondFile = file("src/z.ts", { name: "z.ts" });
  const forward = adapt(inventory([firstFile, secondFile]));
  const reverse = adapt(inventory([secondFile, firstFile]));
  assert.equal(forward.id, reverse.id);
  assert.deepEqual(
    forward.files.map((entry) => [entry.normalizedPath, entry.id]),
    reverse.files.map((entry) => [entry.normalizedPath, entry.id]),
  );
  assert.deepEqual(
    forward.files.map((entry) => entry.normalizedPath),
    ["src/a.ts", "src/z.ts"],
  );
}

function testWindowsSeparatorsNormalizeAtBoundary(): void {
  const snapshot = adapt(inventory([file("src\\feature.ts")]));
  assert.equal(snapshot.files[0]?.path, "src/feature.ts");
  assert.equal(snapshot.files[0]?.normalizedPath, "src/feature.ts");
}

function testAbsolutePathInsideRootCanBeContained(): void {
  const snapshot = adapt(
    inventory([file("C:\\Users\\fixture\\repository\\src\\feature.ts")]),
  );
  assert.equal(snapshot.files[0]?.normalizedPath, "src/feature.ts");
}

function testAbsolutePathOutsideRootIsRejected(): void {
  assert.throws(
    () => adapt(inventory([file("D:\\outside\\feature.ts")])),
    (error: unknown) =>
      error instanceof LegacyInventorySnapshotError &&
      error.code === "invalid_legacy_inventory" &&
      error.issues.some((issue) => issue.path === "inventory.files[0].path"),
  );
}

function testDuplicateNormalizedPathsAreRejected(): void {
  assert.throws(
    () =>
      adapt(
        inventory([
          file("src/feature.ts"),
          file("src\\feature.ts", { name: "feature.ts" }),
        ]),
      ),
    (error: unknown) =>
      error instanceof LegacyInventorySnapshotError &&
      error.issues.some((issue) => issue.code === "duplicate"),
  );
}

function testChangedFileStateChangesSnapshotIdentity(): void {
  const before = adapt(inventory());
  const after = adapt(
    inventory([
      file("src/feature.ts", {
        contentPreview: "export const feature = false;",
      }),
    ]),
  );
  assert.notEqual(
    before.files[0]?.contentFingerprint,
    after.files[0]?.contentFingerprint,
  );
  assert.notEqual(before.rootFingerprint, after.rootFingerprint);
  assert.notEqual(before.id, after.id);
}

function testExtensionIsPreserved(): void {
  const snapshot = adapt(
    inventory([file("styles/feature.css", { extension: ".css", kind: "style" })]),
  );
  assert.equal(snapshot.files[0]?.extension, ".css");
  assert.equal(snapshot.files[0]?.kind, "source");
  assert.equal(snapshot.files[0]?.attributes.legacyKind, "style");
}

function testUnavailableLanguageRemainsNull(): void {
  assert.equal(adapt(inventory()).files[0]?.language, null);
}

function testExcludedPatternsAreDeterministic(): void {
  const forward = adapt(inventory(), ["node_modules/**", "dist/**"]);
  const reverse = adapt(inventory(), [
    "dist/**",
    "node_modules/**",
    "dist/**",
  ]);
  assert.deepEqual(forward.limits.excludedPatterns, [
    "dist/**",
    "node_modules/**",
  ]);
  assert.deepEqual(
    forward.limits.excludedPatterns,
    reverse.limits.excludedPatterns,
  );
  assert.equal(forward.id, reverse.id);
}

function testTruncatedInventoryIsReported(): void {
  const snapshot = adapt(inventory(undefined, { truncated: true }));
  assert.equal(snapshot.truncation.truncated, true);
  assert.deepEqual(snapshot.truncation.reasons, ["file_limit"]);
}

function testCompleteInventoryRemainsComplete(): void {
  const snapshot = adapt(inventory());
  assert.deepEqual(snapshot.truncation, {
    truncated: false,
    reasons: [],
  });
}

function testOmittedInventoryPathsAreReported(): void {
  const snapshot = adapt(
    inventory(undefined, { totalFiles: 2, scannedFiles: 1 }),
  );
  assert.equal(snapshot.truncation.truncated, true);
  assert.deepEqual(snapshot.truncation.reasons, ["adapter_limit"]);
  assert.equal(snapshot.truncation.omittedPathCount, 1);
}

function testUnreadableFileIsNotRepresentedAsRead(): void {
  const snapshot = adapt(
    inventory([
      file("assets/blob.bin", {
        extension: ".bin",
        kind: "asset",
        role: "asset",
        contentPreview: undefined,
        canReadText: false,
      }),
    ]),
  );
  assert.equal(snapshot.files[0]?.readable, false);
  assert.equal(snapshot.files[0]?.secretRisk, "possible");
}

function testAdapterRunsDomainValidation(): void {
  assert.throws(
    () =>
      adaptLegacyInventoryToRepositorySnapshot({
        inventory: inventory(),
        projectId,
        rootUri,
        createdAt: "not-a-timestamp",
      }),
    (error: unknown) =>
      error instanceof LegacyInventorySnapshotError &&
      error.issues.some((issue) => issue.path === "snapshot.createdAt"),
  );
}

function testAdapterDoesNotMutateInventory(): void {
  const sourceInventory = inventory([
    file("src/z.ts", { name: "z.ts" }),
    file("src/a.ts", { name: "a.ts" }),
  ]);
  const before = structuredClone(sourceInventory);
  adapt(sourceInventory, ["node_modules/**", "dist/**"]);
  assert.deepEqual(sourceInventory, before);
}

function testSnapshotDoesNotCreateLaterStageRecords(): void {
  const snapshot = adapt(inventory());
  for (const forbiddenField of [
    "facts",
    "evidence",
    "findings",
    "relevance",
    "score",
  ]) {
    assert.equal(forbiddenField in snapshot, false);
    assert.equal(forbiddenField in snapshot.files[0]!, false);
  }
}

function testPhysicalRepositoryRootDoesNotLeak(): void {
  const sourceInventory = inventory();
  const snapshot = adapt(sourceInventory);
  assert.equal(
    collectStringValues(snapshot).some((value) =>
      value.includes(sourceInventory.rootPath),
    ),
    false,
  );
  assert.ok(
    snapshot.files.every(
      (entry) =>
        !path.win32.isAbsolute(entry.path) &&
        !path.posix.isAbsolute(entry.path),
    ),
  );
}

async function testMissingRepositoryRootIsRejected(): Promise<void> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "ce2-missing-root-"));
  try {
    const port = createLegacyInventorySnapshotPort({
      clock: new FixedClock(timestamp),
      repositoryRoot: path.join(parent, "missing"),
    });
    await assert.rejects(
      port.createSnapshot({ projectId, rootUri }),
      (error: unknown) =>
        error instanceof LegacyInventorySnapshotError &&
        error.issues.some(
          (issue) =>
            issue.path === "repositoryRoot" &&
            issue.code === "repository_unavailable",
        ),
    );
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

async function testFileRepositoryRootIsRejected(): Promise<void> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "ce2-file-root-"));
  try {
    const repositoryRoot = path.join(parent, "not-a-directory.txt");
    await fs.writeFile(repositoryRoot, "fixture", "utf8");
    const port = createLegacyInventorySnapshotPort({
      clock: new FixedClock(timestamp),
      repositoryRoot,
    });
    await assert.rejects(
      port.createSnapshot({ projectId, rootUri }),
      (error: unknown) =>
        error instanceof LegacyInventorySnapshotError &&
        error.issues.some(
          (issue) =>
            issue.path === "repositoryRoot" &&
            issue.code === "repository_unavailable",
        ),
    );
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

async function testEmptyRepositoryRootCreatesValidSnapshot(): Promise<void> {
  const repositoryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ce2-empty-root-"),
  );
  try {
    const port = createLegacyInventorySnapshotPort({
      clock: new FixedClock(timestamp),
      repositoryRoot,
    });
    const snapshot = await port.createSnapshot({ projectId, rootUri });
    assert.deepEqual(snapshot.files, []);
    assert.equal(snapshot.truncation.truncated, false);
    assert.deepEqual(validateRepositorySnapshot(snapshot), {
      valid: true,
      issues: [],
    });
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
}

async function testBoundedCoverageMetadataIsTruthful(): Promise<void> {
  const repositoryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ce2-bounded-coverage-"),
  );
  try {
    const deepDirectory = path.join(
      repositoryRoot,
      ...Array.from({ length: 8 }, (_, index) => `level-${index + 1}`),
    );
    await fs.mkdir(deepDirectory, { recursive: true });
    await fs.writeFile(
      path.join(deepDirectory, "hidden.ts"),
      "export const hidden = true;\n",
      "utf8",
    );
    const port = createLegacyInventorySnapshotPort({
      clock: new FixedClock(timestamp),
      repositoryRoot,
    });
    const snapshot = await port.createSnapshot({ projectId, rootUri });
    assert.equal(
      snapshot.files.some((entry) => entry.normalizedPath.endsWith("hidden.ts")),
      false,
    );
    assert.equal(snapshot.truncation.truncated, false);
    assert.equal(snapshot.metadata.legacyInventoryMaxDepth, 7);
    assert.equal(
      snapshot.metadata.legacyInventoryCoverage,
      "best_effort_bounded",
    );
    assert.deepEqual(snapshot.metadata.legacyInventoryKnownLimitations, [
      "deep_path_omissions_unobservable",
      "nested_directory_read_failures_unobservable",
      "truncated_false_means_no_known_scanner_omissions_only",
    ]);
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
}

async function testExistingScannerIntegration(): Promise<void> {
  const repositoryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ce2-snapshot-fixture-"),
  );
  try {
    await fs.mkdir(path.join(repositoryRoot, "src"), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, "docs"), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, "assets"), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, "src", "feature.ts"),
      "export const feature = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(repositoryRoot, "docs", "guide.md"),
      "# Fixture guide\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(repositoryRoot, "assets", "blob.bin"),
      Buffer.from([0, 1, 2, 3]),
    );
    await fs.writeFile(
      path.join(repositoryRoot, ".env"),
      "SESSION_SECRET=fixture-secret-value\n",
      "utf8",
    );

    const port = createLegacyInventorySnapshotPort({
      clock: new AdvancingClock([
        timestamp,
        "2026-01-02T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z",
      ]),
      repositoryRoot,
    });
    const first = await port.createSnapshot({ projectId, rootUri });
    assert.deepEqual(
      first.files.map((entry) => entry.normalizedPath),
      [".env", "assets/blob.bin", "docs/guide.md", "src/feature.ts"],
    );
    assert.equal(first.truncation.truncated, false);
    assert.equal(first.limits.maxFiles, 800);
    assert.ok(first.limits.excludedPatterns.includes("**/node_modules/**"));
    assert.equal(first.metadata.legacyInventoryMaxDepth, 7);
    assert.equal(
      first.files.find((entry) => entry.normalizedPath === "assets/blob.bin")
        ?.readable,
      false,
    );
    assert.equal(
      first.files.find((entry) => entry.normalizedPath === ".env")?.secretRisk,
      "known",
    );
    assert.equal(
      collectStringValues(first).some((value) =>
        value.includes("fixture-secret-value"),
      ),
      false,
    );
    assert.ok(
      first.files.every((entry) =>
        entry.contentFingerprint.startsWith("metadata-sha256:"),
      ),
    );
    assert.equal(first.metadata.fingerprintKind, "metadata_derived");
    assert.deepEqual(await port.getSnapshot(first.id), first);

    const identical = await port.createSnapshot({ projectId, rootUri });
    assert.equal(identical.id, first.id);
    assert.deepEqual(identical, first);
    assert.notStrictEqual(identical, first);
    assert.notStrictEqual(identical.files, first.files);
    const stored = await port.getSnapshot(first.id);
    assert.deepEqual(stored, first);
    assert.notStrictEqual(stored, first);
    assert.notStrictEqual(stored?.files, first.files);

    await fs.writeFile(
      path.join(repositoryRoot, "src", "feature.ts"),
      "export const feature = false;\n",
      "utf8",
    );
    const changed = await port.createSnapshot({ projectId, rootUri });
    assert.notEqual(first.id, changed.id);
    assert.equal(changed.createdAt, "2026-01-03T00:00:00.000Z");
    assert.notEqual(
      first.files.find((entry) => entry.normalizedPath === "src/feature.ts")
        ?.contentFingerprint,
      changed.files.find((entry) => entry.normalizedPath === "src/feature.ts")
        ?.contentFingerprint,
    );
    assert.equal(
      collectStringValues(changed).some((value) =>
        value.includes(repositoryRoot),
      ),
      false,
    );
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  testMinimalInventoryCreatesValidSnapshot();
  testIdenticalInventoryIsDeterministic();
  testInputFileOrderDoesNotAffectIdentity();
  testWindowsSeparatorsNormalizeAtBoundary();
  testAbsolutePathInsideRootCanBeContained();
  testAbsolutePathOutsideRootIsRejected();
  testDuplicateNormalizedPathsAreRejected();
  testChangedFileStateChangesSnapshotIdentity();
  testExtensionIsPreserved();
  testUnavailableLanguageRemainsNull();
  testExcludedPatternsAreDeterministic();
  testTruncatedInventoryIsReported();
  testCompleteInventoryRemainsComplete();
  testOmittedInventoryPathsAreReported();
  testUnreadableFileIsNotRepresentedAsRead();
  testAdapterRunsDomainValidation();
  testAdapterDoesNotMutateInventory();
  testSnapshotDoesNotCreateLaterStageRecords();
  testPhysicalRepositoryRootDoesNotLeak();
  await testMissingRepositoryRootIsRejected();
  await testFileRepositoryRootIsRejected();
  await testEmptyRepositoryRootCreatesValidSnapshot();
  await testBoundedCoverageMetadataIsTruthful();
  await testExistingScannerIntegration();
  console.log("Context Engine v2 snapshot smoke passed: 24 scenarios.");
}

await main();
