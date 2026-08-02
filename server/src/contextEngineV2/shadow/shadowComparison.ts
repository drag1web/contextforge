import { createHash, randomUUID } from "node:crypto";

import { createOfflineCompatibilityComparison } from "../adapters/legacySelection/index.js";
import type { OfflineCompatibilityComparisonInput } from "../adapters/legacySelection/index.js";
import type { ContextProjectionResult } from "../contracts/projection.js";
import type { RepositorySnapshot } from "../contracts/repository.js";
import type { InvestigationRunnerResult } from "../application/investigationRunnerTypes.js";
import type { ContextEngineShadowCanonicalInput, ContextEngineShadowComparison, ContextEngineShadowIssue, ContextEngineShadowTiming } from "./shadowTypes.js";
import type { ContextEngineShadowExecutionBasis } from "./shadowTypes.js";
import { contextEngineShadowConfigurationFingerprint } from "./shadowExecutionBasis.js";

function summarizeLegacy(selection: OfflineCompatibilityComparisonInput["legacySelection"]): NonNullable<ContextEngineShadowComparison["legacy"]> {
  const selectedPaths = selection.selectedFiles.map((file) => file.path.replace(/\\/gu, "/")).sort();
  const editablePaths = selection.selectedFiles
    .filter((file) => file.usage === "inspect-and-edit" || file.usage === "create-and-edit")
    .map((file) => file.path.replace(/\\/gu, "/")).sort();
  const testPaths = selection.selectedFiles.filter((file) => file.kind === "test")
    .map((file) => file.path.replace(/\\/gu, "/")).sort();
  const implementationTargetPaths = editablePaths.filter((path) => !testPaths.includes(path));
  return {
    selectedPaths,
    implementationTargetPaths,
    testPaths,
    editablePaths,
    targetPaths: implementationTargetPaths,
    supportingPaths: selection.selectedFiles.filter((file) => file.usage === "inspect-only")
      .map((file) => file.path.replace(/\\/gu, "/")).sort(),
    referencePaths: selection.selectedFiles
      .filter((file) => file.usage === "asset-reference" || file.usage === "config-reference")
      .map((file) => file.path.replace(/\\/gu, "/")).sort(),
    usedFallback: selection.usedFallback,
    source: selection.source,
  };
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function confirmedEvidenceMetrics(result: InvestigationRunnerResult): {
  completeness: number | null;
  unsupported: number;
} {
  const evidence = new Map(result.evidence.map((record) => [record.id, record]));
  const confirmed = result.findings.filter((finding) => finding.status === "confirmed");
  if (confirmed.length === 0) return { completeness: null, unsupported: 0 };
  let complete = 0;
  for (const finding of confirmed) {
    const records = finding.evidenceIds.map((id) => evidence.get(id));
    if (
      records.length > 0 && records.every((record) =>
        record !== undefined && record.snapshotId === result.snapshotId &&
        record.role === "supports" && record.freshness.current,
      )
    ) complete += 1;
  }
  return { completeness: complete / confirmed.length, unsupported: confirmed.length - complete };
}

export function createContextEngineShadowComparison(input: {
  canonical: ContextEngineShadowCanonicalInput;
  legacySelection: OfflineCompatibilityComparisonInput["legacySelection"];
  result: InvestigationRunnerResult;
  projection: ContextProjectionResult;
  snapshot: RepositorySnapshot;
  timing: ContextEngineShadowTiming;
  createdAt: string;
}): ContextEngineShadowComparison {
  const summary = createOfflineCompatibilityComparison().compare({
    legacySelection: input.legacySelection,
    v2Projection: input.projection,
    snapshot: input.snapshot,
    negativeConstraints: input.canonical.negativeConstraints,
    explicitTargets: input.canonical.explicitTargets,
  });
  const evidence = confirmedEvidenceMetrics(input.result);
  const issues: ContextEngineShadowIssue[] = [];
  if (!summary.safety.safeBlockAgreement) {
    issues.push({
      code: summary.safety.legacyBlocked ? "v2_safe_legacy_risky" : "legacy_safe_v2_risky",
      severity: "critical",
    });
  }
  if (summary.explicitTargetDisagreements.length > 0) {
    issues.push({ code: "explicit_target_disagreement", severity: "critical" });
  }
  if (summary.safety.legacyNegativeConstraintViolations.length > 0 || summary.safety.v2NegativeConstraintViolations.length > 0) {
    issues.push({ code: "negative_constraint_disagreement", severity: "critical" });
  }
  if (summary.safety.legacyRepositorySafetyViolations.length > 0 || summary.safety.v2RepositorySafetyViolations.length > 0) {
    issues.push({ code: "repository_safety_disagreement", severity: "critical" });
  }
  if (evidence.unsupported > 0) {
    issues.push({ code: "unsupported_confirmed_finding", severity: "critical" });
  }
  const openBlockingGapCount = input.result.knowledgeGaps.filter((gap) => gap.status === "open" && gap.blocks.length > 0).length;
  const openContradictionCount = input.result.contradictions.filter((record) => record.status === "open" && record.severity === "blocking").length;
  if (input.result.safeToProject && (openBlockingGapCount > 0 || openContradictionCount > 0)) {
    issues.push({ code: "blocking_state_incoherent", severity: "critical" });
  }
  const comparisonId = `shadow-${randomUUID()}`;
  return {
    schemaVersion: 1,
    comparisonId,
    projectId: input.canonical.projectId,
    taskFingerprint: input.canonical.taskFingerprint,
    clarificationFingerprint: input.canonical.clarificationFingerprint,
    inventoryFingerprint: input.canonical.inventoryFingerprint,
    snapshotFingerprint: input.canonical.snapshotFingerprint,
    configurationFingerprint: input.canonical.configurationFingerprint,
    status: "completed",
    legacy: summary.legacy,
    v2: summary.v2,
    overlap: summary.overlap,
    safety: summary.safety,
    evidence: summary.evidence,
    explicitTargets: summary.explicitTargets,
    manualReviewAgreement:
      (input.legacySelection.diagnostics?.selectionSource === "manual-review" || summary.safety.legacyBlocked) ===
      (input.result.stop.reason === "clarification_required" || summary.safety.v2Blocked),
    outcome: summary.outcome,
    stopReason: input.result.stop.reason,
    safeToProject: input.result.safeToProject,
    openBlockingGapCount,
    openContradictionCount,
    unsupportedConfirmedFindingCount: evidence.unsupported,
    confirmedFindingEvidenceCompleteness: evidence.completeness,
    budgetUsage: {
      operations: input.result.budgetState.usage.operations,
      fileReads: input.result.budgetState.usage.fileReads,
      fileBytes: input.result.budgetState.usage.fileBytes,
      parsedFiles: input.result.budgetState.usage.parsedFiles,
      relationshipHops: input.result.budgetState.usage.relationshipHops,
      plannerRounds: input.result.budgetState.usage.plannerRounds,
    },
    issues: issues.sort((left, right) => left.code.localeCompare(right.code)),
    timing: input.timing,
    createdAt: input.createdAt,
  };
}

export function createFailedContextEngineShadowComparison(input: {
  canonical: ContextEngineShadowCanonicalInput;
  legacySelection: OfflineCompatibilityComparisonInput["legacySelection"];
  status: Exclude<ContextEngineShadowComparison["status"], "completed">;
  issue: ContextEngineShadowIssue["code"];
  timing: ContextEngineShadowTiming;
  createdAt: string;
}): ContextEngineShadowComparison {
  return {
    schemaVersion: 1,
    comparisonId: `shadow-${randomUUID()}`,
    projectId: input.canonical.projectId,
    taskFingerprint: input.canonical.taskFingerprint,
    clarificationFingerprint: input.canonical.clarificationFingerprint,
    inventoryFingerprint: input.canonical.inventoryFingerprint,
    snapshotFingerprint: input.canonical.snapshotFingerprint,
    configurationFingerprint: input.canonical.configurationFingerprint,
    status: input.status,
    legacy: summarizeLegacy(input.legacySelection),
    v2: null,
    overlap: null,
    safety: null,
    evidence: null,
    explicitTargets: [],
    manualReviewAgreement: null,
    outcome: "v2_execution_failure",
    stopReason: null,
    safeToProject: null,
    openBlockingGapCount: 0,
    openContradictionCount: 0,
    unsupportedConfirmedFindingCount: 0,
    confirmedFindingEvidenceCompleteness: null,
    budgetUsage: null,
    issues: [{ code: input.issue, severity: "critical" }],
    timing: input.timing,
    createdAt: input.createdAt,
  };
}

export function createContextEngineShadowPreparationFailure(input: {
  projectId: string;
  normalizedTask: string;
  inventoryBasis: readonly { path: string; sizeBytes: number }[];
  legacySelection: OfflineCompatibilityComparisonInput["legacySelection"];
  executionBasis: ContextEngineShadowExecutionBasis;
  createdAt: string;
}): ContextEngineShadowComparison {
  const timing: ContextEngineShadowTiming = {
    legacyMs: Math.max(0, input.legacySelection.durationMs),
    v2Ms: 0,
    comparisonMs: 0,
    persistenceMs: null,
    totalShadowOverheadMs: 0,
    timeoutCeilingMs: input.executionBasis.policy.timeoutMs,
  };
  return {
    schemaVersion: 1,
    comparisonId: `shadow-${randomUUID()}`,
    projectId: input.projectId,
    taskFingerprint: hash(input.normalizedTask.replace(/\r\n/gu, "\n").trim()),
    clarificationFingerprint: hash("unavailable"),
    inventoryFingerprint: hash(JSON.stringify([...input.inventoryBasis].sort((left, right) => left.path.localeCompare(right.path)))),
    snapshotFingerprint: hash("unavailable"),
    configurationFingerprint: contextEngineShadowConfigurationFingerprint(input.executionBasis),
    status: "input_mismatch",
    legacy: summarizeLegacy(input.legacySelection),
    v2: null,
    overlap: null,
    safety: null,
    evidence: null,
    explicitTargets: [],
    manualReviewAgreement: null,
    outcome: "v2_execution_failure",
    stopReason: null,
    safeToProject: null,
    openBlockingGapCount: 0,
    openContradictionCount: 0,
    unsupportedConfirmedFindingCount: 0,
    confirmedFindingEvidenceCompleteness: null,
    budgetUsage: null,
    issues: [{ code: "canonical_input_mismatch", severity: "critical" }],
    timing,
    createdAt: input.createdAt,
  };
}
