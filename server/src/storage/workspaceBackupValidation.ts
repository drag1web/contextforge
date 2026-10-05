import { z } from "zod";
import {
  assertTaskPackAggregate, assertTaskPackAggregateLifecycleEvent, assertTaskPackRevision,
  assertTaskPackRevisionReviewEvent, transitionTaskPackLifecycle,
  type TaskPackAggregate, type TaskPackAggregateLifecycleEvent, type TaskPackJsonObject,
  type TaskPackJsonValue, type TaskPackLifecycle, type TaskPackRevision, type TaskPackRevisionReviewEvent,
} from "../taskPacks/taskPackLifecycle.js";
import { validateTaskPackRevisionHistorySnapshot } from "./taskPackRevisionHistory.js";
import {
  WORKSPACE_BACKUP_FORMAT, WORKSPACE_BACKUP_SAFE_SETTING_KEYS, WorkspaceBackupReadError,
  type WorkspaceBackupV1, type WorkspaceBackupV2,
} from "./workspaceBackupFormat.js";

/** Implementation defenses, NOT wire-version limits. No byte/character ceiling.
 * Iterative preflight runs before recursive domain validation, with depth-bounded memory. */
export const WORKSPACE_BACKUP_MAX_DEPTH = 128;
export const WORKSPACE_BACKUP_MAX_NODES = 10_000_000;
function invalid(): never { throw new WorkspaceBackupReadError("WORKSPACE_BACKUP_INVALID"); }
function limited(): never { throw new WorkspaceBackupReadError("WORKSPACE_BACKUP_SAFETY_LIMIT"); }
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function checkWorkspaceBackupJsonBounds(value: unknown): void {
  function* children(item: unknown): Generator<unknown> {
    if (Array.isArray(item)) yield* item;
    else if (isObject(item)) for (const key of Object.keys(item)) yield item[key];
    else if (item !== null && typeof item !== "string" && typeof item !== "boolean" &&
      !(typeof item === "number" && Number.isFinite(item))) invalid();
  }
  const stack = [children([value])];
  let nodes = 0;
  while (stack.length) {
    const next = stack[stack.length - 1].next();
    if (next.done) { stack.pop(); continue; }
    if (++nodes > WORKSPACE_BACKUP_MAX_NODES) limited();
    if (Array.isArray(next.value) || isObject(next.value)) {
      if (stack.length > WORKSPACE_BACKUP_MAX_DEPTH) limited();
      stack.push(children(next.value));
    } else children(next.value).next();
  }
}

const id = z.number().int().safe().positive();
const count = z.number().int().safe().nonnegative();
const finite = z.number().finite();
const strings = z.array(z.string());
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u)
  .refine(value => Number.isFinite(Date.parse(value)));
// Preflight already proved finite JSON, with no privacy scan or value transformation.
const json = z.custom<TaskPackJsonValue>(value => value !== undefined);
const jsonObject = z.custom<TaskPackJsonObject>(isObject);
const scripts = z.record(z.string(), z.string());
const signals = z.strictObject({
  packageFiles: strings, docs: strings, envExamples: strings, testFiles: strings,
  testConfigs: strings, ciFiles: strings, lockFiles: strings, configs: strings, directories: strings,
  commands: z.strictObject({ dev: z.string().nullable(), build: z.string().nullable(),
    test: z.string().nullable(), typecheck: z.string().nullable(), lint: z.string().nullable() }),
  packages: z.array(z.strictObject({ path: z.string(), name: z.string().nullable(), scripts })),
  inventory: z.strictObject({ totalFiles: count, totalDirectories: count,
    truncated: z.boolean(), maxDepth: count, maxEntries: count }),
});
const project = z.strictObject({
  id, name: z.string(), localPath: z.string(), packageManager: z.string().nullable(),
  detectedStack: strings, scripts, readinessScore: finite,
  readinessReport: z.strictObject({ score: finite, checks: z.array(z.strictObject({
    key: z.string(), label: z.string(), passed: z.boolean(), points: finite, message: z.string(),
  })), issues: strings, signals: signals.optional() }),
  createdAt: timestamp, updatedAt: timestamp, lastScanAt: timestamp.nullable(),
});
const memory = z.strictObject({ id, projectId: id, title: z.string(), content: z.string(),
  category: z.enum(["architecture", "do_not_change", "style", "verification", "workflow", "custom"]),
  isEnabled: z.boolean(), createdAt: timestamp, updatedAt: timestamp });
const ruleDates = { createdAt: timestamp.optional(), updatedAt: timestamp.optional() };
const taskType = z.enum(["general", "ui", "backend", "fullstack", "build", "bugfix", "refactor", "docs", "tests"]);
const catalog = z.strictObject({ version: id,
  templates: z.array(z.strictObject({ id: z.string(), name: z.string(), description: z.string(),
    targetTool: z.enum(["codex", "cursor", "claude", "gemini", "generic"]), taskType,
    content: z.string(), isBuiltin: z.boolean(), ...ruleDates })),
  ruleItems: z.array(z.strictObject({ id: z.string(), title: z.string(), description: z.string(),
    category: z.enum(["general", "ui", "backend", "bugfix", "refactor", "docs", "tests", "assets", "verification"]),
    content: z.string(), isBuiltin: z.boolean(), ...ruleDates })),
  ruleProfiles: z.array(z.strictObject({ id: z.string(), name: z.string(), description: z.string(), taskType,
    enabledRuleIds: strings, customRules: strings, acceptanceCriteriaPresetId: z.string().nullable().optional(),
    isBuiltin: z.boolean(), ...ruleDates })),
  acceptanceCriteriaPresets: z.array(z.strictObject({ id: z.string(), name: z.string(), description: z.string(),
    taskType, criteria: strings, isBuiltin: z.boolean(), ...ruleDates })),
}).nullable();
const commonData = {
  projects: z.array(project),
  projectMemory: z.array(z.strictObject({ projectId: id, memories: z.array(memory) })),
  rulesAndTemplates: catalog,
  safeSettings: z.strictObject(Object.fromEntries(WORKSPACE_BACKUP_SAFE_SETTING_KEYS.map(key => [key, json])) as
    Record<typeof WORKSPACE_BACKUP_SAFE_SETTING_KEYS[number], typeof json>),
};
const commonCounts = { projects: count, taskPacks: count, projectMemories: count, ruleTemplates: count, settings: count };
const envelope = {
  format: z.literal(WORKSPACE_BACKUP_FORMAT), appVersion: z.string(), exportedAt: timestamp,
  storage: z.strictObject({ driver: z.enum(["sqlite", "postgres"]), sqliteFirst: z.boolean(),
    schema: z.strictObject({ currentVersion: count, latestVersion: count,
      status: z.enum(["ready", "needs_migration", "unknown"]),
      appliedMigrations: z.array(z.strictObject({ id: z.string(), version: id,
        name: z.string(), appliedAt: timestamp })),
    }).nullable() }),
  included: strings, excluded: strings, warnings: strings,
};
const v1Schema = z.strictObject({ ...envelope, formatVersion: z.literal(1),
  counts: z.strictObject(commonCounts), data: z.strictObject({ ...commonData,
    taskPacks: z.array(z.strictObject({ id, projectId: id, projectName: z.string().optional(),
      title: z.string().refine(value => value.trim().length > 0), rawTask: z.string(), taskType: z.string(), targetTool: z.string(), generatedPrompt: z.string(),
      generationMode: z.enum(["template", "ollama"]), generationModel: z.string().nullable(),
      generationMessage: z.string().nullable(), generationUsedFallback: z.boolean(),
      generationDurationMs: finite.nonnegative().nullable(), generationRecipe: jsonObject.nullable(),
      createdAt: timestamp, updatedAt: timestamp })),
  }),
});
// Domain assertions below are the closed validators for these authoritative records.
const v2Schema = z.strictObject({ ...envelope, formatVersion: z.literal(2),
  counts: z.strictObject({ ...commonCounts, revisions: count, lifecycleEvents: count, reviewEvents: count }),
  data: z.strictObject({ ...commonData, taskPackAggregates: z.array(z.unknown()), taskPackRevisions: z.array(z.unknown()),
    taskPackLifecycleEvents: z.array(z.unknown()), taskPackReviewEvents: z.array(z.unknown()) }),
});

function unique<T extends { readonly id: number | string }>(items: readonly T[]): Map<T["id"], T> {
  const result = new Map<T["id"], T>();
  for (const item of items) { if (result.has(item.id)) invalid(); result.set(item.id, item); }
  return result;
}
function validateCommon(backup: WorkspaceBackupV1 | WorkspaceBackupV2): void {
  const { data, counts } = backup;
  const projects = unique(data.projects);
  const memoryGroups = new Set<number>();
  const memories = [];
  for (const group of data.projectMemory) {
    if (!projects.has(group.projectId) || memoryGroups.has(group.projectId)) invalid();
    memoryGroups.add(group.projectId);
    for (const item of group.memories) {
      if (item.projectId !== group.projectId) invalid();
      memories.push(item);
    }
  }
  unique(memories);
  const rules = data.rulesAndTemplates;
  const ruleCount = rules ? rules.templates.length + rules.ruleItems.length +
    rules.ruleProfiles.length + rules.acceptanceCriteriaPresets.length : 0;
  if (rules) for (const items of [rules.templates, rules.ruleItems, rules.ruleProfiles, rules.acceptanceCriteriaPresets]) {
    unique<{ readonly id: string }>(items);
  }
  if (counts.projects !== projects.size || counts.projectMemories !== memories.length ||
    counts.ruleTemplates !== ruleCount || counts.settings !== Object.keys(data.safeSettings).length) invalid();
}

function validateV2(backup: WorkspaceBackupV2): void {
  const { data, counts } = backup;
  const projects = unique(data.projects);
  const aggregates = unique(data.taskPackAggregates);
  const revisions = unique(data.taskPackRevisions);
  unique(data.taskPackLifecycleEvents);
  unique(data.taskPackReviewEvents);
  if (counts.taskPacks !== aggregates.size || counts.revisions !== revisions.size ||
    counts.lifecycleEvents !== data.taskPackLifecycleEvents.length || counts.reviewEvents !== data.taskPackReviewEvents.length) invalid();
  const ownedRevisions = new Map<number, TaskPackRevision[]>();
  const reviews = new Map<number, TaskPackRevisionReviewEvent[]>();
  const lifecycles = new Map<number, TaskPackAggregateLifecycleEvent[]>();
  for (const revision of revisions.values()) {
    const aggregate = aggregates.get(revision.taskPackId);
    if (!aggregate) invalid();
    assertTaskPackRevision(revision, { aggregate, verifyContentHash: true });
    const items = ownedRevisions.get(aggregate.id) ?? [];
    items.push(revision); ownedRevisions.set(aggregate.id, items);
  }
  for (const event of data.taskPackReviewEvents) {
    const aggregate = aggregates.get(event.taskPackId), revision = revisions.get(event.revisionId);
    if (!aggregate || !revision) invalid();
    assertTaskPackRevisionReviewEvent(event, { aggregate, revision });
    const items = reviews.get(revision.id) ?? [];
    items.push(event); reviews.set(revision.id, items);
  }
  for (const event of data.taskPackLifecycleEvents) {
    if (!aggregates.has(event.taskPackId)) invalid();
    const revision = event.revisionId === null ? undefined : revisions.get(event.revisionId);
    if (event.revisionId !== null && !revision) invalid();
    // Historical fromState/current accepted pointer are NOT today's aggregate.
    assertTaskPackAggregateLifecycleEvent(event, { revision });
    const items = lifecycles.get(event.taskPackId) ?? [];
    items.push(event); lifecycles.set(event.taskPackId, items);
  }
  for (const aggregate of aggregates.values()) {
    assertTaskPackAggregate(aggregate);
    if (!projects.has(aggregate.projectId)) invalid();
    const items = ownedRevisions.get(aggregate.id) ?? [];
    const states = validateTaskPackRevisionHistorySnapshot(aggregate.id, { aggregate,
      revisions: items.map(revision => ({ revision, reviewEvents: reviews.get(revision.id) ?? [] })) });
    const reviewStates = new Map(items.map((revision, index) => [revision.id, states[index]]));
    if (aggregate.acceptedRevisionId !== null && reviewStates.get(aggregate.acceptedRevisionId) !== "accepted") invalid();
    replayLifecycle(aggregate, lifecycles.get(aggregate.id) ?? [], reviewStates);
  }
}

function replayLifecycle(aggregate: TaskPackAggregate, events: readonly TaskPackAggregateLifecycleEvent[],
  reviewStates: ReadonlyMap<number, string>): void {
  let lifecycle: TaskPackLifecycle = { state: "active", archivedFromState: null };
  let previousTime = -Infinity;
  let completedAt: string | null = null, archivedAt: string | null = null;
  const actions = { completed: "complete", reopened: "reopen", archived: "archive", unarchived: "unarchive" } as const;
  for (const event of events) {
    const time = Date.parse(event.createdAt);
    if (time < previousTime || event.fromState !== lifecycle.state) invalid();
    lifecycle = transitionTaskPackLifecycle(lifecycle, { type: actions[event.eventType] });
    if (lifecycle.state !== event.toState) invalid();
    if (event.eventType === "completed") {
      if (event.revisionId === null || reviewStates.get(event.revisionId) !== "accepted") invalid();
      completedAt = event.createdAt;
    }
    archivedAt = event.eventType === "archived" ? event.createdAt : null;
    previousTime = time;
  }
  const sameTime = (left: string | null, right: string | null) =>
    left === null || right === null ? left === right : Date.parse(left) === Date.parse(right);
  if (lifecycle.state !== aggregate.lifecycle.state || lifecycle.archivedFromState !== aggregate.lifecycle.archivedFromState ||
    !sameTime(completedAt, aggregate.completedAt) || !sameTime(archivedAt, aggregate.archivedAt)) invalid();
  // lifecycleVersion also counts review transitions; never infer it from lifecycle-event count.
}

/** Pure input validation. Fail closed, with no raw Zod/domain evidence in public errors. */
export function validateWorkspaceBackup(value: unknown): WorkspaceBackupV1 | WorkspaceBackupV2 {
  checkWorkspaceBackupJsonBounds(value);
  if (!isObject(value) || value.format !== WORKSPACE_BACKUP_FORMAT ||
    (value.formatVersion !== 1 && value.formatVersion !== 2)) {
    throw new WorkspaceBackupReadError("WORKSPACE_BACKUP_FORMAT_UNSUPPORTED");
  }
  try {
    if (value.formatVersion === 1) {
      const backup = v1Schema.parse(value);
      validateCommon(backup);
      unique(backup.data.taskPacks);
      const projects = new Set(backup.data.projects.map(item => item.id));
      if (backup.counts.taskPacks !== backup.data.taskPacks.length ||
        backup.data.taskPacks.some(item => !projects.has(item.projectId))) invalid();
      return backup;
    }
    const parsed = v2Schema.parse(value);
    for (const item of parsed.data.taskPackAggregates) assertTaskPackAggregate(item);
    for (const item of parsed.data.taskPackRevisions) assertTaskPackRevision(item, { verifyContentHash: true });
    for (const item of parsed.data.taskPackLifecycleEvents) assertTaskPackAggregateLifecycleEvent(item);
    for (const item of parsed.data.taskPackReviewEvents) assertTaskPackRevisionReviewEvent(item);
    const backup = parsed as WorkspaceBackupV2;
    validateCommon(backup); validateV2(backup);
    return backup;
  } catch { return invalid(); }
}
