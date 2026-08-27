import type { ContextEngineShadowPolicy } from "../shadow/index.js";

export const DEFAULT_TASK_PACK_CANARY_POLICY: ContextEngineShadowPolicy = Object.freeze({
  budget: Object.freeze({
    maxOperations: 16,
    maxFileReads: 6,
    maxFileBytes: 384_000,
    maxParsedFiles: 5,
    maxRelationshipHops: 10,
    maxWallTimeMs: 1_200,
    maxPlannerRounds: 8,
    maxConcurrentOperations: 1,
  }),
  timeoutMs: 1_450,
  maxHistoryRecords: 50,
});
