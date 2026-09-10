import assert from "node:assert/strict";

import type {
  Project,
  ProjectAwareness,
  TaskPack,
} from "../apps/desktop/renderer/src/types/index.ts";
import {
  buildTaskPackFreshnessIndex,
  deriveTaskPackFreshness,
  getTaskPackSelectedPaths,
} from "../apps/desktop/renderer/src/utils/taskPackFreshness.ts";

let scenarios = 0;

function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function awareness(
  status: ProjectAwareness["status"],
  overrides: Partial<ProjectAwareness> = {},
): ProjectAwareness {
  return {
    status,
    lastObservedAt: "2026-09-09T12:00:00.000Z",
    previousObservedAt:
      status === "first_observation" ? null : "2026-09-08T12:00:00.000Z",
    knownFileCount: 20,
    inventoryTruncated: status === "comparison_limited",
    fileComparison: status === "comparison_limited" ? "limited" : "available",
    fileChanges:
      status === "changed"
        ? { added: ["src/new.ts"], removed: [] }
        : status === "unchanged"
          ? { added: [], removed: [] }
          : null,
    readinessChange:
      status === "first_observation"
        ? null
        : { previous: 80, current: 80, direction: "unchanged" },
    readinessCheckChanges: [],
    ...overrides,
  };
}

function project(
  id: number,
  projectAwareness: ProjectAwareness | null,
): Project {
  return {
    id,
    name: `Project ${id}`,
    localPath: `C:/repo-${id}`,
    packageManager: "npm",
    detectedStack: ["TypeScript"],
    scripts: {},
    readinessScore: 80,
    readinessReport: { score: 80, checks: [], issues: [] },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-09T12:00:00.000Z",
    lastScanAt: "2026-09-09T12:00:00.000Z",
    awareness: projectAwareness,
  };
}

function taskPack(
  id: number,
  projectId: number,
  createdAt: string,
  selectedPaths: string[] = [],
): TaskPack {
  return {
    id,
    projectId,
    title: `Task Pack ${id}`,
    rawTask: "Test task",
    taskType: "general",
    targetTool: "codex",
    generatedPrompt: "Prompt",
    createdAt,
    updatedAt: createdAt,
    generationRecipe:
      selectedPaths.length > 0
        ? ({
            selectorDiagnostics: {
              actual: {
                selectedFiles: selectedPaths.map((path) => ({
                  path,
                  usage: "inspect-and-edit",
                  reason: "selected",
                  evidenceStrength: "strong",
                })),
              },
            },
          } as TaskPack["generationRecipe"])
        : null,
  };
}

scenario("no awareness baseline is unknown, never stale", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(1, 1, "2026-09-07T00:00:00.000Z"),
    project(1, null),
  );
  assert.equal(freshness.status, "unknown");
  assert.equal(freshness.reason, "no_awareness");
});

scenario("first observation is unknown rather than no-change", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(2, 1, "2026-09-07T00:00:00.000Z"),
    project(1, awareness("first_observation")),
  );
  assert.equal(freshness.status, "unknown");
  assert.equal(freshness.reason, "no_comparison_baseline");
});

scenario("unchanged observed state has no stale claim", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(3, 1, "2026-09-07T00:00:00.000Z"),
    project(1, awareness("unchanged")),
  );
  assert.equal(freshness.status, "current");
  assert.equal(freshness.reason, "known_state_unchanged");
});

scenario("pack before previous observation is reviewed after a later change", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(4, 1, "2026-09-07T00:00:00.000Z"),
    project(1, awareness("changed")),
  );
  assert.equal(freshness.status, "review_recommended");
  assert.equal(freshness.reason, "project_changed_after_task_pack");
});

scenario("pack after latest observation is current relative to known state", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(5, 1, "2026-09-10T00:00:00.000Z"),
    project(1, awareness("changed")),
  );
  assert.equal(freshness.status, "current");
  assert.equal(freshness.reason, "created_after_latest_observation");
});

scenario("pack inside a changed observation interval stays unknown", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(6, 1, "2026-09-09T00:00:00.000Z"),
    project(1, awareness("changed")),
  );
  assert.equal(freshness.status, "unknown");
  assert.equal(freshness.reason, "analysis_inside_observation_interval");
});

scenario("exact removed context path is strong affected evidence", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(7, 1, "2026-09-09T00:00:00.000Z", ["src/removed.ts"]),
    project(
      1,
      awareness("changed", {
        fileChanges: { added: [], removed: ["src/removed.ts"] },
      }),
    ),
  );
  assert.equal(freshness.status, "affected");
  assert.deepEqual(freshness.affectedPaths, ["src/removed.ts"]);
});

scenario("added unrelated path is not labeled affected", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(8, 1, "2026-09-07T00:00:00.000Z", ["src/existing.ts"]),
    project(
      1,
      awareness("changed", {
        fileChanges: { added: ["src/new.ts"], removed: [] },
      }),
    ),
  );
  assert.equal(freshness.status, "review_recommended");
  assert.deepEqual(freshness.affectedPaths, []);
});

scenario("another project's changes never affect a Task Pack", () => {
  const pack = taskPack(9, 2, "2026-09-07T00:00:00.000Z", ["src/removed.ts"]);
  const index = buildTaskPackFreshnessIndex(
    [pack],
    [
      project(
        1,
        awareness("changed", {
          fileChanges: { added: [], removed: ["src/removed.ts"] },
        }),
      ),
      project(2, awareness("unchanged")),
    ],
  );
  assert.equal(index.get(pack.id)?.status, "current");
});

scenario("limited comparison recommends review without affected paths", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(10, 1, "2026-09-07T00:00:00.000Z", ["src/a.ts"]),
    project(
      1,
      awareness("comparison_limited", {
        fileChanges: { added: [], removed: ["src/a.ts"] },
      }),
    ),
  );
  assert.equal(freshness.status, "review_recommended");
  assert.equal(freshness.reason, "comparison_limited");
  assert.deepEqual(freshness.affectedPaths, []);
});

scenario("legacy Task Pack without selector diagnostics remains valid", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(11, 1, "2026-09-07T00:00:00.000Z"),
    project(1, awareness("changed")),
  );
  assert.equal(freshness.status, "review_recommended");
  assert.deepEqual(freshness.selectedPaths, []);
});

scenario("malformed timestamps fall back safely", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(12, 1, "not-a-date", ["src/a.ts"]),
    project(1, awareness("changed")),
  );
  assert.equal(freshness.status, "unknown");
  assert.equal(freshness.reason, "invalid_timestamp");
});

scenario("malformed historical comparison falls back safely", () => {
  const malformed = {
    ...awareness("changed"),
    fileComparison: "partial",
  } as unknown as ProjectAwareness;
  const freshness = deriveTaskPackFreshness(
    taskPack(14, 1, "2026-09-07T00:00:00.000Z", ["src/a.ts"]),
    project(1, malformed),
  );
  assert.equal(freshness.status, "unknown");
  assert.equal(freshness.reason, "invalid_awareness");
});

scenario("pack at latest observation does not inherit an earlier removal", () => {
  const freshness = deriveTaskPackFreshness(
    taskPack(15, 1, "2026-09-09T12:00:00.000Z", ["src/removed.ts"]),
    project(
      1,
      awareness("changed", {
        fileChanges: { added: [], removed: ["src/removed.ts"] },
      }),
    ),
  );
  assert.equal(freshness.status, "current");
  assert.equal(freshness.reason, "created_after_latest_observation");
});

scenario("path identity is structural, case-sensitive, and deterministic", () => {
  const pack = taskPack(13, 1, "2026-09-07T00:00:00.000Z", [
    "src\\z.ts",
    "./src/Foo.ts",
    "src/foo.ts",
    "src//z.ts",
  ]);
  assert.deepEqual(getTaskPackSelectedPaths(pack), [
    "src/Foo.ts",
    "src/foo.ts",
    "src/z.ts",
  ]);

  const freshness = deriveTaskPackFreshness(
    pack,
    project(
      1,
      awareness("changed", {
        fileChanges: { added: [], removed: ["src/foo.ts", "src/z.ts"] },
      }),
    ),
  );
  assert.deepEqual(freshness.affectedPaths, ["src/foo.ts", "src/z.ts"]);
});

process.stdout.write(`Task Pack freshness smoke passed: ${scenarios} scenarios.\n`);
