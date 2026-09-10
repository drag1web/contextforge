export type WorkspaceDensityPreference =
  | "adaptive"
  | "comfortable"
  | "compact";

export type ResolvedWorkspaceDensity =
  | "comfortable"
  | "balanced"
  | "compact";

export interface ResolveWorkspaceDensityInput {
  preference: WorkspaceDensityPreference;
  isWorkflowSurface: boolean;
  isFocusModeActive: boolean;
  hasAuxiliaryWorkspace: boolean;
}

export function resolveWorkspaceDensity({
  preference,
  isWorkflowSurface,
  isFocusModeActive,
  hasAuxiliaryWorkspace,
}: ResolveWorkspaceDensityInput): ResolvedWorkspaceDensity {
  if (preference === "comfortable") {
    return "comfortable";
  }

  if (preference === "compact") {
    return "compact";
  }

  if (
    isFocusModeActive ||
    (isWorkflowSurface && hasAuxiliaryWorkspace)
  ) {
    return "compact";
  }

  if (isWorkflowSurface) {
    return "balanced";
  }

  return "comfortable";
}

export function getWorkspaceDensityPadding(
  density: ResolvedWorkspaceDensity,
  isFocusModeActive: boolean,
): number {
  if (density === "compact") {
    return isFocusModeActive ? 12 : 16;
  }

  if (density === "balanced") {
    return isFocusModeActive ? 16 : 22;
  }

  return isFocusModeActive ? 20 : 28;
}
