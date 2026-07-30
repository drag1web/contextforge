import type { SelectedTaskFile, TaskFileSelection } from "../../../ollama/taskFileSelector.js";
import { pathMatchesNegativeConstraints } from "../../domain/negativeConstraintMatcher.js";
import { validateRepositorySnapshot } from "../../domain/index.js";
import {
  assertClosedRecord,
  assertPortableIdentifier,
  cloneDomainValue,
  sortedUnique,
  stableCompare,
} from "../../domain/investigationDomainSupport.js";
import type {
  CompatibilityComparisonSummary,
  LegacySelectionSummary,
  OfflineCompatibilityComparison,
  OfflineCompatibilityComparisonInput,
  SafetyComparison,
  V2ProjectionSummary,
} from "./legacyProjectionTypes.js";
import { CompatibilityComparisonError } from "./legacyProjectionTypes.js";

const INPUT_FIELDS = [
  "legacySelection",
  "v2Projection",
  "snapshot",
  "negativeConstraints",
  "explicitTargets",
  "evaluationBasis",
  "v2ExecutionFailed",
] as const;
const OUTCOMES = new Set([
  "equivalent_supported",
  "v2_better_supported",
  "legacy_better_supported",
  "both_safe_unresolved",
  "v2_safe_legacy_risky",
  "legacy_safe_v2_risky",
  "different_but_both_acceptable",
]);

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return sortedUnique(left.filter((value) => rightSet.has(value)));
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return sortedUnique(left.filter((value) => !rightSet.has(value)));
}

function normalizeComparisonPath(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function canonicalComparisonPath(
  value: string,
  input: OfflineCompatibilityComparisonInput,
): string {
  const normalized = normalizeComparisonPath(value);
  return input.snapshot.files.find((file) =>
    normalizeComparisonPath(file.normalizedPath) === normalized)?.normalizedPath ?? normalized;
}

function legacySummary(
  selection: TaskFileSelection,
  input: OfflineCompatibilityComparisonInput,
): LegacySelectionSummary {
  const canonical = (value: string) => canonicalComparisonPath(value, input);
  const editableFiles = selection.selectedFiles
    .filter((file) => file.usage === "inspect-and-edit" || file.usage === "create-and-edit");
  const editablePaths = sortedUnique(editableFiles.map((file) => canonical(file.path)));
  const testPaths = sortedUnique(editableFiles
    .filter((file) => file.kind === "test")
    .map((file) => canonical(file.path)));
  const implementationTargetPaths = sortedUnique(
    editableFiles
      .filter((file) => file.kind !== "test")
      .map((file) => canonical(file.path)),
  );
  const targetPaths = implementationTargetPaths;
  /* Legacy has no explicit target/test role; file kind is the conservative split. */
  const referencePaths = sortedUnique(
    selection.selectedFiles
      .filter((file) => file.usage === "asset-reference" || file.usage === "config-reference")
      .map((file) => canonical(file.path)),
  );
  const supportingPaths = sortedUnique(
    selection.selectedFiles
      .filter((file) => file.usage === "inspect-only")
      .map((file) => canonical(file.path)),
  );
  return {
    selectedPaths: sortedUnique(selection.selectedFiles.map((file) => canonical(file.path))),
    implementationTargetPaths,
    testPaths,
    editablePaths,
    targetPaths,
    supportingPaths,
    referencePaths,
    usedFallback: selection.usedFallback,
    source: selection.source,
  };
}

function v2Summary(input: OfflineCompatibilityComparisonInput): V2ProjectionSummary {
  const decisions = input.v2Projection.decisions.filter((decision) => decision.included && decision.path);
  const targetPaths = sortedUnique(
    decisions.filter((decision) => decision.role === "target")
      .map((decision) => canonicalComparisonPath(decision.path!, input)),
  );
  const testPaths = sortedUnique(
    decisions.filter((decision) => decision.role === "test")
      .map((decision) => canonicalComparisonPath(decision.path!, input)),
  );
  const editablePaths = sortedUnique([...targetPaths, ...testPaths]);
  const supportingPaths = sortedUnique(
    decisions
      .filter((decision) => decision.role === "supporting")
      .map((decision) => canonicalComparisonPath(decision.path!, input)),
  );
  const referencePaths = sortedUnique(
    decisions.filter((decision) => decision.role === "reference")
      .map((decision) => canonicalComparisonPath(decision.path!, input)),
  );
  const selectedPaths = sortedUnique([...editablePaths, ...supportingPaths, ...referencePaths]);
  return {
    snapshotId: input.v2Projection.projection.snapshotId,
    purpose: input.v2Projection.projection.purpose,
    selectedPaths,
    implementationTargetPaths: targetPaths,
    testPaths,
    editablePaths,
    targetPaths,
    supportingPaths,
    referencePaths,
    traceablePaths: sortedUnique(
      decisions
        .filter((decision) => decision.findingIds.length > 0 && decision.evidenceIds.length > 0)
        .map((decision) => canonicalComparisonPath(decision.path!, input)),
    ),
    stopReason: input.v2Projection.source.stopReason,
    safeToProject: input.v2Projection.source.safeToProject,
    blocked: !input.v2Projection.source.safeToProject || editablePaths.length === 0,
  };
}

function repositoryViolations(
  selectedFiles: ReadonlyArray<{ path: string; editable: boolean }>,
  input: OfflineCompatibilityComparisonInput,
): string[] {
  const filesByPath = new Map(
    input.snapshot.files.map((file) => [file.normalizedPath.toLowerCase(), file]),
  );
  return sortedUnique(selectedFiles.flatMap((selected) => {
    const file = filesByPath.get(selected.path.replaceAll("\\", "/").toLowerCase());
    if (!file) return [selected.path];
    return !file.readable || file.secretRisk === "known" || (file.generated && selected.editable)
      ? [file.normalizedPath]
      : [];
  }));
}

function safetyComparison(
  input: OfflineCompatibilityComparisonInput,
  legacy: LegacySelectionSummary,
  v2: V2ProjectionSummary,
): SafetyComparison {
  const legacyNegativeConstraintViolations = legacy.selectedPaths.filter((path) =>
    pathMatchesNegativeConstraints(path, input.negativeConstraints));
  const v2NegativeConstraintViolations = v2.selectedPaths.filter((path) =>
    pathMatchesNegativeConstraints(path, input.negativeConstraints));
  const legacyRepositorySafetyViolations = repositoryViolations(
    input.legacySelection.selectedFiles.map((file) => ({
      path: file.path,
      editable: file.usage === "inspect-and-edit" || file.usage === "create-and-edit",
    })),
    input,
  );
  const v2RepositorySafetyViolations = repositoryViolations(
    input.v2Projection.decisions
      .filter((decision) => decision.included && decision.path)
      .map((decision) => ({
        path: decision.path!,
        editable: decision.role === "target" || decision.role === "test",
      })),
    input,
  );
  const legacySelectionSource = input.legacySelection.diagnostics?.selectionSource;
  const legacyBlocked =
    legacy.editablePaths.length === 0 ||
    legacySelectionSource === "blocked" ||
    legacySelectionSource === "manual-review";
  const v2Blocked =
    !v2.safeToProject ||
    v2.stopReason !== "sufficient_evidence" ||
    (v2.purpose !== "implementation" && v2.purpose !== "legacy_selection") ||
    v2.editablePaths.length === 0;
  return {
    legacyNegativeConstraintViolations: sortedUnique(legacyNegativeConstraintViolations),
    v2NegativeConstraintViolations: sortedUnique(v2NegativeConstraintViolations),
    legacyRepositorySafetyViolations,
    v2RepositorySafetyViolations,
    legacyBlocked,
    v2Blocked,
    safeBlockAgreement: legacyBlocked === v2Blocked,
  };
}

function explicitTargetKey(
  target: OfflineCompatibilityComparisonInput["explicitTargets"][number],
): string {
  return target.kind === "path"
    ? `path:${normalizeComparisonPath(target.path)}`
    : `symbol:${target.symbol}`;
}

function compareExplicitTargets(
  input: OfflineCompatibilityComparisonInput,
  legacy: LegacySelectionSummary,
  v2: V2ProjectionSummary,
): CompatibilityComparisonSummary["explicitTargets"] {
  const unique = new Map(input.explicitTargets.map((target) => [explicitTargetKey(target), target]));
  const uniqueTargets = [...unique.values()];
  const symbolTargetCount = uniqueTargets.filter((target) => target.kind === "symbol").length;
  const pathTargetCount = uniqueTargets.filter((target) => target.kind === "path").length;
  const legacySymbolDiagnosticIsUnambiguous = symbolTargetCount === 1 && pathTargetCount === 0;
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([targetKey, target]) => {
    const targetDiagnostics = input.v2Projection.diagnostics.filter((entry) =>
      entry.targetKey === targetKey &&
      (entry.code === "explicit_target_eligible" ||
        entry.code === "explicit_target_unresolved" ||
        entry.code === "explicit_target_unknown"));
    if (targetDiagnostics.length > 1) throw new Error("duplicate_target_diagnostic");
    const targetDiagnostic = targetDiagnostics[0];
    let resolvedPath: string | undefined;
    let legacyStatus: CompatibilityComparisonSummary["explicitTargets"][number]["legacyStatus"] = "unknown";
    let v2Status: CompatibilityComparisonSummary["explicitTargets"][number]["v2Status"] = "unknown";
    if (target.kind === "path") {
      const normalized = normalizeComparisonPath(target.path);
      const file = input.snapshot.files.find((entry) =>
        normalizeComparisonPath(entry.normalizedPath) === normalized);
      resolvedPath = file?.normalizedPath;
      if (resolvedPath === undefined) {
        legacyStatus = "unknown";
        v2Status = targetDiagnostic?.code === "explicit_target_unresolved"
          ? "unresolved"
          : "unknown";
      } else {
        legacyStatus = legacy.editablePaths.includes(resolvedPath) ? "preserved" : "dropped";
        v2Status = v2.editablePaths.includes(resolvedPath) ? "preserved" : "dropped";
        if (targetDiagnostic?.code === "explicit_target_eligible") v2Status = "preserved";
        if (targetDiagnostic?.code === "explicit_target_unresolved") v2Status = "unresolved";
        if (targetDiagnostic?.code === "explicit_target_unknown") v2Status = "unknown";
      }
    } else {
      const legacyPath = input.legacySelection.diagnostics?.explicitTargetPath;
      if (
        legacySymbolDiagnosticIsUnambiguous &&
        input.legacySelection.diagnostics?.explicitTargetStatus === "matched" &&
        legacyPath !== undefined
      ) {
        resolvedPath = canonicalComparisonPath(legacyPath, input);
        legacyStatus = legacy.editablePaths.includes(resolvedPath) ? "preserved" : "dropped";
      } else if (
        legacySymbolDiagnosticIsUnambiguous &&
        input.legacySelection.diagnostics?.explicitTargetStatus === "unresolved"
      ) {
        legacyStatus = "unresolved";
      }
      if (targetDiagnostic?.path !== undefined) {
        resolvedPath = canonicalComparisonPath(targetDiagnostic.path, input);
      }
      if (targetDiagnostic?.code === "explicit_target_eligible") v2Status = "preserved";
      if (targetDiagnostic?.code === "explicit_target_unresolved") v2Status = "unresolved";
      if (targetDiagnostic?.code === "explicit_target_unknown") v2Status = "unknown";
    }
    return {
      targetKey,
      kind: target.kind,
      ...(resolvedPath === undefined ? {} : { resolvedPath }),
      legacyStatus,
      v2Status,
      disagreement: legacyStatus !== v2Status,
    };
  });
}

function validateInput(raw: OfflineCompatibilityComparisonInput): OfflineCompatibilityComparisonInput {
  const input = cloneDomainValue(raw);
  assertClosedRecord(input, INPUT_FIELDS, [
    "legacySelection",
    "v2Projection",
    "snapshot",
    "negativeConstraints",
    "explicitTargets",
  ], "Offline compatibility comparison input");
  if (!validateRepositorySnapshot(input.snapshot).valid) throw new Error("invalid_snapshot");
  if (input.v2Projection.projection.snapshotId !== input.snapshot.id) throw new Error("snapshot_mismatch");
  if (
    !Array.isArray(input.legacySelection.selectedFiles) ||
    !Array.isArray(input.negativeConstraints) ||
    !Array.isArray(input.explicitTargets)
  ) {
    throw new Error("invalid_arrays");
  }
  if (!Array.isArray(input.v2Projection.diagnostics)) throw new Error("invalid_diagnostics");
  const explicitDiagnosticKeys = new Set<string>();
  input.v2Projection.diagnostics.forEach((diagnostic) => {
    const explicit = diagnostic.code === "explicit_target_eligible" ||
      diagnostic.code === "explicit_target_unresolved" ||
      diagnostic.code === "explicit_target_unknown";
    if (!explicit) return;
    if (
      typeof diagnostic.targetKey !== "string" ||
      (!diagnostic.targetKey.startsWith("path:") &&
        !diagnostic.targetKey.startsWith("symbol:")) ||
      explicitDiagnosticKeys.has(diagnostic.targetKey)
    ) {
      throw new Error("invalid_explicit_target_diagnostic");
    }
    explicitDiagnosticKeys.add(diagnostic.targetKey);
  });
  input.explicitTargets.forEach((target) => {
    if (target.kind === "path") {
      assertClosedRecord(target, ["kind", "path"], ["kind", "path"], "Comparison path target");
      if (typeof target.path !== "string" || target.path.length === 0) throw new Error("invalid_target");
    } else if (target.kind === "symbol") {
      assertClosedRecord(target, ["kind", "symbol"], ["kind", "symbol"], "Comparison symbol target");
      if (typeof target.symbol !== "string" || target.symbol.length === 0) throw new Error("invalid_target");
    } else {
      throw new Error("invalid_target");
    }
  });
  if (input.evaluationBasis) {
    assertClosedRecord(input.evaluationBasis, ["kind", "referenceId", "outcome"], ["kind", "referenceId", "outcome"], "Compatibility evaluation basis");
    assertPortableIdentifier(input.evaluationBasis.referenceId, "Compatibility basis reference id");
    if (
      (input.evaluationBasis.kind !== "manifest" && input.evaluationBasis.kind !== "expert") ||
      !OUTCOMES.has(input.evaluationBasis.outcome)
    ) {
      throw new Error("invalid_evaluation_basis");
    }
  }
  if (input.v2ExecutionFailed !== undefined && typeof input.v2ExecutionFailed !== "boolean") {
    throw new Error("invalid_execution_flag");
  }
  return input;
}

function compareInternal(raw: OfflineCompatibilityComparisonInput): CompatibilityComparisonSummary {
  const input = validateInput(raw);
  const legacy = legacySummary(input.legacySelection, input);
  const v2 = v2Summary(input);
  const safety = safetyComparison(input, legacy, v2);
  const explicitTargets = compareExplicitTargets(input, legacy, v2);
  const output: CompatibilityComparisonSummary = {
    legacy,
    v2,
    overlap: {
      exactTargetPaths: intersection(legacy.targetPaths, v2.targetPaths),
      legacyOnlyTargetPaths: difference(legacy.targetPaths, v2.targetPaths),
      v2OnlyTargetPaths: difference(v2.targetPaths, legacy.targetPaths),
      exactEditablePaths: intersection(legacy.editablePaths, v2.editablePaths),
      legacyOnlyEditablePaths: difference(legacy.editablePaths, v2.editablePaths),
      v2OnlyEditablePaths: difference(v2.editablePaths, legacy.editablePaths),
      supportingOrReferenceOverlap: intersection(
        [...legacy.supportingPaths, ...legacy.referencePaths],
        [...v2.supportingPaths, ...v2.referencePaths],
      ),
      allSelectedOverlap: intersection(legacy.selectedPaths, v2.selectedPaths),
    },
    safety,
    evidence: {
      v2TraceableSelectedPaths: v2.traceablePaths,
      v2UntraceableSelectedPaths: difference(v2.selectedPaths, v2.traceablePaths),
      legacyEvidenceAvailability: "not_evaluated",
    },
    explicitTargets,
    explicitTargetsPreservedByLegacy: explicitTargets
      .filter((target) => target.legacyStatus === "preserved")
      .map((target) => target.targetKey),
    explicitTargetsPreservedByV2: explicitTargets
      .filter((target) => target.v2Status === "preserved")
      .map((target) => target.targetKey),
    explicitTargetDisagreements: explicitTargets
      .filter((target) => target.disagreement)
      .map((target) => target.targetKey),
    outcome: input.v2ExecutionFailed
      ? "v2_execution_failure"
      : input.evaluationBasis?.outcome ?? "insufficient_evaluation_data",
    ...(input.evaluationBasis === undefined ? {} : { evaluationBasis: input.evaluationBasis }),
  };
  return deepFreeze(output);
}

export function createOfflineCompatibilityComparison(): OfflineCompatibilityComparison {
  return {
    compare(input) {
      try {
        return compareInternal(input);
      } catch {
        throw new CompatibilityComparisonError();
      }
    },
  };
}
