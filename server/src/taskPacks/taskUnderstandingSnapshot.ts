import crypto from "node:crypto";

import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type { ProjectInventory } from "../scanner/projectInventoryScanner.js";
import type { AppSettings } from "../settings/settingsService.js";
import {
  classifyTaskClarificationQuestion,
  normalizeTaskClarifications,
  type TaskClarification,
} from "./taskClarifications.js";

export const TASK_UNDERSTANDING_CACHE_VERSION =
  "2026-07-20.semantic-intent-grounding-v1";

export function buildTaskUnderstandingAnalysisSignature(
  settings: AppSettings,
) {
  const configuredModel =
    settings.aiProvider === "gemini"
      ? settings.geminiModel
      : settings.aiProvider === "anthropic"
        ? settings.anthropicModel
        : settings.aiProvider === "openai-compatible"
          ? settings.openAiCompatibleModel
          : settings.defaultOllamaModel;

  return JSON.stringify({
    version: TASK_UNDERSTANDING_CACHE_VERSION,
    provider: settings.aiProvider,
    model: configuredModel ?? null,
    endpoint:
      settings.aiProvider === "ollama"
        ? settings.ollamaUrl
        : settings.aiProvider === "openai-compatible"
          ? settings.openAiCompatibleBaseUrl
          : settings.aiProvider === "gemini"
            ? settings.geminiBaseUrl
            : settings.anthropicBaseUrl,
  });
}

export interface TaskUnderstandingSnapshotRecord {
  id: string;
  createdAt: number;
  cacheKey: string;
  projectId: number;
  rawTask: string;
  taskType: string;
  targetTool: string;
  analysisSignature: string;
  clarifications: TaskClarification[];
  inventoryFingerprint: string;
  taskIntent: TaskIntentAnalysis;
}

export interface CreateTaskUnderstandingSnapshotInput {
  projectId: number;
  rawTask: string;
  taskType: string;
  targetTool: string;
  analysisSignature?: string;
  clarifications?: readonly TaskClarification[];
  inventory: ProjectInventory;
  taskIntent: TaskIntentAnalysis;
}

export interface ResolveTaskUnderstandingSnapshotInput {
  snapshotId: string | undefined;
  projectId: number;
  rawTask: string;
  taskType: string;
  targetTool: string;
  analysisSignature?: string;
  clarifications?: readonly TaskClarification[];
  inventory: ProjectInventory;
  allowSafeClarificationAppend?: boolean;
  allowCacheLookup?: boolean;
}

export type TaskUnderstandingSnapshotResolveReason =
  | "hit"
  | "missing_id"
  | "cache_miss"
  | "not_found"
  | "expired"
  | "input_changed"
  | "analysis_changed"
  | "inventory_changed"
  | "clarifications_changed"
  | "unsafe_clarification_append";

export type TaskUnderstandingSnapshotLookupSource = "id" | "cache" | "none";

export interface TaskUnderstandingSnapshotResolution {
  hit: boolean;
  reason: TaskUnderstandingSnapshotResolveReason;
  lookupSource: TaskUnderstandingSnapshotLookupSource;
  snapshot: TaskUnderstandingSnapshotRecord | null;
  appendedClarifications: TaskClarification[];
}

/**
 * A review acknowledgement is valid only for the exact reusable snapshot that
 * produced the interpretation. Changed task text, clarifications, inventory,
 * or analysis settings invalidate the acknowledgement with the snapshot.
 */
export function isTaskUnderstandingSnapshotReviewAccepted(
  resolution: TaskUnderstandingSnapshotResolution,
  reviewedSnapshotId: string | undefined,
) {
  return Boolean(
    reviewedSnapshotId &&
    resolution.hit &&
    resolution.snapshot?.id === reviewedSnapshotId,
  );
}

const snapshots = new Map<string, TaskUnderstandingSnapshotRecord>();
const snapshotIdsByCacheKey = new Map<string, string>();
const SNAPSHOT_TTL_MS = 20 * 60 * 1000;
const MAX_SNAPSHOTS = 160;

function normalizeScalar(value: string | undefined) {
  return (value ?? "").trim().replace(/\r\n/g, "\n");
}

function cloneIntent(taskIntent: TaskIntentAnalysis) {
  return structuredClone(taskIntent);
}

function clarificationKey(value: TaskClarification) {
  return `${value.question.trim().toLowerCase()}\u0000${value.answer
    .trim()
    .toLowerCase()}`;
}

function sameClarifications(
  left: readonly TaskClarification[],
  right: readonly TaskClarification[],
) {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        clarificationKey(item) === clarificationKey(right[index]!),
    )
  );
}

function isPrefix(
  prefix: readonly TaskClarification[],
  values: readonly TaskClarification[],
) {
  return (
    prefix.length <= values.length &&
    prefix.every(
      (item, index) =>
        clarificationKey(item) === clarificationKey(values[index]!),
    )
  );
}

function deleteSnapshot(id: string) {
  const snapshot = snapshots.get(id);
  snapshots.delete(id);
  if (snapshot && snapshotIdsByCacheKey.get(snapshot.cacheKey) === id) {
    snapshotIdsByCacheKey.delete(snapshot.cacheKey);
  }
}

function cleanupSnapshots() {
  const now = Date.now();
  for (const [id, snapshot] of snapshots) {
    if (now - snapshot.createdAt > SNAPSHOT_TTL_MS) deleteSnapshot(id);
  }

  while (snapshots.size >= MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value;
    if (!oldest) break;
    deleteSnapshot(oldest);
  }
}

export function buildTaskUnderstandingInventoryFingerprint(
  inventory: ProjectInventory,
) {
  // Task Understanding only receives the project tree paths. File sizes can
  // change as a side effect of normal runtime work (for example, SQLite
  // storage updates after a Task Pack is saved) without changing the project
  // structure the analyzer saw. Keep the fingerprint aligned with the actual
  // analyzer input so those unrelated writes do not invalidate a reusable
  // understanding snapshot.
  const payload = inventory.files
    .map((file) => file.path.trim().replace(/\\/g, "/"))
    .filter(Boolean)
    .sort()
    .join("\n");

  return crypto.createHash("sha256").update(payload).digest("hex");
}

function buildTaskUnderstandingCacheKey(input: {
  projectId: number;
  rawTask: string;
  taskType: string;
  targetTool: string;
  analysisSignature?: string;
  clarifications?: readonly TaskClarification[];
  inventory: ProjectInventory;
}) {
  const clarifications = normalizeTaskClarifications(input.clarifications).map(
    (item) => ({
      question: normalizeScalar(item.question).toLowerCase(),
      answer: normalizeScalar(item.answer),
    }),
  );

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version: TASK_UNDERSTANDING_CACHE_VERSION,
        projectId: input.projectId,
        rawTask: normalizeScalar(input.rawTask),
        taskType: normalizeScalar(input.taskType),
        targetTool: normalizeScalar(input.targetTool),
        analysisSignature: normalizeScalar(input.analysisSignature),
        clarifications,
        inventoryFingerprint: buildTaskUnderstandingInventoryFingerprint(
          input.inventory,
        ),
      }),
    )
    .digest("hex");
}

function cloneSnapshot(snapshot: TaskUnderstandingSnapshotRecord) {
  return {
    ...snapshot,
    clarifications: [...snapshot.clarifications],
    taskIntent: cloneIntent(snapshot.taskIntent),
  };
}

export function createTaskUnderstandingSnapshot(
  input: CreateTaskUnderstandingSnapshotInput,
) {
  cleanupSnapshots();

  const cacheKey = buildTaskUnderstandingCacheKey(input);
  const existingId = snapshotIdsByCacheKey.get(cacheKey);
  if (existingId) {
    const existing = snapshots.get(existingId);
    if (existing && Date.now() - existing.createdAt <= SNAPSHOT_TTL_MS) {
      return existingId;
    }
    deleteSnapshot(existingId);
  }

  const id = crypto.randomUUID();
  snapshots.set(id, {
    id,
    createdAt: Date.now(),
    cacheKey,
    projectId: input.projectId,
    rawTask: normalizeScalar(input.rawTask),
    taskType: normalizeScalar(input.taskType),
    targetTool: normalizeScalar(input.targetTool),
    analysisSignature: normalizeScalar(input.analysisSignature),
    clarifications: normalizeTaskClarifications(input.clarifications),
    inventoryFingerprint: buildTaskUnderstandingInventoryFingerprint(
      input.inventory,
    ),
    taskIntent: cloneIntent(input.taskIntent),
  });
  snapshotIdsByCacheKey.set(cacheKey, id);

  return id;
}

function safeClarificationAppend(
  snapshot: TaskUnderstandingSnapshotRecord,
  appended: readonly TaskClarification[],
) {
  if (appended.length === 0) return true;

  return appended.every((clarification) => {
    const kind = classifyTaskClarificationQuestion(clarification.question);
    if (kind === "constraint") return true;
    if (kind !== "replacement_value") return false;

    return snapshot.taskIntent.taskUnderstanding.missingInformation.some(
      (item) => item.required && item.code === "replacement_value",
    );
  });
}

function resolveSnapshotRecord(
  snapshot: TaskUnderstandingSnapshotRecord,
  input: ResolveTaskUnderstandingSnapshotInput,
  lookupSource: Exclude<TaskUnderstandingSnapshotLookupSource, "none">,
): TaskUnderstandingSnapshotResolution {
  if (Date.now() - snapshot.createdAt > SNAPSHOT_TTL_MS) {
    deleteSnapshot(snapshot.id);
    return {
      hit: false,
      reason: "expired",
      lookupSource: "none",
      snapshot: null,
      appendedClarifications: [],
    };
  }

  if (
    snapshot.projectId !== input.projectId ||
    snapshot.rawTask !== normalizeScalar(input.rawTask) ||
    snapshot.taskType !== normalizeScalar(input.taskType) ||
    snapshot.targetTool !== normalizeScalar(input.targetTool)
  ) {
    return {
      hit: false,
      reason: "input_changed",
      lookupSource: "none",
      snapshot: null,
      appendedClarifications: [],
    };
  }

  if (snapshot.analysisSignature !== normalizeScalar(input.analysisSignature)) {
    return {
      hit: false,
      reason: "analysis_changed",
      lookupSource: "none",
      snapshot: null,
      appendedClarifications: [],
    };
  }

  if (
    snapshot.inventoryFingerprint !==
    buildTaskUnderstandingInventoryFingerprint(input.inventory)
  ) {
    return {
      hit: false,
      reason: "inventory_changed",
      lookupSource: "none",
      snapshot: null,
      appendedClarifications: [],
    };
  }

  const currentClarifications = normalizeTaskClarifications(
    input.clarifications,
  );
  if (sameClarifications(snapshot.clarifications, currentClarifications)) {
    return {
      hit: true,
      reason: "hit",
      lookupSource,
      snapshot: cloneSnapshot(snapshot),
      appendedClarifications: [],
    };
  }

  if (
    input.allowSafeClarificationAppend &&
    isPrefix(snapshot.clarifications, currentClarifications)
  ) {
    const appendedClarifications = currentClarifications.slice(
      snapshot.clarifications.length,
    );
    if (safeClarificationAppend(snapshot, appendedClarifications)) {
      return {
        hit: true,
        reason: "hit",
        lookupSource,
        snapshot: cloneSnapshot(snapshot),
        appendedClarifications,
      };
    }

    return {
      hit: false,
      reason: "unsafe_clarification_append",
      lookupSource: "none",
      snapshot: null,
      appendedClarifications: [],
    };
  }

  return {
    hit: false,
    reason: "clarifications_changed",
    lookupSource: "none",
    snapshot: null,
    appendedClarifications: [],
  };
}

export function resolveTaskUnderstandingSnapshot(
  input: ResolveTaskUnderstandingSnapshotInput,
): TaskUnderstandingSnapshotResolution {
  cleanupSnapshots();

  const snapshotId = input.snapshotId?.trim();
  if (snapshotId) {
    const snapshot = snapshots.get(snapshotId);
    if (!snapshot) {
      return {
        hit: false,
        reason: "not_found",
        lookupSource: "none",
        snapshot: null,
        appendedClarifications: [],
      };
    }
    return resolveSnapshotRecord(snapshot, input, "id");
  }

  if (input.allowCacheLookup !== false) {
    const cacheKey = buildTaskUnderstandingCacheKey(input);
    const cachedId = snapshotIdsByCacheKey.get(cacheKey);
    if (cachedId) {
      const cached = snapshots.get(cachedId);
      if (cached) return resolveSnapshotRecord(cached, input, "cache");
      snapshotIdsByCacheKey.delete(cacheKey);
    }
  }

  return {
    hit: false,
    reason: input.allowCacheLookup === false ? "missing_id" : "cache_miss",
    lookupSource: "none",
    snapshot: null,
    appendedClarifications: [],
  };
}

export function clearTaskUnderstandingSnapshotsForTests() {
  snapshots.clear();
  snapshotIdsByCacheKey.clear();
}
