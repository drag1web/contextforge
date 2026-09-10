import assert from "node:assert/strict";

import type { ProjectRecord } from "../storage/types.js";
import {
  advanceProjectAwarenessState,
  buildProjectAwarenessView,
  createProjectAwarenessSnapshot,
  parseProjectAwarenessState,
} from "./projectAwareness.js";

let scenarios = 0;

function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function project(
  observedAt: string,
  readinessScore: number,
  checks: Array<{ key: string; passed: boolean; points: number }> = [],
): ProjectRecord {
  return {
    id: 1,
    name: "fixture",
    localPath: "/fixture",
    packageManager: "npm",
    detectedStack: ["TypeScript"],
    scripts: {},
    readinessScore,
    readinessReport: {
      score: readinessScore,
      issues: [],
      checks: checks.map((check) => ({
        ...check,
        label: check.key,
        message: check.key,
      })),
    },
    createdAt: observedAt,
    updatedAt: observedAt,
    lastScanAt: observedAt,
  };
}

function snapshot(
  observedAt: string,
  filePaths: string[],
  readinessScore = 60,
  inventoryTruncated = false,
  checks: Array<{ key: string; passed: boolean; points: number }> = [],
) {
  return createProjectAwarenessSnapshot(
    project(observedAt, readinessScore, checks),
    { filePaths, inventoryTruncated },
  );
}

function comparison(
  previousPaths: string[],
  currentPaths: string[],
  options: {
    previousScore?: number;
    currentScore?: number;
    previousTruncated?: boolean;
    currentTruncated?: boolean;
  } = {},
) {
  const first = advanceProjectAwarenessState(
    null,
    snapshot(
      "2026-09-08T08:00:00.000Z",
      previousPaths,
      options.previousScore,
      options.previousTruncated,
    ),
  );
  const second = advanceProjectAwarenessState(
    first,
    snapshot(
      "2026-09-08T09:00:00.000Z",
      currentPaths,
      options.currentScore,
      options.currentTruncated,
    ),
  );
  return buildProjectAwarenessView(second);
}

scenario("first observation has no comparison baseline", () => {
  const state = advanceProjectAwarenessState(
    null,
    snapshot("2026-09-08T08:00:00.000Z", ["src/index.ts"]),
  );
  const view = buildProjectAwarenessView(state);

  assert.equal(view.status, "first_observation");
  assert.equal(view.previousObservedAt, null);
  assert.equal(view.fileChanges, null);
});

scenario("unchanged exact inventory remains unchanged", () => {
  const view = comparison(["README.md", "src/index.ts"], ["src/index.ts", "README.md"]);
  assert.equal(view.status, "unchanged");
  assert.deepEqual(view.fileChanges, { added: [], removed: [] });
});

scenario("added file is reported from an exact observed path", () => {
  const view = comparison(["README.md"], ["README.md", "src/new.ts"]);
  assert.deepEqual(view.fileChanges?.added, ["src/new.ts"]);
  assert.deepEqual(view.fileChanges?.removed, []);
});

scenario("removed file is reported from an exact observed path", () => {
  const view = comparison(["README.md", "src/old.ts"], ["README.md"]);
  assert.deepEqual(view.fileChanges?.added, []);
  assert.deepEqual(view.fileChanges?.removed, ["src/old.ts"]);
});

scenario("comparison ordering is deterministic", () => {
  const view = comparison(
    ["z.ts", "README.md", "src/b.ts"],
    ["README.md", "src/c.ts", "src/a.ts"],
  );
  assert.deepEqual(view.fileChanges?.added, ["src/a.ts", "src/c.ts"]);
  assert.deepEqual(view.fileChanges?.removed, ["src/b.ts", "z.ts"]);
});

scenario("case-distinct repository paths remain distinct", () => {
  const view = comparison(["src/Foo.ts"], ["src/foo.ts"]);
  assert.deepEqual(view.fileChanges?.added, ["src/foo.ts"]);
  assert.deepEqual(view.fileChanges?.removed, ["src/Foo.ts"]);
});

scenario("truncated inventory never claims a complete file comparison", () => {
  const view = comparison(["README.md"], ["README.md"], {
    currentTruncated: true,
  });
  assert.equal(view.status, "comparison_limited");
  assert.equal(view.fileComparison, "limited");
  assert.equal(view.fileChanges, null);
});

scenario("malformed historical state is rejected", () => {
  assert.equal(
    parseProjectAwarenessState({
      version: 1,
      previous: null,
      current: {
        version: 1,
        observedAt: "2026-09-08T08:00:00.000Z",
        readinessScore: 60,
        readinessChecks: [],
        filePaths: ["../private.ts"],
        inventoryTruncated: false,
      },
    }),
    null,
  );
});

scenario("readiness check changes preserve their stable check key", () => {
  const first = advanceProjectAwarenessState(
    null,
    snapshot(
      "2026-09-08T08:00:00.000Z",
      ["README.md"],
      60,
      false,
      [{ key: "tests", passed: false, points: 0 }],
    ),
  );
  const view = buildProjectAwarenessView(
    advanceProjectAwarenessState(
      first,
      snapshot(
        "2026-09-08T09:00:00.000Z",
        ["README.md"],
        60,
        false,
        [{ key: "tests", passed: true, points: 10 }],
      ),
    ),
  );

  assert.equal(view.status, "changed");
  assert.deepEqual(view.readinessCheckChanges, [
    {
      key: "tests",
      previousPassed: false,
      currentPassed: true,
      previousPoints: 0,
      currentPoints: 10,
    },
  ]);
});

for (const [name, previousScore, currentScore, direction] of [
  ["improved", 50, 70, "improved"],
  ["unchanged", 70, 70, "unchanged"],
  ["decreased", 70, 50, "decreased"],
] as const) {
  scenario(`readiness ${name} preserves the existing score direction`, () => {
    const view = comparison(["README.md"], ["README.md"], {
      previousScore,
      currentScore,
    });
    assert.deepEqual(view.readinessChange, {
      previous: previousScore,
      current: currentScore,
      direction,
    });
  });
}

process.stdout.write(`Project Awareness smoke passed: ${scenarios} scenarios.\n`);
