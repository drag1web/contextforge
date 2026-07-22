import type {
  SelectedTaskFile,
  TaskFileSelection,
} from "../ollama/taskFileSelector.js";
import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type {
  TaskExecutionAuthorization,
  TaskExecutionContract,
} from "../taskPacks/taskExecutionContract.js";
import type { ProjectInventory } from "../scanner/projectInventoryScanner.js";
import type { ContextSelectionQualityStatus } from "./contextQuality.js";
import {
  extractClassifiedFileMentions,
  isExplicitFileCreationForbidden,
  resolveCreationForbiddenMissingPaths,
} from "./explicitFileMentions.js";
import { detectHardTaskSafetyIssue, isSecretLikePath } from "./safetyPolicy.js";

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "").trim().toLowerCase();
}

function basename(value: string) {
  const normalized = normalizePath(value);
  return normalized.split("/").pop() ?? normalized;
}

function uniqueStrings(values: string[], limit = values.length) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = String(rawValue ?? "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function collectProtectedMentionKeys(
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
) {
  const mentions = [
    ...extractClassifiedFileMentions(rawTask).filter(
      (mention) => mention.role === "artifact-reference",
    ),
    ...(taskIntent?.structuredIntent.protectedScopes ?? []).flatMap((scope) =>
      extractClassifiedFileMentions(scope),
    ),
  ];

  return {
    paths: new Set(mentions.map((mention) => normalizePath(mention.path))),
    basenames: new Set(
      mentions
        .map((mention) => normalizePath(mention.path))
        .filter((mentionPath) => !mentionPath.includes("/"))
        .map((mentionPath) => basename(mentionPath)),
    ),
  };
}

function isExplicitlyProtectedPath(
  path: string,
  protectedMentions: ReturnType<typeof collectProtectedMentionKeys>,
) {
  const normalized = normalizePath(path);
  return (
    protectedMentions.paths.has(normalized) ||
    [...protectedMentions.paths].some(
      (protectedPath) =>
        normalized.endsWith(`/${protectedPath}`) ||
        protectedPath.endsWith(`/${normalized}`),
    ) ||
    protectedMentions.basenames.has(basename(normalized))
  );
}

function downgradeToInspectOnly(
  file: SelectedTaskFile,
  reason: string,
): SelectedTaskFile {
  const existingEvidence = file.selectionEvidence;
  return {
    ...file,
    usage:
      file.usage === "asset-reference" || file.usage === "config-reference"
        ? file.usage
        : "inspect-only",
    reason: uniqueStrings([file.reason, reason], 3).join(" "),
    confidence: Math.min(file.confidence, 0.78),
    selectionEvidence: existingEvidence
      ? {
          ...existingEvidence,
          actionConfidence: "inspect_only",
          negativeConstraintConflicts: uniqueStrings([
            ...existingEvidence.negativeConstraintConflicts,
            reason,
          ]),
          reason: uniqueStrings([existingEvidence.reason, reason], 3).join(" "),
        }
      : existingEvidence,
  };
}

function safeAuthorization(
  existing: TaskExecutionAuthorization | undefined,
  authorizedTargets: string[],
): TaskExecutionAuthorization | undefined {
  if (!existing) return undefined;
  const confirmed = authorizedTargets.length > 0;
  return {
    ...existing,
    scopeConfirmed: confirmed ? existing.scopeConfirmed : false,
    scopeConfirmationSource: confirmed
      ? existing.scopeConfirmationSource
      : "none",
    targetAuthorization: confirmed ? "confirmed" : "unconfirmed",
    authorizedTargets,
  };
}

function revokeImplementation(
  contract: TaskExecutionContract,
  selectedFiles: SelectedTaskFile[],
  reasons: string[],
  hardBlock: boolean,
): TaskExecutionContract {
  const safeSelectedPaths = selectedFiles.map((file) => file.path);
  const targetEvidence = contract.targetEvidence
    .filter((item) => !hardBlock || !item.path || !isSecretLikePath(item.path))
    .map((item) => ({
      ...item,
      confirmedForImplementation: false,
      reason: uniqueStrings([...reasons, item.reason], 3).join(" "),
    }));

  return {
    ...contract,
    mode: "investigation",
    confirmedTargets: [],
    proposedTargets: hardBlock
      ? []
      : uniqueStrings([
          ...contract.proposedTargets,
          ...safeSelectedPaths,
        ]),
    targetEvidence,
    allowImplementationGuidance: false,
    implementationGateReasons: uniqueStrings([
      ...contract.implementationGateReasons,
      ...reasons,
    ]),
    reasons: uniqueStrings([
      "Execution mode: investigation.",
      ...reasons,
      ...contract.reasons,
    ], 18),
    authorization: safeAuthorization(contract.authorization, []),
  };
}

export interface ExecutionAuthorizationAuthorityInput {
  rawTask: string;
  inventory?: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
  fileSelection: TaskFileSelection;
  qualityStatus: ContextSelectionQualityStatus;
  qualityBlockingReasons?: string[];
}

/**
 * Final monotonic authority over edit authorization.
 *
 * This layer may only preserve or reduce permissions. It never turns a model,
 * rank, or inspect-only proposal into an editable target. Hard safety,
 * explicit protected references, selection evidence, and context quality are
 * applied after every upstream selection/refinement decision so downstream
 * composer/export code cannot restore revoked permissions.
 */
export function enforceExecutionAuthorizationAuthority(
  input: ExecutionAuthorizationAuthorityInput,
): TaskFileSelection {
  const existingDiagnostics = input.fileSelection.diagnostics;
  const existingContract = existingDiagnostics?.executionContract;
  if (!existingDiagnostics || !existingContract) return input.fileSelection;

  const hardSafety = detectHardTaskSafetyIssue(input.rawTask);
  const protectedMentions = collectProtectedMentionKeys(
    input.rawTask,
    input.taskIntent,
  );
  const authorityNotes: string[] = [];

  const nonSecretFiles = input.fileSelection.selectedFiles.filter((file) => {
    if (!isSecretLikePath(file.path)) return true;
    authorityNotes.push(
      `Final authorization authority removed secret-like path ${file.path}.`,
    );
    return false;
  });

  const creationSafeFiles = nonSecretFiles.filter((file) => {
    if (
      file.usage !== "create-and-edit" ||
      !isExplicitFileCreationForbidden(input.rawTask, file.path)
    ) {
      return true;
    }
    authorityNotes.push(
      `Final authorization authority removed creation-forbidden synthetic target ${file.path}.`,
    );
    return false;
  });

  const constrainedFiles = creationSafeFiles.map((file) => {
    const evidenceProtected = Boolean(
      file.selectionEvidence?.negativeConstraintConflicts.length,
    );
    const explicitlyProtected = isExplicitlyProtectedPath(
      file.path,
      protectedMentions,
    );
    if (!evidenceProtected && !explicitlyProtected) return file;

    authorityNotes.push(
      `Final authorization authority kept protected path ${file.path} inspect-only.`,
    );
    return downgradeToInspectOnly(
      file,
      "Explicit user protection/reference-only evidence forbids edit authorization.",
    );
  });

  if (hardSafety.blocked) {
    const reasons = uniqueStrings([
      ...hardSafety.reasons,
      "Hard safety is final authority over selection and edit authorization.",
    ]);
    const contract = revokeImplementation(existingContract, [], reasons, true);
    return {
      ...input.fileSelection,
      selectedFiles: [],
      notes: uniqueStrings([
        ...input.fileSelection.notes,
        ...authorityNotes,
        ...reasons,
      ]),
      diagnostics: {
        ...existingDiagnostics,
        selectionSource: "blocked",
        executionMode: "investigation",
        implementationGateReasons: contract.implementationGateReasons,
        executionContract: contract,
      },
    };
  }

  const creationForbiddenMissingPaths = input.inventory
    ? resolveCreationForbiddenMissingPaths(input.rawTask, input.inventory)
    : [];

  if (creationForbiddenMissingPaths.length > 0) {
    const reasons = uniqueStrings([
      "The explicitly named target is missing from the real project inventory.",
      "The user explicitly forbade creating the missing target, so no existing fallback or similar file may be substituted.",
      `Creation-forbidden missing path(s): ${creationForbiddenMissingPaths.join(", ")}.`,
    ]);
    const contract = revokeImplementation(existingContract, [], reasons, false);
    return {
      ...input.fileSelection,
      selectedFiles: [],
      rejectedModelPaths: uniqueStrings([
        ...input.fileSelection.rejectedModelPaths,
        ...creationForbiddenMissingPaths,
      ]),
      notes: uniqueStrings([
        ...input.fileSelection.notes,
        ...authorityNotes,
        ...reasons,
      ]),
      diagnostics: {
        ...existingDiagnostics,
        selectionSource: "manual-review",
        executionMode: "investigation",
        implementationGateReasons: contract.implementationGateReasons,
        executionContract: contract,
      },
    };
  }

  if (input.qualityStatus === "blocked") {
    const reasons = uniqueStrings([
      ...(input.qualityBlockingReasons ?? []),
      "Blocked context quality revokes all implementation authorization.",
    ]);
    const inspectOnlyFiles = constrainedFiles.map((file) =>
      downgradeToInspectOnly(file, reasons[0]!),
    );
    const contract = revokeImplementation(
      existingContract,
      inspectOnlyFiles,
      reasons,
      false,
    );
    return {
      ...input.fileSelection,
      selectedFiles: inspectOnlyFiles,
      notes: uniqueStrings([
        ...input.fileSelection.notes,
        ...authorityNotes,
        ...reasons,
      ]),
      diagnostics: {
        ...existingDiagnostics,
        selectionSource: "blocked",
        executionMode: "investigation",
        implementationGateReasons: contract.implementationGateReasons,
        executionContract: contract,
      },
    };
  }

  const editableSelectedPaths = new Set(
    constrainedFiles
      .filter(
        (file) =>
          file.usage === "inspect-and-edit" || file.usage === "create-and-edit",
      )
      .map((file) => normalizePath(file.path)),
  );
  const existingAuthorizedTargets =
    existingContract.authorization?.authorizedTargets ?? [];
  const authorizedTargets =
    existingContract.mode === "implementation"
      ? existingAuthorizedTargets.filter((target) =>
          editableSelectedPaths.has(normalizePath(target)),
        )
      : [];

  const removedAuthorization = existingAuthorizedTargets.filter(
    (target) => !authorizedTargets.includes(target),
  );
  if (removedAuthorization.length > 0) {
    authorityNotes.push(
      `Final authorization authority revoked ${removedAuthorization.length} stale, protected, secret-like, or non-editable target(s).`,
    );
  }

  if (
    existingContract.mode !== "implementation" ||
    authorizedTargets.length === 0
  ) {
    const reasons = uniqueStrings([
      ...authorityNotes,
      existingContract.mode !== "implementation"
        ? "Non-implementation execution mode cannot authorize edits."
        : "No previously authorized target remains editable after final authority checks.",
    ]);
    const inspectOnlyFiles = constrainedFiles.map((file) =>
      downgradeToInspectOnly(file, reasons[reasons.length - 1]!),
    );
    const contract = revokeImplementation(
      existingContract,
      inspectOnlyFiles,
      reasons,
      false,
    );
    return {
      ...input.fileSelection,
      selectedFiles: inspectOnlyFiles,
      notes: uniqueStrings([...input.fileSelection.notes, ...reasons]),
      diagnostics: {
        ...existingDiagnostics,
        executionMode: "investigation",
        implementationGateReasons: contract.implementationGateReasons,
        executionContract: contract,
      },
    };
  }

  const contract: TaskExecutionContract = {
    ...existingContract,
    confirmedTargets: existingContract.confirmedTargets.filter((target) =>
      authorizedTargets.some(
        (authorized) => normalizePath(authorized) === normalizePath(target),
      ),
    ),
    targetEvidence: existingContract.targetEvidence.map((item) => ({
      ...item,
      confirmedForImplementation: Boolean(
        item.path &&
          authorizedTargets.some(
            (authorized) => normalizePath(authorized) === normalizePath(item.path!),
          ),
      ),
    })),
    authorization: safeAuthorization(
      existingContract.authorization,
      authorizedTargets,
    ),
    reasons: uniqueStrings([
      ...existingContract.reasons,
      ...authorityNotes,
      `Final authority preserved ${authorizedTargets.length} previously authorized editable target(s).`,
    ], 18),
  };

  return {
    ...input.fileSelection,
    selectedFiles: constrainedFiles,
    notes: uniqueStrings([
      ...input.fileSelection.notes,
      ...authorityNotes,
    ]),
    diagnostics: {
      ...existingDiagnostics,
      executionMode: contract.mode,
      executionContract: contract,
    },
  };
}
