import type { TFunction } from "i18next";

export type SelectorPipelineMode =
  "legacy" | "shadow_compare" | "shadow_primary";

export interface SelectorPipelinePresentationInput {
  requestedMode: SelectorPipelineMode;
  effectivePipeline: "legacy" | "shadow";
  status: "success" | "fallback" | "blocked" | "manual-review";
  executionStatus?: "success" | "fallback";
  selectionOrigin?:
    "pipeline" | "manual_override" | "explicit_target_fast_path";
  fallback?: { code: string; message: string } | null;
}

export const SELECTOR_PIPELINE_MODES: SelectorPipelineMode[] = [
  "legacy",
  "shadow_compare",
  "shadow_primary",
];

const DEFAULT_MODE_COPY: Record<
  SelectorPipelineMode,
  { label: string; description: string }
> = {
  legacy: {
    label: "Legacy",
    description: "Stable current selector. Shadow is not used.",
  },
  shadow_compare: {
    label: "Compare",
    description:
      "Legacy creates the Task Pack while Shadow produces local comparison diagnostics.",
  },
  shadow_primary: {
    label: "Shadow",
    description:
      "The new deterministic selector creates the Task Pack; technical failures fall back to Legacy.",
  },
};

export function getSelectorModeCopy(mode: SelectorPipelineMode, t?: TFunction) {
  if (!t) return DEFAULT_MODE_COPY[mode];
  return {
    label: t(`selectorDiagnostics.modes.${mode}.label`),
    description: t(`selectorDiagnostics.modes.${mode}.description`),
  };
}

function translatedLabel(
  t: TFunction | undefined,
  key: string,
  fallback: string,
  options?: Record<string, unknown>,
) {
  return t ? t(key, options) : fallback;
}

export function getSelectorPipelineLabel(
  diagnostics: SelectorPipelinePresentationInput,
  t?: TFunction,
) {
  const isFallback =
    diagnostics.executionStatus === "fallback" ||
    Boolean(diagnostics.fallback) ||
    diagnostics.status === "fallback";
  let baseLabel: string;

  if (diagnostics.selectionOrigin === "explicit_target_fast_path") {
    baseLabel = translatedLabel(
      t,
      "selectorDiagnostics.badges.targetFastPath",
      "Target fast path",
    );
  } else if (isFallback) {
    baseLabel = translatedLabel(
      t,
      "selectorDiagnostics.badges.legacyFallback",
      "Legacy fallback",
    );
  } else if (diagnostics.requestedMode === "shadow_compare") {
    baseLabel = translatedLabel(
      t,
      "selectorDiagnostics.badges.compareLegacyOutput",
      "Compare · Legacy output",
    );
  } else if (diagnostics.effectivePipeline === "shadow") {
    baseLabel = translatedLabel(
      t,
      "selectorDiagnostics.badges.shadow",
      "Shadow",
    );
  } else {
    baseLabel = translatedLabel(
      t,
      "selectorDiagnostics.badges.legacy",
      "Legacy",
    );
  }

  if (diagnostics.selectionOrigin === "manual_override") {
    return translatedLabel(
      t,
      "selectorDiagnostics.badges.manualSelection",
      `Manual selection · ${baseLabel} suggested`,
      { suggested: baseLabel },
    );
  }

  return baseLabel;
}
