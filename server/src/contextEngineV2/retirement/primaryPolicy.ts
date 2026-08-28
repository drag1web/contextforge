import type { ContextEngineShadowPolicy } from "../shadow/index.js";

export const DEFAULT_TASK_PACK_PRIMARY_POLICY: Readonly<ContextEngineShadowPolicy> =
  Object.freeze({
    budget: Object.freeze({
      maxOperations: 20,
      maxFileReads: 8,
      maxFileBytes: 512_000,
      maxParsedFiles: 7,
      maxRelationshipHops: 12,
      maxWallTimeMs: 1_500,
      maxPlannerRounds: 10,
      maxConcurrentOperations: 1,
    }),
    timeoutMs: 1_750,
    maxHistoryRecords: 50,
  });
