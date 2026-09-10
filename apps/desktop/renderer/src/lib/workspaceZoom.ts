export const WORKSPACE_ZOOM_MIN = 0.75;
export const WORKSPACE_ZOOM_MAX = 1.5;
export const WORKSPACE_ZOOM_STEP = 0.05;
export const WORKSPACE_ZOOM_DEFAULT = 1;

const WORKSPACE_ZOOM_STORAGE_KEY = "contextforge.workspaceZoom.v1";

export interface WorkspaceZoomStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface WorkspaceZoomBridge {
  getFactor?: () => number;
  setFactor?: (factor: number) => number;
}

function roundZoom(value: number) {
  return Math.round(value * 100) / 100;
}

export function clampWorkspaceZoom(value: number) {
  return roundZoom(
    Math.min(WORKSPACE_ZOOM_MAX, Math.max(WORKSPACE_ZOOM_MIN, value)),
  );
}

export function sanitizeWorkspaceZoom(value: unknown) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return WORKSPACE_ZOOM_DEFAULT;
  }

  const stepped =
    Math.round(numericValue / WORKSPACE_ZOOM_STEP) * WORKSPACE_ZOOM_STEP;
  return clampWorkspaceZoom(stepped);
}

export function stepWorkspaceZoom(current: number, direction: -1 | 1) {
  return clampWorkspaceZoom(current + direction * WORKSPACE_ZOOM_STEP);
}

export function resetWorkspaceZoom() {
  return WORKSPACE_ZOOM_DEFAULT;
}

export function workspaceZoomPercent(factor: number) {
  return Math.round(clampWorkspaceZoom(factor) * 100);
}

export function readStoredWorkspaceZoom(
  storage: WorkspaceZoomStorage | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
) {
  if (!storage) return WORKSPACE_ZOOM_DEFAULT;

  try {
    return sanitizeWorkspaceZoom(storage.getItem(WORKSPACE_ZOOM_STORAGE_KEY));
  } catch {
    return WORKSPACE_ZOOM_DEFAULT;
  }
}

export function storeWorkspaceZoom(
  factor: number,
  storage: WorkspaceZoomStorage | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
) {
  const safeFactor = sanitizeWorkspaceZoom(factor);
  if (!storage) return safeFactor;

  try {
    storage.setItem(WORKSPACE_ZOOM_STORAGE_KEY, String(safeFactor));
  } catch {
    // Zoom persistence is a local presentation preference and may fail silent.
  }

  return safeFactor;
}

function getWorkspaceZoomBridge(): WorkspaceZoomBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.contextforge?.workspaceZoom;
}

export function applyWorkspaceZoom(factor: number) {
  const safeFactor = clampWorkspaceZoom(factor);

  try {
    const appliedFactor =
      getWorkspaceZoomBridge()?.setFactor?.(safeFactor) ?? safeFactor;
    return typeof appliedFactor === "number" && Number.isFinite(appliedFactor)
      ? clampWorkspaceZoom(appliedFactor)
      : safeFactor;
  } catch {
    return safeFactor;
  }
}

export function initializeWorkspaceZoom() {
  const factor = readStoredWorkspaceZoom();
  applyWorkspaceZoom(factor);
  return factor;
}
