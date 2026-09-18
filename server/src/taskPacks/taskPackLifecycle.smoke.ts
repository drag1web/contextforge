import assert from "node:assert/strict";

import {
  TaskPackLifecycleDomainError,
  assertPersistedTaskPackDraft,
  assertTaskPackAggregate,
  assertTaskPackAggregateLifecycleEvent,
  assertTaskPackRevision,
  assertTaskPackRevisionReviewEvent,
  computeTaskPackRevisionContentHash,
  isTaskPackRevisionContentHash,
  transitionTaskPackDraft,
  transitionTaskPackAggregateLifecycle,
  transitionTaskPackLifecycle,
  transitionTaskPackReview,
  type PersistedTaskPackDraft,
  type TaskPackAggregate,
  type TaskPackDraftLifecycle,
  type TaskPackDraftTransitionEvent,
  type TaskPackLifecycle,
  type TaskPackLifecycleTransitionEvent,
  type TaskPackRevision,
  type TaskPackRevisionContent,
  type TaskPackReviewState,
  type TaskPackReviewTransitionEvent,
} from "./taskPackLifecycle.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];

function scenario(name: string, run: SmokeScenario["run"]): void {
  scenarios.push({ name, run });
}

function expectDomainError(
  run: () => unknown,
  code: TaskPackLifecycleDomainError["code"],
): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof TaskPackLifecycleDomainError);
    assert.equal(error.code, code);
    return true;
  });
}

const fingerprintA = `sha256:${"a".repeat(64)}`;
const fingerprintB = `sha256:${"b".repeat(64)}`;
const revisionContentHasTitle: "title" extends keyof TaskPackRevisionContent ? true : false = false;
const revisionHasProjectId: "projectId" extends keyof TaskPackRevision ? true : false = false;

function baseRevisionContent(): TaskPackRevisionContent {
  return {
    sourceKind: "generated",
    rawTask: "Improve the settings page.\r\nKeep existing behavior.",
    taskType: "ui",
    targetTool: "codex",
    generatedPrompt: "Update SettingsPage.\r\nRun focused tests.",
    generationMode: "template",
    generationModel: null,
    generationMessage: "Generated from grounded context.",
    generationUsedFallback: false,
    generationDurationMs: 18.4,
    generationRecipe: {
      schemaVersion: 2,
      policy: { mode: "guarded", requiredLayers: ["ui", "tests"] },
      attempts: [{ durationMs: 17.2, outcome: "success" }],
    },
    diagnostics: {
      selector: { pipeline: "legacy", manualReview: false, elapsedMs: 14 },
      generation: { outcome: "success", startedAt: "2026-09-18T08:00:00.000Z" },
      performance: { totalMs: 18.4, parses: 2 },
    },
    groundedContextSnapshot: {
      schemaVersion: 1,
      selectorEngine: "legacy",
      selectorConfigurationFingerprint: fingerprintA,
      repositoryObservationFingerprint: fingerprintB,
      repositorySnapshotFingerprint: fingerprintA,
      selectorSnapshotFingerprint: fingerprintB,
      selectedFiles: [
        {
          path: "apps/desktop/renderer/src/pages/SettingsPage.tsx",
          role: "target",
          usage: "inspect-and-edit",
          evidenceStrength: "strong",
          proofClasses: ["inventory_exact", "direct_source_identity"],
        },
        {
          path: "package.json",
          role: "reference",
          usage: "config-reference",
          evidenceStrength: "reference",
          proofClasses: ["direct_configuration_identity"],
        },
      ],
    },
    freshnessBasis: {
      schemaVersion: 1,
      stateAtCreation: "current",
      projectAwarenessFingerprint: fingerprintA,
      inventoryFingerprint: fingerprintB,
      policyVersion: "task-pack-freshness-v1",
      comparisonLimited: false,
      observedAt: "2026-09-18T07:55:00.000Z",
      previousObservedAt: null,
    },
  };
}

function revision(
  overrides: Partial<TaskPackRevision> = {},
  contentOverrides: Partial<TaskPackRevisionContent> = {},
): TaskPackRevision {
  const content: TaskPackRevisionContent = { ...baseRevisionContent(), ...contentOverrides };
  const value: TaskPackRevision = {
    id: 101,
    taskPackId: 17,
    revisionNumber: 1,
    baseRevisionId: null,
    ...content,
    contentHash: computeTaskPackRevisionContentHash(content),
    createdAt: "2026-09-18T08:00:00.000Z",
    generatedAt: "2026-09-18T08:00:00.000Z",
    ...overrides,
  };
  return value;
}

function aggregate(overrides: Partial<TaskPackAggregate> = {}): TaskPackAggregate {
  return {
    id: 17,
    projectId: 3,
    title: "Improve settings",
    lifecycle: { state: "active", archivedFromState: null },
    currentRevisionId: 101,
    acceptedRevisionId: null,
    lifecycleVersion: 1,
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function draft(overrides: Partial<PersistedTaskPackDraft> = {}): PersistedTaskPackDraft {
  return {
    id: "draft_01J7K3N6R8",
    projectId: 3,
    taskPackId: null,
    baseRevisionId: null,
    content: {
      rawTask: "Improve settings",
      taskType: "ui",
      targetTool: "codex",
      templateId: "default",
      ruleProfileId: null,
      enabledRuleIds: ["safe-edit"],
      customRulesText: null,
      acceptanceCriteriaPresetId: null,
      acceptanceCriteriaText: "Settings remain persisted.",
      clarifications: [{ question: "Which page?", answer: "Settings" }],
      performanceSessionId: null,
      understandingSnapshotId: null,
      reviewedUnderstandingSnapshotId: null,
    },
    lifecycle: { state: "active", materializedRevisionId: null },
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    expiresAt: null,
    ...overrides,
  };
}

const lifecycleCases: readonly (readonly [
  TaskPackLifecycle,
  TaskPackLifecycleTransitionEvent,
  TaskPackLifecycle | null,
])[] = [
  [{ state: "active", archivedFromState: null }, { type: "complete" }, { state: "completed", archivedFromState: null }],
  [{ state: "active", archivedFromState: null }, { type: "reopen" }, null],
  [{ state: "active", archivedFromState: null }, { type: "archive" }, { state: "archived", archivedFromState: "active" }],
  [{ state: "active", archivedFromState: null }, { type: "unarchive" }, null],
  [{ state: "completed", archivedFromState: null }, { type: "complete" }, null],
  [{ state: "completed", archivedFromState: null }, { type: "reopen" }, { state: "active", archivedFromState: null }],
  [{ state: "completed", archivedFromState: null }, { type: "archive" }, { state: "archived", archivedFromState: "completed" }],
  [{ state: "completed", archivedFromState: null }, { type: "unarchive" }, null],
  [{ state: "archived", archivedFromState: "active" }, { type: "complete" }, null],
  [{ state: "archived", archivedFromState: "active" }, { type: "reopen" }, null],
  [{ state: "archived", archivedFromState: "active" }, { type: "archive" }, null],
  [{ state: "archived", archivedFromState: "active" }, { type: "unarchive" }, { state: "active", archivedFromState: null }],
  [{ state: "archived", archivedFromState: "completed" }, { type: "unarchive" }, { state: "completed", archivedFromState: null }],
];

for (const [from, event, to] of lifecycleCases) {
  scenario(`aggregate lifecycle ${from.state}/${event.type}`, () => {
    const before = structuredClone(from);
    if (to === null) {
      expectDomainError(() => transitionTaskPackLifecycle(from, event), "invalid_transition");
    } else {
      assert.deepEqual(transitionTaskPackLifecycle(from, event), to);
    }
    assert.deepEqual(from, before);
  });
}

const reviewStates: readonly TaskPackReviewState[] = [
  "unreviewed",
  "in_review",
  "accepted",
  "changes_requested",
];
const reviewEvents: readonly TaskPackReviewTransitionEvent[] = [
  { type: "start_review" },
  { type: "accept" },
  { type: "request_changes" },
];
const legalReviewTransitions = new Map<string, TaskPackReviewState>([
  ["unreviewed:start_review", "in_review"],
  ["unreviewed:accept", "accepted"],
  ["in_review:accept", "accepted"],
  ["in_review:request_changes", "changes_requested"],
]);

for (const state of reviewStates) {
  for (const event of reviewEvents) {
    scenario(`review lifecycle ${state}/${event.type}`, () => {
      const expected = legalReviewTransitions.get(`${state}:${event.type}`);
      if (expected === undefined) {
        expectDomainError(() => transitionTaskPackReview(state, event), "invalid_transition");
      } else {
        assert.equal(transitionTaskPackReview(state, event), expected);
      }
    });
  }
}

const draftStates: readonly TaskPackDraftLifecycle[] = [
  { state: "active", materializedRevisionId: null },
  { state: "materialized", materializedRevisionId: 101 },
  { state: "discarded", materializedRevisionId: null },
];
const draftEvents: readonly TaskPackDraftTransitionEvent[] = [
  { type: "materialize", revisionId: 101 },
  { type: "discard" },
];

for (const state of draftStates) {
  for (const event of draftEvents) {
    scenario(`draft lifecycle ${state.state}/${event.type}`, () => {
      const before = structuredClone(state);
      if (state.state !== "active") {
        expectDomainError(() => transitionTaskPackDraft(state, event), "invalid_transition");
      } else if (event.type === "materialize") {
        assert.deepEqual(transitionTaskPackDraft(state, event), {
          state: "materialized",
          materializedRevisionId: 101,
        });
      } else {
        assert.deepEqual(transitionTaskPackDraft(state, event), {
          state: "discarded",
          materializedRevisionId: null,
        });
      }
      assert.deepEqual(state, before);
    });
  }
}

scenario("aggregate invariant accepts active aggregate", () => {
  assert.doesNotThrow(() => assertTaskPackAggregate(aggregate()));
});

scenario("aggregate invariant requires accepted current revision for completion", () => {
  expectDomainError(
    () =>
      assertTaskPackAggregate(
        aggregate({
          lifecycle: { state: "completed", archivedFromState: null },
          completedAt: "2026-09-18T09:00:00.000Z",
        }),
      ),
    "invalid_contract",
  );
});

scenario("aggregate invariant accepts completed aggregate with acceptance evidence", () => {
  assert.doesNotThrow(() =>
    assertTaskPackAggregate(
      aggregate({
        lifecycle: { state: "completed", archivedFromState: null },
        acceptedRevisionId: 101,
        completedAt: "2026-09-18T09:00:00.000Z",
      }),
    ),
  );
});

scenario("aggregate-aware completion rejects an unaccepted current revision", () => {
  expectDomainError(
    () => transitionTaskPackAggregateLifecycle(aggregate(), { type: "complete" }),
    "invalid_transition",
  );
});

scenario("aggregate-aware completion accepts the accepted current revision without mutation", () => {
  const value = aggregate({ acceptedRevisionId: 101 });
  const before = structuredClone(value);
  assert.deepEqual(transitionTaskPackAggregateLifecycle(value, { type: "complete" }), {
    state: "completed",
    archivedFromState: null,
  });
  assert.deepEqual(value, before);
});

scenario("aggregate invariant preserves completed evidence while archived", () => {
  assert.doesNotThrow(() =>
    assertTaskPackAggregate(
      aggregate({
        lifecycle: { state: "archived", archivedFromState: "completed" },
        acceptedRevisionId: 101,
        completedAt: "2026-09-18T09:00:00.000Z",
        archivedAt: "2026-09-18T10:00:00.000Z",
      }),
    ),
  );
});

scenario("aggregate lifecycle event validates exact transition", () => {
  assert.doesNotThrow(() =>
    assertTaskPackAggregateLifecycleEvent({
      id: "event_aggregate_1",
      taskPackId: 17,
      eventType: "unarchived",
      fromState: "archived",
      toState: "completed",
      revisionId: 101,
      source: "user",
      actorId: null,
      createdAt: "2026-09-18T10:30:00.000Z",
      metadata: null,
    }),
  );
});

scenario("aggregate lifecycle event rejects false transition", () => {
  expectDomainError(
    () =>
      assertTaskPackAggregateLifecycleEvent({
        id: "event_aggregate_2",
        taskPackId: 17,
        eventType: "completed",
        fromState: "active",
        toState: "active",
        revisionId: 101,
        source: "user",
        actorId: null,
        createdAt: "2026-09-18T10:30:00.000Z",
        metadata: null,
      }),
    "invalid_contract",
  );
});

scenario("completion event requires an accepted revision reference", () => {
  expectDomainError(
    () =>
      assertTaskPackAggregateLifecycleEvent({
        id: "event_aggregate_3",
        taskPackId: 17,
        eventType: "completed",
        fromState: "active",
        toState: "completed",
        revisionId: null,
        source: "user",
        actorId: null,
        createdAt: "2026-09-18T10:30:00.000Z",
        metadata: null,
      }),
    "invalid_contract",
  );
});

scenario("completion event must reference the aggregate accepted current revision", () => {
  expectDomainError(
    () =>
      assertTaskPackAggregateLifecycleEvent(
        {
          id: "event_aggregate_4",
          taskPackId: 17,
          eventType: "completed",
          fromState: "active",
          toState: "completed",
          revisionId: 100,
          source: "user",
          actorId: null,
          createdAt: "2026-09-18T10:30:00.000Z",
          metadata: null,
        },
        { aggregate: aggregate({ acceptedRevisionId: 101 }) },
      ),
    "invalid_contract",
  );
});

scenario("review event validates exact transition", () => {
  assert.doesNotThrow(() =>
    assertTaskPackRevisionReviewEvent({
      id: "event_review_1",
      taskPackId: 17,
      revisionId: 101,
      eventType: "changes_requested",
      fromState: "in_review",
      toState: "changes_requested",
      source: "user",
      actorId: null,
      createdAt: "2026-09-18T11:00:00.000Z",
      metadata: null,
    }),
  );
});

scenario("review event rejects review re-entry on terminal revision", () => {
  expectDomainError(
    () =>
      assertTaskPackRevisionReviewEvent({
        id: "event_review_2",
        taskPackId: 17,
        revisionId: 101,
        eventType: "review_started",
        fromState: "changes_requested",
        toState: "in_review",
        source: "user",
        actorId: null,
        createdAt: "2026-09-18T11:00:00.000Z",
        metadata: null,
      }),
    "invalid_transition",
  );
});

scenario("review event rejects a revision from another aggregate", () => {
  expectDomainError(
    () =>
      assertTaskPackRevisionReviewEvent(
        {
          id: "event_review_3",
          taskPackId: 17,
          revisionId: 101,
          eventType: "accepted",
          fromState: "unreviewed",
          toState: "accepted",
          source: "user",
          actorId: null,
          createdAt: "2026-09-18T11:00:00.000Z",
          metadata: null,
        },
        { revision: revision({ taskPackId: 18 }) },
      ),
    "invalid_contract",
  );
});

scenario("active persisted draft validates", () => {
  assert.doesNotThrow(() => assertPersistedTaskPackDraft(draft()));
});

scenario("materialized draft requires resulting revision", () => {
  expectDomainError(
    () =>
      assertPersistedTaskPackDraft(
        draft({ lifecycle: { state: "materialized", materializedRevisionId: null } } as never),
      ),
    "invalid_identity",
  );
});

scenario("draft base revision requires aggregate identity", () => {
  expectDomainError(
    () => assertPersistedTaskPackDraft(draft({ baseRevisionId: 101 })),
    "invalid_contract",
  );
});

scenario("revision 1 validates with matching canonical hash", () => {
  assert.doesNotThrow(() => assertTaskPackRevision(revision()));
});

scenario("revision number is at least one", () => {
  expectDomainError(() => assertTaskPackRevision(revision({ revisionNumber: 0 })), "invalid_identity");
});

scenario("revision 1 cannot name a base revision", () => {
  expectDomainError(
    () => assertTaskPackRevision(revision({ baseRevisionId: 99 })),
    "invalid_revision",
  );
});

scenario("later revision requires a base revision", () => {
  expectDomainError(
    () => assertTaskPackRevision(revision({ id: 102, revisionNumber: 2 })),
    "invalid_revision",
  );
});

scenario("revision cannot reference itself as base", () => {
  expectDomainError(
    () => assertTaskPackRevision(revision({ id: 102, revisionNumber: 2, baseRevisionId: 102 })),
    "invalid_revision",
  );
});

scenario("later revision validates against an earlier immutable base", () => {
  const base = revision();
  const next = revision(
    { id: 102, revisionNumber: 2, baseRevisionId: 101, generatedAt: null },
    { sourceKind: "manual_edit", rawTask: "Improve settings copy" },
  );
  assert.doesNotThrow(() => assertTaskPackRevision(next, { baseRevision: base }));
});

scenario("base revision must precede its derived revision", () => {
  const laterBase = revision({ id: 103, revisionNumber: 3, baseRevisionId: 101 });
  const value = revision({ id: 102, revisionNumber: 2, baseRevisionId: 103 });
  expectDomainError(
    () => assertTaskPackRevision(value, { baseRevision: laterBase }),
    "invalid_revision",
  );
});

scenario("revision ownership is exclusively the aggregate identity", () => {
  expectDomainError(
    () => assertTaskPackRevision(revision({ taskPackId: 18 }), { aggregate: aggregate() }),
    "invalid_revision",
  );
});

scenario("base revision must belong to the same aggregate", () => {
  const base = revision({ taskPackId: 18 });
  const next = revision({ id: 102, revisionNumber: 2, baseRevisionId: 101 });
  expectDomainError(
    () => assertTaskPackRevision(next, { baseRevision: base }),
    "invalid_revision",
  );
});

scenario("revision content type has no aggregate-owned title", () => {
  assert.equal(revisionContentHasTitle, false);
});

scenario("revision type has no aggregate-owned project identity", () => {
  assert.equal(revisionHasProjectId, false);
});

scenario("generated revision requires generatedAt", () => {
  expectDomainError(
    () => assertTaskPackRevision(revision({ generatedAt: null })),
    "invalid_revision",
  );
});

scenario("manual revision cannot claim a generation timestamp", () => {
  const value = revision({}, { sourceKind: "manual_edit" });
  expectDomainError(() => assertTaskPackRevision(value), "invalid_revision");
});

scenario("revision rejects mismatched content hash", () => {
  expectDomainError(
    () => assertTaskPackRevision(revision({ contentHash: fingerprintA }, { rawTask: "changed" })),
    "invalid_content_hash",
  );
});

scenario("revision rejects unsafe absolute context path", () => {
  const content = baseRevisionContent();
  const unsafe: TaskPackRevisionContent = {
    ...content,
    groundedContextSnapshot: {
      ...content.groundedContextSnapshot!,
      selectedFiles: [
        {
          ...content.groundedContextSnapshot!.selectedFiles[0],
          path: "C:/Users/example/source.ts",
        },
      ],
    },
  };
  expectDomainError(() => computeTaskPackRevisionContentHash(unsafe), "unsafe_context_path");
});

scenario("canonical content hash is lowercase SHA-256", () => {
  const hash = computeTaskPackRevisionContentHash(baseRevisionContent());
  assert.equal(isTaskPackRevisionContentHash(hash), true);
  assert.match(hash, /^sha256:[a-f0-9]{64}$/u);
});

scenario("hash is stable across object key insertion order", () => {
  const first = baseRevisionContent();
  const second: TaskPackRevisionContent = {
    ...first,
    generationRecipe: {
      attempts: [{ outcome: "success", durationMs: 17.2 }],
      policy: { requiredLayers: ["ui", "tests"], mode: "guarded" },
      schemaVersion: 2,
    },
  };
  assert.equal(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(second),
  );
});

scenario("ordinary generation recipe millisecond configuration changes hash", () => {
  const first = baseRevisionContent();
  const second: TaskPackRevisionContent = {
    ...first,
    generationRecipe: { debounceMs: 250 },
  };
  const third: TaskPackRevisionContent = {
    ...first,
    generationRecipe: { debounceMs: 500 },
  };
  assert.notEqual(
    computeTaskPackRevisionContentHash(second),
    computeTaskPackRevisionContentHash(third),
  );
});

scenario("generation recipe filters only explicit diagnostic telemetry", () => {
  const first: TaskPackRevisionContent = {
    ...baseRevisionContent(),
    generationRecipe: {
      policy: { debounceMs: 250 },
      performanceDiagnostics: { totalMs: 18, parses: 2 },
    },
  };
  const timingOnlyChange: TaskPackRevisionContent = {
    ...first,
    generationRecipe: {
      policy: { debounceMs: 250 },
      performanceDiagnostics: { totalMs: 99, parses: 2 },
    },
  };
  const evidenceChange: TaskPackRevisionContent = {
    ...first,
    generationRecipe: {
      policy: { debounceMs: 250 },
      performanceDiagnostics: { totalMs: 18, parses: 3 },
    },
  };
  assert.equal(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(timingOnlyChange),
  );
  assert.notEqual(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(evidenceChange),
  );
});

scenario("hash is stable across Windows and Unix line endings", () => {
  const first = baseRevisionContent();
  const second = {
    ...first,
    rawTask: first.rawTask.replace(/\r\n/gu, "\n"),
    generatedPrompt: first.generatedPrompt.replace(/\r\n/gu, "\n"),
  };
  assert.equal(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(second),
  );
});

scenario("hash excludes volatile performance timing", () => {
  const first = baseRevisionContent();
  const second: TaskPackRevisionContent = {
    ...first,
    generationDurationMs: 9_999,
    diagnostics: {
      ...first.diagnostics!,
      performance: { totalMs: 9_999, parses: 2 },
    },
  };
  assert.equal(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(second),
  );
});

scenario("hash retains non-timing diagnostic evidence", () => {
  const first = baseRevisionContent();
  const second: TaskPackRevisionContent = {
    ...first,
    diagnostics: {
      ...first.diagnostics!,
      performance: { totalMs: 18.4, parses: 3 },
    },
  };
  assert.notEqual(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(second),
  );
});

scenario("hash excludes observation timestamps while retaining freshness evidence", () => {
  const first = baseRevisionContent();
  const second: TaskPackRevisionContent = {
    ...first,
    freshnessBasis: {
      ...first.freshnessBasis!,
      observedAt: "2026-09-18T12:00:00.000Z",
      previousObservedAt: "2026-09-17T12:00:00.000Z",
    },
  };
  assert.equal(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(second),
  );
});

scenario("hash excludes volatile diagnostic timestamps", () => {
  const first = baseRevisionContent();
  const second: TaskPackRevisionContent = {
    ...first,
    diagnostics: {
      ...first.diagnostics!,
      selector: {
        ...first.diagnostics!.selector!,
        timestamp: "2026-09-18T12:00:00.000Z",
      },
    },
  };
  const third: TaskPackRevisionContent = {
    ...second,
    diagnostics: {
      ...second.diagnostics!,
      selector: {
        ...second.diagnostics!.selector!,
        timestamp: "2026-09-18T13:00:00.000Z",
      },
    },
  };
  assert.equal(
    computeTaskPackRevisionContentHash(second),
    computeTaskPackRevisionContentHash(third),
  );
});

scenario("hash normalizes repository-relative path separators", () => {
  const first = baseRevisionContent();
  const selectedFiles = first.groundedContextSnapshot!.selectedFiles;
  const second: TaskPackRevisionContent = {
    ...first,
    groundedContextSnapshot: {
      ...first.groundedContextSnapshot!,
      selectedFiles: [
        { ...selectedFiles[0], path: selectedFiles[0].path.replaceAll("/", "\\") },
        selectedFiles[1],
      ],
    },
  };
  assert.equal(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(second),
  );
});

scenario("hash canonicalizes proof classes as an unordered set", () => {
  const first = baseRevisionContent();
  const [editable, reference] = first.groundedContextSnapshot!.selectedFiles;
  const second: TaskPackRevisionContent = {
    ...first,
    groundedContextSnapshot: {
      ...first.groundedContextSnapshot!,
      selectedFiles: [
        { ...editable, proofClasses: [...editable.proofClasses].reverse() },
        reference,
      ],
    },
  };
  assert.equal(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(second),
  );
});

scenario("hash preserves semantically meaningful selected-file ordering", () => {
  const first = baseRevisionContent();
  const second: TaskPackRevisionContent = {
    ...first,
    groundedContextSnapshot: {
      ...first.groundedContextSnapshot!,
      selectedFiles: [...first.groundedContextSnapshot!.selectedFiles].reverse(),
    },
  };
  assert.notEqual(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash(second),
  );
});

scenario("hash changes when meaningful revision content changes", () => {
  const first = baseRevisionContent();
  assert.notEqual(
    computeTaskPackRevisionContentHash(first),
    computeTaskPackRevisionContentHash({ ...first, generatedPrompt: "A different prompt" }),
  );
});

scenario("hash and validation do not mutate supplied values", () => {
  const content = baseRevisionContent();
  const contentBefore = structuredClone(content);
  computeTaskPackRevisionContentHash(content);
  assert.deepEqual(content, contentBefore);

  const value = revision();
  const revisionBefore = structuredClone(value);
  assertTaskPackRevision(value);
  assert.deepEqual(value, revisionBefore);
});

scenario("malformed contract with unknown fields is rejected", () => {
  expectDomainError(
    () => assertTaskPackAggregate({ ...aggregate(), internalStatus: "ready" }),
    "invalid_contract",
  );
});

scenario("revision content hash rejects an unknown top-level field", () => {
  const malformed = {
    ...baseRevisionContent(),
    unexpectedField: "x",
  } as unknown as TaskPackRevisionContent;
  expectDomainError(
    () => computeTaskPackRevisionContentHash(malformed),
    "invalid_contract",
  );
});

scenario("full revision contract rejects aggregate-owned project identity", () => {
  const malformed = { ...revision(), projectId: 3 } as unknown as TaskPackRevision;
  expectDomainError(() => assertTaskPackRevision(malformed), "invalid_contract");
});

scenario("malformed JSON diagnostics are rejected", () => {
  const content = baseRevisionContent();
  expectDomainError(
    () =>
      computeTaskPackRevisionContentHash({
        ...content,
        generationRecipe: { invalidNumber: Number.POSITIVE_INFINITY },
      }),
    "invalid_contract",
  );
});

for (const item of scenarios) {
  try {
    await item.run();
  } catch (error) {
    console.error(`Task Pack lifecycle smoke failed: ${item.name}`);
    throw error;
  }
}

console.log(`Task Pack lifecycle smoke passed: ${scenarios.length} scenarios`);
