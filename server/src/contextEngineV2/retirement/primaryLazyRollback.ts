import type { TaskPackPrimaryResolution } from "./retirementTypes.js";

/**
 * The product layer may consult legacy exactly once and only for an
 * infrastructure-class primary rollback. Semantic primary outcomes never
 * cross this boundary.
 */
export async function resolveTaskPackPrimaryLazyRollback<T>(input: {
  resolution: TaskPackPrimaryResolution;
  runLegacy(): Promise<T>;
}): Promise<T | null> {
  if (!input.resolution.rollbackEligible || input.resolution.status !== "legacy_rollback") return null;
  return input.runLegacy();
}
