import { createHash } from "node:crypto";

/**
 * TP-LC-01 is a pure domain boundary. These values are not wired to storage,
 * routes, MCP, or the renderer yet. Numeric aggregate/revision identities are
 * intentionally compatible with the existing TaskPackRecord identity model.
 */
export type TaskPackAggregateId = number;
export type TaskPackRevisionId = number;
export type TaskPackProjectId = number;
export type TaskPackDraftId = string;

export type TaskPackLifecycleState = "active" | "completed" | "archived";
export type TaskPackNonArchivedLifecycleState = Exclude<TaskPackLifecycleState, "archived">;
export type TaskPackReviewState =
  | "unreviewed"
  | "in_review"
  | "accepted"
  | "changes_requested";
export type TaskPackDraftState = "active" | "materialized" | "discarded";
export type TaskPackRevisionSourceKind =
  | "generated"
  | "manual_edit"
  | "regenerated"
  | "imported"
  | "split"
  | "legacy_snapshot";
export type TaskPackGenerationMode = "template" | "ollama";

export type TaskPackContextUsage =
  | "inspect-and-edit"
  | "create-and-edit"
  | "inspect-only"
  | "asset-reference"
  | "config-reference";
export type TaskPackContextRole = "target" | "test" | "supporting" | "reference";
export type TaskPackEvidenceStrength = "strong" | "supporting" | "reference";
export type TaskPackSelectorEngine = "legacy" | "context_engine_v2" | "manual";
export type TaskPackGroundingProofClass =
  | "inventory_exact"
  | "graph_supported"
  | "user_confirmed"
  | "direct_definition"
  | "direct_document_identity"
  | "direct_configuration_identity"
  | "direct_source_identity"
  | "exact_relationship_chain";
export type TaskPackFreshnessState =
  | "current"
  | "review_recommended"
  | "affected"
  | "unknown";

export type TaskPackJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly TaskPackJsonValue[]
  | TaskPackJsonObject;

export interface TaskPackJsonObject {
  readonly [key: string]: TaskPackJsonValue;
}

export interface TaskPackLifecycleActive {
  readonly state: "active";
  readonly archivedFromState: null;
}

export interface TaskPackLifecycleCompleted {
  readonly state: "completed";
  readonly archivedFromState: null;
}

export interface TaskPackLifecycleArchived {
  readonly state: "archived";
  /** Required so unarchive restores the exact prior non-archived state. */
  readonly archivedFromState: TaskPackNonArchivedLifecycleState;
}

export type TaskPackLifecycle =
  | TaskPackLifecycleActive
  | TaskPackLifecycleCompleted
  | TaskPackLifecycleArchived;

export interface TaskPackAggregate {
  readonly id: TaskPackAggregateId;
  readonly projectId: TaskPackProjectId;
  readonly title: string;
  readonly lifecycle: TaskPackLifecycle;
  readonly currentRevisionId: TaskPackRevisionId;
  readonly acceptedRevisionId: TaskPackRevisionId | null;
  readonly lifecycleVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
}

export type TaskPackLifecycleTransitionEvent =
  | { readonly type: "complete" }
  | { readonly type: "reopen" }
  | { readonly type: "archive" }
  | { readonly type: "unarchive" };

export interface TaskPackAggregateLifecycleEvent {
  readonly id: string;
  readonly taskPackId: TaskPackAggregateId;
  readonly eventType: "completed" | "reopened" | "archived" | "unarchived";
  readonly fromState: TaskPackLifecycleState;
  readonly toState: TaskPackLifecycleState;
  readonly revisionId: TaskPackRevisionId | null;
  readonly source: TaskPackEventSource;
  readonly actorId: string | null;
  readonly createdAt: string;
  readonly metadata: TaskPackJsonObject | null;
}

export type TaskPackReviewTransitionEvent =
  | { readonly type: "start_review" }
  | { readonly type: "accept" }
  | { readonly type: "request_changes" };

export interface TaskPackRevisionReviewEvent {
  readonly id: string;
  readonly taskPackId: TaskPackAggregateId;
  readonly revisionId: TaskPackRevisionId;
  readonly eventType: "review_started" | "accepted" | "changes_requested";
  readonly fromState: TaskPackReviewState;
  readonly toState: TaskPackReviewState;
  readonly source: TaskPackEventSource;
  readonly actorId: string | null;
  readonly createdAt: string;
  readonly metadata: TaskPackJsonObject | null;
}

export type TaskPackEventSource = "user" | "system" | "migration" | "import";

export type TaskPackDraftTransitionEvent =
  | { readonly type: "materialize"; readonly revisionId: TaskPackRevisionId }
  | { readonly type: "discard" };

export interface TaskPackDraftActiveLifecycle {
  readonly state: "active";
  readonly materializedRevisionId: null;
}

export interface TaskPackDraftMaterializedLifecycle {
  readonly state: "materialized";
  readonly materializedRevisionId: TaskPackRevisionId;
}

export interface TaskPackDraftDiscardedLifecycle {
  readonly state: "discarded";
  readonly materializedRevisionId: null;
}

export type TaskPackDraftLifecycle =
  | TaskPackDraftActiveLifecycle
  | TaskPackDraftMaterializedLifecycle
  | TaskPackDraftDiscardedLifecycle;

export interface TaskPackDraftClarification {
  readonly question: string;
  readonly answer: string;
}

export interface TaskPackDraftContent {
  readonly rawTask: string;
  readonly taskType: string;
  readonly targetTool: string;
  readonly templateId: string | null;
  readonly ruleProfileId: string | null;
  readonly enabledRuleIds: readonly string[];
  readonly customRulesText: string | null;
  readonly acceptanceCriteriaPresetId: string | null;
  readonly acceptanceCriteriaText: string | null;
  readonly clarifications: readonly TaskPackDraftClarification[];
  readonly performanceSessionId: string | null;
  readonly understandingSnapshotId: string | null;
  readonly reviewedUnderstandingSnapshotId: string | null;
}

export interface PersistedTaskPackDraft {
  readonly id: TaskPackDraftId;
  readonly projectId: TaskPackProjectId;
  readonly taskPackId: TaskPackAggregateId | null;
  readonly baseRevisionId: TaskPackRevisionId | null;
  readonly content: TaskPackDraftContent;
  readonly lifecycle: TaskPackDraftLifecycle;
  /**
   * Optimistic-concurrency token for a mutable persisted draft. Storage initializes it to 1,
   * increments it after a successful state/content mutation, and retains it for semantic no-ops.
   */
  readonly draftVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | null;
}

export interface TaskPackRevisionContextFile {
  readonly path: string;
  readonly role: TaskPackContextRole;
  readonly usage: TaskPackContextUsage;
  readonly evidenceStrength: TaskPackEvidenceStrength;
  /** Proof classes are a set for hashing purposes; storage order is not semantic. */
  readonly proofClasses: readonly TaskPackGroundingProofClass[];
}

export interface TaskPackGroundedContextSnapshot {
  readonly schemaVersion: 1;
  readonly selectorEngine: TaskPackSelectorEngine;
  readonly selectorConfigurationFingerprint: string | null;
  readonly repositoryObservationFingerprint: string | null;
  readonly repositorySnapshotFingerprint: string | null;
  readonly selectorSnapshotFingerprint: string | null;
  readonly selectedFiles: readonly TaskPackRevisionContextFile[];
}

export interface TaskPackFreshnessBasis {
  readonly schemaVersion: 1;
  readonly stateAtCreation: TaskPackFreshnessState;
  readonly projectAwarenessFingerprint: string | null;
  readonly inventoryFingerprint: string | null;
  readonly policyVersion: string | null;
  readonly comparisonLimited: boolean;
  readonly observedAt: string | null;
  readonly previousObservedAt: string | null;
}

export interface TaskPackRevisionDiagnostics {
  readonly selector: TaskPackJsonObject | null;
  readonly generation: TaskPackJsonObject | null;
  /** Preserved historically; explicit timing fields are excluded, other evidence remains hash-significant. */
  readonly performance: TaskPackJsonObject | null;
}

export interface TaskPackRevisionContent {
  readonly sourceKind: TaskPackRevisionSourceKind;
  readonly rawTask: string;
  readonly taskType: string;
  readonly targetTool: string;
  readonly generatedPrompt: string;
  readonly generationMode: TaskPackGenerationMode;
  readonly generationModel: string | null;
  readonly generationMessage: string | null;
  readonly generationUsedFallback: boolean;
  readonly generationDurationMs: number | null;
  readonly generationRecipe: TaskPackJsonObject | null;
  readonly diagnostics: TaskPackRevisionDiagnostics | null;
  readonly groundedContextSnapshot: TaskPackGroundedContextSnapshot | null;
  readonly freshnessBasis: TaskPackFreshnessBasis | null;
}

export interface TaskPackRevision extends TaskPackRevisionContent {
  readonly id: TaskPackRevisionId;
  readonly taskPackId: TaskPackAggregateId;
  readonly revisionNumber: number;
  readonly baseRevisionId: TaskPackRevisionId | null;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly generatedAt: string | null;
}

export interface TaskPackRevisionValidationContext {
  readonly aggregate?: TaskPackAggregate;
  readonly baseRevision?: TaskPackRevision;
  readonly verifyContentHash?: boolean;
}

export interface TaskPackEventValidationContext {
  readonly aggregate?: TaskPackAggregate;
  readonly revision?: TaskPackRevision;
}

export type TaskPackLifecycleDomainErrorCode =
  | "invalid_contract"
  | "invalid_identity"
  | "invalid_transition"
  | "invalid_revision"
  | "invalid_content_hash"
  | "unsafe_context_path";

export class TaskPackLifecycleDomainError extends Error {
  readonly code: TaskPackLifecycleDomainErrorCode;

  constructor(code: TaskPackLifecycleDomainErrorCode, message: string) {
    super(message);
    this.name = "TaskPackLifecycleDomainError";
    this.code = code;
  }
}

export const TASK_PACK_REVISION_HASH_SCHEMA =
  "contextforge.task-pack-revision-content.v1" as const;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const CONTEXT_USAGES = new Set<TaskPackContextUsage>([
  "inspect-and-edit",
  "create-and-edit",
  "inspect-only",
  "asset-reference",
  "config-reference",
]);
const CONTEXT_ROLES = new Set<TaskPackContextRole>([
  "target",
  "test",
  "supporting",
  "reference",
]);
const EVIDENCE_STRENGTHS = new Set<TaskPackEvidenceStrength>([
  "strong",
  "supporting",
  "reference",
]);
const PROOF_CLASSES = new Set<TaskPackGroundingProofClass>([
  "inventory_exact",
  "graph_supported",
  "user_confirmed",
  "direct_definition",
  "direct_document_identity",
  "direct_configuration_identity",
  "direct_source_identity",
  "exact_relationship_chain",
]);
const REVISION_SOURCE_KINDS = new Set<TaskPackRevisionSourceKind>([
  "generated",
  "manual_edit",
  "regenerated",
  "imported",
  "split",
  "legacy_snapshot",
]);
const GENERATION_MODES = new Set<TaskPackGenerationMode>(["template", "ollama"]);
const SELECTOR_ENGINES = new Set<TaskPackSelectorEngine>([
  "legacy",
  "context_engine_v2",
  "manual",
]);
const EVENT_SOURCES = new Set<TaskPackEventSource>(["user", "system", "migration", "import"]);
const FRESHNESS_STATES = new Set<TaskPackFreshnessState>([
  "current",
  "review_recommended",
  "affected",
  "unknown",
]);
const REVISION_CONTENT_FIELDS = [
  "sourceKind",
  "rawTask",
  "taskType",
  "targetTool",
  "generatedPrompt",
  "generationMode",
  "generationModel",
  "generationMessage",
  "generationUsedFallback",
  "generationDurationMs",
  "generationRecipe",
  "diagnostics",
  "groundedContextSnapshot",
  "freshnessBasis",
] as const;
const GENERATION_RECIPE_DIAGNOSTIC_FIELDS = new Set([
  "selectorDiagnostics",
  "generationDiagnostics",
  "performanceDiagnostics",
]);
const VOLATILE_DIAGNOSTIC_FIELDS = new Set([
  "timestamp",
  "timestamps",
  "timings",
  "durationMs",
  "elapsedMs",
  "latencyMs",
  "totalMs",
  "legacyMs",
  "shadowMs",
  "firstExecutionMs",
  "replayExecutionMs",
  "scanMs",
  "preparationMs",
  "decisionMs",
  "projectionMs",
  "validationMs",
  "requestDurationMs",
  "wallTimeMs",
  "cpuTimeMs",
  "createdAt",
  "updatedAt",
  "startedAt",
  "completedAt",
  "endedAt",
  "generatedAt",
  "observedAt",
]);

/**
 * Canonical revision hash envelope (v1).
 *
 * Included: immutable authored/generated content, all ordinary generation
 * recipe configuration, diagnostic evidence/counters, grounded context
 * identity, file roles/proofs, and freshness evidence. Only explicitly named
 * timing/timestamp fields inside known diagnostic subtrees are filtered.
 *
 * Excluded: database identities, revision ancestry/number, creation or
 * generation timestamps, lifecycle/review state, and performance timings.
 * Object keys are sorted, CRLF/CR text is normalized to LF, and proof classes
 * (the sole set-valued collection) are sorted/deduplicated. Selected-file and
 * all other array ordering remains significant. Canonicalization creates a
 * hash-only projection and never rewrites the supplied revision values.
 */
interface TaskPackRevisionHashEnvelope {
  readonly schema: typeof TASK_PACK_REVISION_HASH_SCHEMA;
  readonly content: TaskPackJsonObject;
}

export function transitionTaskPackLifecycle(
  current: TaskPackLifecycle,
  event: TaskPackLifecycleTransitionEvent,
): TaskPackLifecycle {
  assertTaskPackLifecycle(current);

  if (current.state === "active" && event.type === "complete") {
    return { state: "completed", archivedFromState: null };
  }
  if (current.state === "active" && event.type === "archive") {
    return { state: "archived", archivedFromState: "active" };
  }
  if (current.state === "completed" && event.type === "reopen") {
    return { state: "active", archivedFromState: null };
  }
  if (current.state === "completed" && event.type === "archive") {
    return { state: "archived", archivedFromState: "completed" };
  }
  if (current.state === "archived" && event.type === "unarchive") {
    return { state: current.archivedFromState, archivedFromState: null };
  }

  throw invalidTransition("aggregate lifecycle", current.state, event.type);
}

/**
 * Aggregate-aware lifecycle transition. Completion is only legal when the
 * current revision is already the explicitly accepted revision. The returned
 * lifecycle is a new value; the supplied aggregate is never mutated.
 */
export function transitionTaskPackAggregateLifecycle(
  aggregate: TaskPackAggregate,
  event: TaskPackLifecycleTransitionEvent,
): TaskPackLifecycle {
  assertTaskPackAggregate(aggregate);
  if (
    event.type === "complete" &&
    aggregate.acceptedRevisionId !== aggregate.currentRevisionId
  ) {
    throw new TaskPackLifecycleDomainError(
      "invalid_transition",
      "A Task Pack can only be completed when its current revision is accepted.",
    );
  }
  return transitionTaskPackLifecycle(aggregate.lifecycle, event);
}

export function transitionTaskPackReview(
  current: TaskPackReviewState,
  event: TaskPackReviewTransitionEvent,
): TaskPackReviewState {
  assertReviewState(current);

  if (current === "unreviewed" && event.type === "start_review") return "in_review";
  if (current === "unreviewed" && event.type === "accept") return "accepted";
  if (current === "in_review" && event.type === "accept") return "accepted";
  if (current === "in_review" && event.type === "request_changes") {
    return "changes_requested";
  }

  throw invalidTransition("revision review", current, event.type);
}

export function transitionTaskPackDraft(
  current: TaskPackDraftLifecycle,
  event: TaskPackDraftTransitionEvent,
): TaskPackDraftLifecycle {
  assertTaskPackDraftLifecycle(current);

  if (current.state === "active" && event.type === "materialize") {
    assertPositiveInteger(event.revisionId, "draft materialized revision identity");
    return { state: "materialized", materializedRevisionId: event.revisionId };
  }
  if (current.state === "active" && event.type === "discard") {
    return { state: "discarded", materializedRevisionId: null };
  }

  throw invalidTransition("draft lifecycle", current.state, event.type);
}

export function assertTaskPackAggregate(value: unknown): asserts value is TaskPackAggregate {
  const aggregate = assertClosedRecord(value, "Task Pack aggregate", [
    "id",
    "projectId",
    "title",
    "lifecycle",
    "currentRevisionId",
    "acceptedRevisionId",
    "lifecycleVersion",
    "createdAt",
    "updatedAt",
    "completedAt",
    "archivedAt",
  ]);
  assertPositiveInteger(aggregate.id, "aggregate identity");
  assertPositiveInteger(aggregate.projectId, "aggregate project identity");
  assertNonEmptyString(aggregate.title, "aggregate title");
  assertTaskPackLifecycle(aggregate.lifecycle);
  assertPositiveInteger(aggregate.currentRevisionId, "current revision identity");
  assertNullablePositiveInteger(aggregate.acceptedRevisionId, "accepted revision identity");
  assertPositiveInteger(aggregate.lifecycleVersion, "lifecycle version");
  assertIsoTimestamp(aggregate.createdAt, "aggregate createdAt");
  assertIsoTimestamp(aggregate.updatedAt, "aggregate updatedAt");
  assertNullableIsoTimestamp(aggregate.completedAt, "aggregate completedAt");
  assertNullableIsoTimestamp(aggregate.archivedAt, "aggregate archivedAt");

  const lifecycle = aggregate.lifecycle as TaskPackLifecycle;
  if (lifecycle.state === "completed") {
    if (aggregate.acceptedRevisionId !== aggregate.currentRevisionId) {
      invalidContract("A completed Task Pack must have its current revision accepted.");
    }
    if (aggregate.completedAt === null) {
      invalidContract("A completed Task Pack must record completedAt.");
    }
  }
  if (lifecycle.state === "archived") {
    if (aggregate.archivedAt === null) {
      invalidContract("An archived Task Pack must record archivedAt.");
    }
    if (
      lifecycle.archivedFromState === "completed" &&
      (aggregate.acceptedRevisionId !== aggregate.currentRevisionId || aggregate.completedAt === null)
    ) {
      invalidContract("A Task Pack archived from completed must retain completed-state evidence.");
    }
  } else if (aggregate.archivedAt !== null) {
    invalidContract("A non-archived Task Pack cannot record archivedAt.");
  }
}

export function assertPersistedTaskPackDraft(
  value: unknown,
): asserts value is PersistedTaskPackDraft {
  const draft = assertClosedRecord(value, "persisted Task Pack draft", [
    "id",
    "projectId",
    "taskPackId",
    "baseRevisionId",
    "content",
    "lifecycle",
    "draftVersion",
    "createdAt",
    "updatedAt",
    "expiresAt",
  ]);
  assertOpaqueIdentity(draft.id, "draft identity");
  assertPositiveInteger(draft.projectId, "draft project identity");
  assertNullablePositiveInteger(draft.taskPackId, "draft Task Pack identity");
  assertNullablePositiveInteger(draft.baseRevisionId, "draft base revision identity");
  assertTaskPackDraftContent(draft.content);
  assertTaskPackDraftLifecycle(draft.lifecycle);
  assertPositiveInteger(draft.draftVersion, "draft version");
  assertIsoTimestamp(draft.createdAt, "draft createdAt");
  assertIsoTimestamp(draft.updatedAt, "draft updatedAt");
  assertNullableIsoTimestamp(draft.expiresAt, "draft expiresAt");
  if (draft.baseRevisionId !== null && draft.taskPackId === null) {
    invalidContract("A draft with a base revision must belong to a Task Pack aggregate.");
  }
}

export function assertTaskPackRevision(
  value: unknown,
  context: TaskPackRevisionValidationContext = {},
): asserts value is TaskPackRevision {
  const revision = assertClosedRecord(value, "Task Pack revision", [
    "id",
    "taskPackId",
    "revisionNumber",
    "baseRevisionId",
    ...REVISION_CONTENT_FIELDS,
    "contentHash",
    "createdAt",
    "generatedAt",
  ]);
  assertPositiveInteger(revision.id, "revision identity");
  assertPositiveInteger(revision.taskPackId, "revision Task Pack identity");
  assertPositiveInteger(revision.revisionNumber, "revision number");
  assertNullablePositiveInteger(revision.baseRevisionId, "base revision identity");
  assertRevisionContent(revisionContentFromRecord(revision));
  assertContentHash(revision.contentHash, "revision content hash");
  assertIsoTimestamp(revision.createdAt, "revision createdAt");
  assertNullableIsoTimestamp(revision.generatedAt, "revision generatedAt");

  const typed = revision as unknown as TaskPackRevision;
  if (typed.revisionNumber === 1 && typed.baseRevisionId !== null) {
    invalidRevision("Revision 1 cannot reference a base revision.");
  }
  if (typed.revisionNumber > 1 && typed.baseRevisionId === null) {
    invalidRevision("A revision after revision 1 must reference a base revision.");
  }
  if (typed.baseRevisionId === typed.id) {
    invalidRevision("A revision cannot use itself as its base revision.");
  }
  if (
    (typed.sourceKind === "generated" || typed.sourceKind === "regenerated") &&
    typed.generatedAt === null
  ) {
    invalidRevision("Generated and regenerated revisions must record generatedAt.");
  }
  if (
    typed.sourceKind !== "generated" &&
    typed.sourceKind !== "regenerated" &&
    typed.generatedAt !== null
  ) {
    invalidRevision("Only generated and regenerated revisions may record generatedAt.");
  }

  if (context.aggregate !== undefined) {
    assertTaskPackAggregate(context.aggregate);
    if (context.aggregate.id !== typed.taskPackId) {
      invalidRevision("Revision aggregate ownership is inconsistent.");
    }
  }

  if (context.baseRevision !== undefined) {
    assertTaskPackRevision(context.baseRevision, { verifyContentHash: context.verifyContentHash });
    if (typed.baseRevisionId !== context.baseRevision.id) {
      invalidRevision("The supplied base revision does not match baseRevisionId.");
    }
    if (typed.taskPackId !== context.baseRevision.taskPackId) {
      invalidRevision("A revision cannot change aggregate ownership.");
    }
    if (context.baseRevision.revisionNumber >= typed.revisionNumber) {
      invalidRevision("A base revision must precede the derived revision.");
    }
  }

  if (context.verifyContentHash !== false) {
    const computed = computeTaskPackRevisionContentHash(revisionContentFromRecord(typed));
    if (computed !== typed.contentHash) {
      throw new TaskPackLifecycleDomainError(
        "invalid_content_hash",
        "Revision content hash does not match its canonical immutable content.",
      );
    }
  }
}

export function assertTaskPackAggregateLifecycleEvent(
  value: unknown,
  context: TaskPackEventValidationContext = {},
): asserts value is TaskPackAggregateLifecycleEvent {
  const event = assertClosedRecord(value, "Task Pack aggregate lifecycle event", [
    "id",
    "taskPackId",
    "eventType",
    "fromState",
    "toState",
    "revisionId",
    "source",
    "actorId",
    "createdAt",
    "metadata",
  ]);
  assertOpaqueIdentity(event.id, "aggregate event identity");
  assertPositiveInteger(event.taskPackId, "aggregate event Task Pack identity");
  assertNullablePositiveInteger(event.revisionId, "aggregate event revision identity");
  assertEventSource(event.source);
  assertNullableString(event.actorId, "aggregate event actorId");
  assertIsoTimestamp(event.createdAt, "aggregate event createdAt");
  assertNullableJsonObject(event.metadata, "aggregate event metadata");
  const transitionType = lifecycleTransitionTypeFromRecord(event.eventType);
  if (transitionType === "complete" && event.revisionId === null) {
    invalidContract("A completed lifecycle event must reference its accepted revision.");
  }
  const current = lifecycleFromEventRecord(event.fromState, transitionType, event.toState);
  const next = transitionTaskPackLifecycle(current, { type: transitionType });
  if (next.state !== event.toState) {
    invalidContract("Aggregate lifecycle event toState does not match its transition.");
  }

  if (context.aggregate !== undefined) {
    assertTaskPackAggregate(context.aggregate);
    if (
      event.taskPackId !== context.aggregate.id ||
      event.fromState !== context.aggregate.lifecycle.state
    ) {
      invalidContract("Aggregate lifecycle event does not belong to the supplied aggregate state.");
    }
    if (
      transitionType === "complete" &&
      (event.revisionId !== context.aggregate.currentRevisionId ||
        event.revisionId !== context.aggregate.acceptedRevisionId)
    ) {
      invalidContract("Completion event must reference the accepted current revision.");
    }
  }
  if (context.revision !== undefined) {
    assertTaskPackRevision(context.revision);
    if (
      context.revision.taskPackId !== event.taskPackId ||
      (event.revisionId !== null && context.revision.id !== event.revisionId)
    ) {
      invalidContract("Aggregate lifecycle event revision ownership is inconsistent.");
    }
  }
}

export function assertTaskPackRevisionReviewEvent(
  value: unknown,
  context: TaskPackEventValidationContext = {},
): asserts value is TaskPackRevisionReviewEvent {
  const event = assertClosedRecord(value, "Task Pack revision review event", [
    "id",
    "taskPackId",
    "revisionId",
    "eventType",
    "fromState",
    "toState",
    "source",
    "actorId",
    "createdAt",
    "metadata",
  ]);
  assertOpaqueIdentity(event.id, "review event identity");
  assertPositiveInteger(event.taskPackId, "review event Task Pack identity");
  assertPositiveInteger(event.revisionId, "review event revision identity");
  assertEventSource(event.source);
  assertNullableString(event.actorId, "review event actorId");
  assertIsoTimestamp(event.createdAt, "review event createdAt");
  assertNullableJsonObject(event.metadata, "review event metadata");
  assertReviewState(event.fromState);
  assertReviewState(event.toState);
  const transitionType = reviewTransitionTypeFromRecord(event.eventType);
  const next = transitionTaskPackReview(event.fromState as TaskPackReviewState, {
    type: transitionType,
  });
  if (next !== event.toState) {
    invalidContract("Revision review event toState does not match its transition.");
  }

  if (context.aggregate !== undefined) {
    assertTaskPackAggregate(context.aggregate);
    if (event.taskPackId !== context.aggregate.id) {
      invalidContract("Revision review event belongs to another aggregate.");
    }
  }
  if (context.revision !== undefined) {
    assertTaskPackRevision(context.revision);
    if (
      event.revisionId !== context.revision.id ||
      event.taskPackId !== context.revision.taskPackId
    ) {
      invalidContract("Revision review event revision ownership is inconsistent.");
    }
  }
}

export function computeTaskPackRevisionContentHash(
  content: TaskPackRevisionContent,
): string {
  assertRevisionContent(content);
  const envelope: TaskPackRevisionHashEnvelope = {
    schema: TASK_PACK_REVISION_HASH_SCHEMA,
    content: buildRevisionHashContent(content),
  };
  const canonical = canonicalJson(envelope as unknown as TaskPackJsonValue);
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function revisionContentFromRecord(
  value: TaskPackRevision | Record<string, unknown>,
): TaskPackRevisionContent {
  const record = value as unknown as Record<string, unknown>;
  const content: Record<string, unknown> = {};
  for (const field of REVISION_CONTENT_FIELDS) content[field] = record[field];
  return content as unknown as TaskPackRevisionContent;
}

export function isTaskPackRevisionContentHash(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function buildRevisionHashContent(content: TaskPackRevisionContent): TaskPackJsonObject {
  return {
    sourceKind: content.sourceKind,
    rawTask: normalizeText(content.rawTask),
    taskType: normalizeText(content.taskType),
    targetTool: normalizeText(content.targetTool),
    generatedPrompt: normalizeText(content.generatedPrompt),
    generationMode: content.generationMode,
    generationModel: normalizeNullableText(content.generationModel),
    generationMessage: normalizeNullableText(content.generationMessage),
    generationUsedFallback: content.generationUsedFallback,
    generationRecipe: canonicalizeGenerationRecipe(content.generationRecipe),
    diagnostics:
      content.diagnostics === null
        ? null
        : {
            selector: stripVolatileDiagnosticFields(content.diagnostics.selector),
            generation: stripVolatileDiagnosticFields(content.diagnostics.generation),
            performance: stripVolatileDiagnosticFields(content.diagnostics.performance),
          },
    groundedContextSnapshot:
      content.groundedContextSnapshot === null
        ? null
        : {
            schemaVersion: content.groundedContextSnapshot.schemaVersion,
            selectorEngine: content.groundedContextSnapshot.selectorEngine,
            selectorConfigurationFingerprint:
              content.groundedContextSnapshot.selectorConfigurationFingerprint,
            repositoryObservationFingerprint:
              content.groundedContextSnapshot.repositoryObservationFingerprint,
            repositorySnapshotFingerprint:
              content.groundedContextSnapshot.repositorySnapshotFingerprint,
            selectorSnapshotFingerprint:
              content.groundedContextSnapshot.selectorSnapshotFingerprint,
            selectedFiles: content.groundedContextSnapshot.selectedFiles.map((file) => ({
              path: normalizeRepositoryRelativePath(file.path),
              role: file.role,
              usage: file.usage,
              evidenceStrength: file.evidenceStrength,
              proofClasses: [...new Set(file.proofClasses)].sort(),
            })),
          },
    freshnessBasis:
      content.freshnessBasis === null
        ? null
        : {
            schemaVersion: content.freshnessBasis.schemaVersion,
            stateAtCreation: content.freshnessBasis.stateAtCreation,
            projectAwarenessFingerprint:
              content.freshnessBasis.projectAwarenessFingerprint,
            inventoryFingerprint: content.freshnessBasis.inventoryFingerprint,
            policyVersion: normalizeNullableText(content.freshnessBasis.policyVersion),
            comparisonLimited: content.freshnessBasis.comparisonLimited,
          },
  };
}

function stripVolatileDiagnosticFields(
  value: TaskPackJsonObject | null,
): TaskPackJsonObject | null {
  if (value === null) return null;
  return stripVolatileJsonValue(value) as TaskPackJsonObject;
}

function canonicalizeGenerationRecipe(
  value: TaskPackJsonObject | null,
): TaskPackJsonObject | null {
  if (value === null) return null;
  const result: Record<string, TaskPackJsonValue> = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    result[key] = GENERATION_RECIPE_DIAGNOSTIC_FIELDS.has(key)
      ? stripVolatileJsonValue(item)
      : item;
  }
  return result;
}

function stripVolatileJsonValue(value: TaskPackJsonValue): TaskPackJsonValue {
  if (typeof value === "string") return normalizeText(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(stripVolatileJsonValue);

  const objectValue = value as TaskPackJsonObject;
  const result: Record<string, TaskPackJsonValue> = {};
  for (const key of Object.keys(objectValue).sort()) {
    if (VOLATILE_DIAGNOSTIC_FIELDS.has(key)) continue;
    result[key] = stripVolatileJsonValue(objectValue[key]);
  }
  return result;
}

function canonicalJson(value: TaskPackJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(normalizeText(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidContract("Canonical JSON cannot contain non-finite numbers.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const objectValue = value as TaskPackJsonObject;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`)
    .join(",")}}`;
}

function assertRevisionContent(value: unknown): asserts value is TaskPackRevisionContent {
  const content = assertClosedRecord(
    value,
    "Task Pack revision content",
    REVISION_CONTENT_FIELDS,
  );
  if (!REVISION_SOURCE_KINDS.has(content.sourceKind as TaskPackRevisionSourceKind)) {
    invalidContract("Revision sourceKind is invalid.");
  }
  assertNonEmptyString(content.rawTask, "revision rawTask");
  assertNonEmptyString(content.taskType, "revision taskType");
  assertNonEmptyString(content.targetTool, "revision targetTool");
  assertString(content.generatedPrompt, "revision generatedPrompt");
  if (!GENERATION_MODES.has(content.generationMode as TaskPackGenerationMode)) {
    invalidContract("Revision generationMode is invalid.");
  }
  assertNullableString(content.generationModel, "revision generationModel");
  assertNullableString(content.generationMessage, "revision generationMessage");
  if (typeof content.generationUsedFallback !== "boolean") {
    invalidContract("Revision generationUsedFallback must be boolean.");
  }
  if (
    content.generationDurationMs !== null &&
    (typeof content.generationDurationMs !== "number" ||
      !Number.isFinite(content.generationDurationMs) ||
      content.generationDurationMs < 0)
  ) {
    invalidContract("Revision generationDurationMs must be null or a non-negative number.");
  }
  assertNullableJsonObject(content.generationRecipe, "revision generationRecipe");
  assertRevisionDiagnostics(content.diagnostics);
  assertGroundedContextSnapshot(content.groundedContextSnapshot);
  assertFreshnessBasis(content.freshnessBasis);
}

function assertTaskPackLifecycle(value: unknown): asserts value is TaskPackLifecycle {
  const lifecycle = assertClosedRecord(value, "Task Pack lifecycle", [
    "state",
    "archivedFromState",
  ]);
  if (lifecycle.state === "archived") {
    if (lifecycle.archivedFromState !== "active" && lifecycle.archivedFromState !== "completed") {
      invalidContract("Archived lifecycle must retain its prior active/completed state.");
    }
    return;
  }
  if (lifecycle.state !== "active" && lifecycle.state !== "completed") {
    invalidContract("Task Pack lifecycle state is invalid.");
  }
  if (lifecycle.archivedFromState !== null) {
    invalidContract("Non-archived lifecycle cannot retain archivedFromState.");
  }
}

function assertTaskPackDraftLifecycle(value: unknown): asserts value is TaskPackDraftLifecycle {
  const lifecycle = assertClosedRecord(value, "Task Pack draft lifecycle", [
    "state",
    "materializedRevisionId",
  ]);
  if (lifecycle.state === "materialized") {
    assertPositiveInteger(lifecycle.materializedRevisionId, "materialized revision identity");
    return;
  }
  if (lifecycle.state !== "active" && lifecycle.state !== "discarded") {
    invalidContract("Task Pack draft lifecycle state is invalid.");
  }
  if (lifecycle.materializedRevisionId !== null) {
    invalidContract("Only a materialized draft may reference a resulting revision.");
  }
}

function assertTaskPackDraftContent(value: unknown): asserts value is TaskPackDraftContent {
  const content = assertClosedRecord(value, "Task Pack draft content", [
    "rawTask",
    "taskType",
    "targetTool",
    "templateId",
    "ruleProfileId",
    "enabledRuleIds",
    "customRulesText",
    "acceptanceCriteriaPresetId",
    "acceptanceCriteriaText",
    "clarifications",
    "performanceSessionId",
    "understandingSnapshotId",
    "reviewedUnderstandingSnapshotId",
  ]);
  assertNonEmptyString(content.rawTask, "draft rawTask");
  assertNonEmptyString(content.taskType, "draft taskType");
  assertNonEmptyString(content.targetTool, "draft targetTool");
  assertNullableString(content.templateId, "draft templateId");
  assertNullableString(content.ruleProfileId, "draft ruleProfileId");
  assertStringArray(content.enabledRuleIds, "draft enabledRuleIds");
  assertNullableString(content.customRulesText, "draft customRulesText");
  assertNullableString(content.acceptanceCriteriaPresetId, "draft acceptanceCriteriaPresetId");
  assertNullableString(content.acceptanceCriteriaText, "draft acceptanceCriteriaText");
  assertNullableString(content.performanceSessionId, "draft performanceSessionId");
  assertNullableString(content.understandingSnapshotId, "draft understandingSnapshotId");
  assertNullableString(
    content.reviewedUnderstandingSnapshotId,
    "draft reviewedUnderstandingSnapshotId",
  );
  if (!Array.isArray(content.clarifications)) {
    invalidContract("Draft clarifications must be an array.");
  }
  for (const clarification of content.clarifications) {
    const item = assertClosedRecord(clarification, "draft clarification", ["question", "answer"]);
    assertNonEmptyString(item.question, "draft clarification question");
    assertString(item.answer, "draft clarification answer");
  }
}

function assertRevisionDiagnostics(value: unknown): asserts value is TaskPackRevisionDiagnostics | null {
  if (value === null) return;
  const diagnostics = assertClosedRecord(value, "revision diagnostics", [
    "selector",
    "generation",
    "performance",
  ]);
  assertNullableJsonObject(diagnostics.selector, "selector diagnostics");
  assertNullableJsonObject(diagnostics.generation, "generation diagnostics");
  assertNullableJsonObject(diagnostics.performance, "performance diagnostics");
}

function assertGroundedContextSnapshot(
  value: unknown,
): asserts value is TaskPackGroundedContextSnapshot | null {
  if (value === null) return;
  const snapshot = assertClosedRecord(value, "grounded context snapshot", [
    "schemaVersion",
    "selectorEngine",
    "selectorConfigurationFingerprint",
    "repositoryObservationFingerprint",
    "repositorySnapshotFingerprint",
    "selectorSnapshotFingerprint",
    "selectedFiles",
  ]);
  if (snapshot.schemaVersion !== 1) invalidContract("Grounded context schemaVersion must be 1.");
  if (!SELECTOR_ENGINES.has(snapshot.selectorEngine as TaskPackSelectorEngine)) {
    invalidContract("Grounded context selectorEngine is invalid.");
  }
  assertNullableContentHash(
    snapshot.selectorConfigurationFingerprint,
    "selector configuration fingerprint",
  );
  assertNullableContentHash(
    snapshot.repositoryObservationFingerprint,
    "repository observation fingerprint",
  );
  assertNullableContentHash(
    snapshot.repositorySnapshotFingerprint,
    "repository snapshot fingerprint",
  );
  assertNullableContentHash(snapshot.selectorSnapshotFingerprint, "selector snapshot fingerprint");
  if (!Array.isArray(snapshot.selectedFiles)) {
    invalidContract("Grounded context selectedFiles must be an array.");
  }
  const paths = new Set<string>();
  for (const selectedFile of snapshot.selectedFiles) {
    const file = assertClosedRecord(selectedFile, "grounded context file", [
      "path",
      "role",
      "usage",
      "evidenceStrength",
      "proofClasses",
    ]);
    assertSafeRepositoryRelativePath(file.path);
    const normalizedPath = normalizeRepositoryRelativePath(file.path as string);
    if (paths.has(normalizedPath)) invalidContract("Grounded context paths must be unique.");
    paths.add(normalizedPath);
    if (!CONTEXT_ROLES.has(file.role as TaskPackContextRole)) {
      invalidContract("Grounded context role is invalid.");
    }
    if (!CONTEXT_USAGES.has(file.usage as TaskPackContextUsage)) {
      invalidContract("Grounded context usage is invalid.");
    }
    if (!EVIDENCE_STRENGTHS.has(file.evidenceStrength as TaskPackEvidenceStrength)) {
      invalidContract("Grounded context evidenceStrength is invalid.");
    }
    if (!Array.isArray(file.proofClasses) || file.proofClasses.length === 0) {
      invalidContract("Grounded context proofClasses must be a non-empty array.");
    }
    const proofs = new Set<string>();
    for (const proofClass of file.proofClasses) {
      if (!PROOF_CLASSES.has(proofClass as TaskPackGroundingProofClass)) {
        invalidContract("Grounded context proof class is invalid.");
      }
      if (proofs.has(proofClass as string)) {
        invalidContract("Grounded context proof classes must be unique.");
      }
      proofs.add(proofClass as string);
    }
  }
}

function assertFreshnessBasis(value: unknown): asserts value is TaskPackFreshnessBasis | null {
  if (value === null) return;
  const freshness = assertClosedRecord(value, "Task Pack freshness basis", [
    "schemaVersion",
    "stateAtCreation",
    "projectAwarenessFingerprint",
    "inventoryFingerprint",
    "policyVersion",
    "comparisonLimited",
    "observedAt",
    "previousObservedAt",
  ]);
  if (freshness.schemaVersion !== 1) invalidContract("Freshness schemaVersion must be 1.");
  if (!FRESHNESS_STATES.has(freshness.stateAtCreation as TaskPackFreshnessState)) {
    invalidContract("Freshness stateAtCreation is invalid.");
  }
  assertNullableContentHash(
    freshness.projectAwarenessFingerprint,
    "project awareness fingerprint",
  );
  assertNullableContentHash(freshness.inventoryFingerprint, "inventory fingerprint");
  assertNullableString(freshness.policyVersion, "freshness policyVersion");
  if (typeof freshness.comparisonLimited !== "boolean") {
    invalidContract("Freshness comparisonLimited must be boolean.");
  }
  assertNullableIsoTimestamp(freshness.observedAt, "freshness observedAt");
  assertNullableIsoTimestamp(freshness.previousObservedAt, "freshness previousObservedAt");
}

function assertNullableJsonObject(value: unknown, label: string): asserts value is TaskPackJsonObject | null {
  if (value === null) return;
  if (!isPlainRecord(value)) invalidContract(`${label} must be null or a JSON object.`);
  assertJsonValue(value, label);
}

function assertJsonValue(value: unknown, label: string): asserts value is TaskPackJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidContract(`${label} cannot contain a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, label);
    return;
  }
  if (!isPlainRecord(value)) invalidContract(`${label} must contain only JSON values.`);
  for (const item of Object.values(value)) assertJsonValue(item, label);
}

function lifecycleFromEventRecord(
  fromState: unknown,
  eventType: TaskPackLifecycleTransitionEvent["type"],
  toState: unknown,
): TaskPackLifecycle {
  if (fromState === "archived") {
    if (eventType !== "unarchive" || (toState !== "active" && toState !== "completed")) {
      invalidContract("Archived lifecycle event is malformed.");
    }
    return { state: "archived", archivedFromState: toState };
  }
  if (fromState !== "active" && fromState !== "completed") {
    invalidContract("Aggregate lifecycle event fromState is invalid.");
  }
  return { state: fromState, archivedFromState: null };
}

function lifecycleTransitionTypeFromRecord(
  value: unknown,
): TaskPackLifecycleTransitionEvent["type"] {
  switch (value) {
    case "completed":
      return "complete";
    case "reopened":
      return "reopen";
    case "archived":
      return "archive";
    case "unarchived":
      return "unarchive";
    default:
      invalidContract("Aggregate lifecycle eventType is invalid.");
  }
}

function reviewTransitionTypeFromRecord(
  value: unknown,
): TaskPackReviewTransitionEvent["type"] {
  switch (value) {
    case "review_started":
      return "start_review";
    case "accepted":
      return "accept";
    case "changes_requested":
      return "request_changes";
    default:
      invalidContract("Revision review eventType is invalid.");
  }
}

function assertEventSource(value: unknown): asserts value is TaskPackEventSource {
  if (!EVENT_SOURCES.has(value as TaskPackEventSource)) {
    invalidContract("Task Pack event source is invalid.");
  }
}

function assertReviewState(value: unknown): asserts value is TaskPackReviewState {
  if (
    value !== "unreviewed" &&
    value !== "in_review" &&
    value !== "accepted" &&
    value !== "changes_requested"
  ) {
    invalidContract("Task Pack review state is invalid.");
  }
}

function assertSafeRepositoryRelativePath(value: unknown): asserts value is string {
  assertNonEmptyString(value, "grounded context path");
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment.length === 0) ||
    normalized.includes("\0")
  ) {
    throw new TaskPackLifecycleDomainError(
      "unsafe_context_path",
      "Grounded context paths must be safe repository-relative paths.",
    );
  }
}

function assertClosedRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const record = assertRecord(value, label);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalidContract(`${label} contains unknown field ${key}.`);
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      invalidContract(`${label} is missing required field ${key}.`);
    }
  }
  return record;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) invalidContract(`${label} must be a plain object.`);
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TaskPackLifecycleDomainError("invalid_identity", `${label} must be a positive integer.`);
  }
}

function assertNullablePositiveInteger(value: unknown, label: string): asserts value is number | null {
  if (value === null) return;
  assertPositiveInteger(value, label);
}

function assertOpaqueIdentity(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if ((value as string).length > 200 || /[\u0000-\u001f]/u.test(value as string)) {
    throw new TaskPackLifecycleDomainError("invalid_identity", `${label} is malformed.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") invalidContract(`${label} must be a string.`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (value.trim().length === 0) invalidContract(`${label} must not be empty.`);
}

function assertNullableString(value: unknown, label: string): asserts value is string | null {
  if (value === null) return;
  assertString(value, label);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    invalidContract(`${label} must be a string array.`);
  }
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    invalidContract(`${label} must be an ISO-8601 UTC timestamp.`);
  }
}

function assertNullableIsoTimestamp(value: unknown, label: string): asserts value is string | null {
  if (value === null) return;
  assertIsoTimestamp(value, label);
}

function assertContentHash(value: unknown, label: string): asserts value is string {
  if (!isTaskPackRevisionContentHash(value)) {
    throw new TaskPackLifecycleDomainError(
      "invalid_content_hash",
      `${label} must be a lowercase SHA-256 fingerprint.`,
    );
  }
}

function assertNullableContentHash(value: unknown, label: string): asserts value is string | null {
  if (value === null) return;
  assertContentHash(value, label);
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function normalizeRepositoryRelativePath(value: string): string {
  return normalizeText(value).replaceAll("\\", "/");
}

function normalizeNullableText(value: string | null): string | null {
  return value === null ? null : normalizeText(value);
}

function invalidContract(message: string): never {
  throw new TaskPackLifecycleDomainError("invalid_contract", message);
}

function invalidRevision(message: string): never {
  throw new TaskPackLifecycleDomainError("invalid_revision", message);
}

function invalidTransition(scope: string, state: string, event: string): TaskPackLifecycleDomainError {
  return new TaskPackLifecycleDomainError(
    "invalid_transition",
    `Illegal ${scope} transition: ${state} -> ${event}.`,
  );
}
