export interface ModelPlannerPolicy {
  schemaVersion: 1;
  maxTaskChars: number;
  maxHypotheses: number;
  maxGaps: number;
  maxKnownEntities: number;
  maxCandidatePaths: number;
  maxPriorActions: number;
  maxReasonCodeEntries: number;
  maxSerializedInputBytes: number;
  maxQueryChars: number;
  maxReadRangeLines: number;
  maxModelCallsPerInvestigation: number;
  maxModelPlannerWallTimeMs: number;
  maxModelOutputBytes: number;
  maxProviderResponseEnvelopeBytes: number;
  maximumTrackedRequests: number;
}

export const DEFAULT_MODEL_PLANNER_POLICY: Readonly<ModelPlannerPolicy> =
  Object.freeze({
    schemaVersion: 1,
    maxTaskChars: 2_000,
    maxHypotheses: 24,
    maxGaps: 24,
    maxKnownEntities: 48,
    maxCandidatePaths: 64,
    maxPriorActions: 48,
    maxReasonCodeEntries: 32,
    maxSerializedInputBytes: 32_768,
    maxQueryChars: 160,
    maxReadRangeLines: 400,
    maxModelCallsPerInvestigation: 4,
    maxModelPlannerWallTimeMs: 600,
    maxModelOutputBytes: 8_192,
    maxProviderResponseEnvelopeBytes: 65_536,
    maximumTrackedRequests: 4,
  });

const FIELDS = Object.keys(DEFAULT_MODEL_PLANNER_POLICY).sort();

export function normalizeModelPlannerPolicy(
  value: ModelPlannerPolicy = DEFAULT_MODEL_PLANNER_POLICY,
): Readonly<ModelPlannerPolicy> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_model_planner_policy");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new Error("invalid_model_planner_policy");
  }
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some(
      (entry) => entry.get || entry.set || !("value" in entry) || !entry.enumerable,
    )
  ) {
    throw new Error("invalid_model_planner_policy");
  }
  const keys = Object.keys(descriptors).sort();
  if (keys.length !== FIELDS.length || keys.some((key, index) => key !== FIELDS[index])) {
    throw new Error("invalid_model_planner_policy");
  }
  if (value.schemaVersion !== 1) throw new Error("invalid_model_planner_policy");
  for (const key of FIELDS.filter((key) => key !== "schemaVersion") as Array<
    Exclude<keyof ModelPlannerPolicy, "schemaVersion">
  >) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > 10_000_000) {
      throw new Error("invalid_model_planner_policy");
    }
  }
  return Object.freeze({ ...value });
}
