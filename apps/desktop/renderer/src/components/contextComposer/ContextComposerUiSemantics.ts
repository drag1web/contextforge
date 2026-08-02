import type {
  ContextComposerFileReference,
  ContextComposerPreview,
} from "../../types";

const KNOWN_ENGINE_REASON_CODES = new Set([
  "legacy_candidate",
  "confirmed_implementation_target",
  "confirmed_test_target",
  "confirmed_supporting_context",
  "explicit_target_eligible",
  "probable_review_only",
  "blocking_gap",
  "blocking_contradiction",
  "negative_constraint",
  "secret_file",
  "generated_target_blocked",
  "unreadable_file",
  "missing_evidence",
  "evidence_entity_mismatch",
  "result_not_safe_to_project",
  "stop_reason_blocks_projection",
  "v2_execution_timeout",
  "v2_execution_error",
  "v2_capacity_exhausted",
  "canonical_input_mismatch",
  "repository_changed",
  "v2_integrity_violation",
  "v2_not_grounded",
]);

export function usesLegacySelectorSemantics(
  preview: Pick<ContextComposerPreview, "contextEngine" | "qualitySource">,
): boolean {
  return !preview.contextEngine ||
    preview.contextEngine.effectiveSource === "legacy" ||
    (preview.qualitySource ?? "legacy_quality") === "legacy_quality";
}

export function getContextComposerFileReasonTranslationKey(
  file: Pick<ContextComposerFileReference, "source" | "engineReasonCode">,
): string | null {
  if (file.source !== "v2" || !file.engineReasonCode) return null;
  const safeCode = KNOWN_ENGINE_REASON_CODES.has(file.engineReasonCode)
    ? file.engineReasonCode
    : "v2_not_grounded";
  return `settings.composerEngineReason_${safeCode}`;
}
