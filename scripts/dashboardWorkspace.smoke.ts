import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type {
  Project,
  ProjectAwareness,
  TaskPack,
} from "../apps/desktop/renderer/src/types/index.ts";
import {
  getDashboardAttentionProjects,
  getDashboardAwarenessCounts,
  getDashboardAwarenessProjects,
  getDashboardPrimaryProject,
  getDashboardProjectAction,
} from "../apps/desktop/renderer/src/utils/dashboardWorkspace.ts";

const repositoryRoot = process.cwd();
const now = new Date("2026-09-09T12:00:00.000Z").getTime();
let scenarios = 0;

function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function awareness(
  status: ProjectAwareness["status"],
): ProjectAwareness {
  const hasBaseline = status !== "first_observation";
  return {
    status,
    lastObservedAt: "2026-09-09T10:00:00.000Z",
    previousObservedAt: hasBaseline ? "2026-09-08T10:00:00.000Z" : null,
    knownFileCount: 10,
    inventoryTruncated: status === "comparison_limited",
    fileComparison: status === "comparison_limited" ? "limited" : "available",
    fileChanges:
      status === "changed" ? { added: ["src/new.ts"], removed: [] } : null,
    readinessChange: hasBaseline
      ? { previous: 70, current: 70, direction: "unchanged" }
      : null,
    readinessCheckChanges: [],
  };
}

function project(
  id: number,
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    name: `Project ${id}`,
    localPath: `C:/repo-${id}`,
    packageManager: "npm",
    detectedStack: ["TypeScript"],
    scripts: { build: "vite build", test: "vitest" },
    readinessScore: 85,
    readinessReport: { score: 85, checks: [], issues: [] },
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-09T10:00:00.000Z",
    lastScanAt: "2026-09-09T10:00:00.000Z",
    awareness: awareness("unchanged"),
    ...overrides,
  };
}

function taskPack(projectId: number, createdAt: string): TaskPack {
  return { projectId, createdAt } as TaskPack;
}

scenario("no-project workspace has no fabricated Dashboard state", () => {
  assert.deepEqual(getDashboardAttentionProjects([], now), []);
  assert.deepEqual(getDashboardAwarenessCounts([]), {
    changed: 0,
    limited: 0,
    firstObservation: 0,
    unavailable: 0,
  });
  assert.equal(getDashboardPrimaryProject([], [], []), null);
});

scenario("attention uses existing readiness and scan facts", () => {
  const healthy = project(1);
  const lowReadiness = project(2, { readinessScore: 45 });
  const stale = project(3, { lastScanAt: "2026-08-01T10:00:00.000Z" });
  const ids = getDashboardAttentionProjects(
    [healthy, stale, lowReadiness],
    now,
  ).map((item) => item.id);

  assert.deepEqual(ids, [2, 3]);
});

scenario("next actions preserve deterministic existing rules", () => {
  const missingAgents = project(1, {
    readinessReport: {
      score: 70,
      checks: [],
      issues: ["No AGENTS.md instructions found"],
    },
  });
  const stale = project(2, { lastScanAt: "2026-08-01T10:00:00.000Z" });
  const healthy = project(3);

  assert.equal(getDashboardProjectAction(missingAgents, now), "buildContext");
  assert.equal(getDashboardProjectAction(stale, now), "scan");
  assert.equal(getDashboardProjectAction(healthy, now), "createPack");
});

scenario("changed awareness is counted without recomputing scanner history", () => {
  const counts = getDashboardAwarenessCounts([
    project(1, { awareness: awareness("changed") }),
    project(2, { awareness: awareness("unchanged") }),
  ]);
  assert.equal(counts.changed, 1);
  assert.equal(counts.limited, 0);
});

scenario("missing and first observations are not reported as changes", () => {
  const counts = getDashboardAwarenessCounts([
    project(1, { awareness: undefined }),
    project(2, { awareness: awareness("first_observation") }),
  ]);
  assert.deepEqual(counts, {
    changed: 0,
    limited: 0,
    firstObservation: 1,
    unavailable: 1,
  });
});

scenario("limited awareness remains distinct from a complete change claim", () => {
  const limited = project(1, { awareness: awareness("comparison_limited") });
  const unchanged = project(2);
  const counts = getDashboardAwarenessCounts([unchanged, limited]);
  const ordered = getDashboardAwarenessProjects([unchanged, limited]);

  assert.equal(counts.limited, 1);
  assert.equal(counts.changed, 0);
  assert.equal(ordered[0]?.id, limited.id);
});

scenario("attention outranks recent work for the primary project", () => {
  const healthy = project(1);
  const attention = project(2, { readinessScore: 40 });
  const attentionProjects = getDashboardAttentionProjects(
    [healthy, attention],
    now,
  );

  assert.equal(
    getDashboardPrimaryProject(
      [healthy, attention],
      [taskPack(healthy.id, "2026-09-09T11:00:00.000Z")],
      attentionProjects,
    )?.id,
    attention.id,
  );
});

scenario("recent Task Pack chooses the primary project when attention is clear", () => {
  const older = project(1, { updatedAt: "2026-09-09T11:00:00.000Z" });
  const recentWork = project(2, { updatedAt: "2026-09-08T11:00:00.000Z" });

  assert.equal(
    getDashboardPrimaryProject(
      [older, recentWork],
      [taskPack(recentWork.id, "2026-09-09T11:30:00.000Z")],
      [],
    )?.id,
    recentWork.id,
  );
});

scenario("Dashboard 2.0 UI uses grounded awareness and synchronized copy", () => {
  const pageSource = fs.readFileSync(
    path.join(
      repositoryRoot,
      "apps/desktop/renderer/src/pages/DashboardHomePage.tsx",
    ),
    "utf8",
  );
  const translationsSource = fs.readFileSync(
    path.join(
      repositoryRoot,
      "apps/desktop/renderer/src/i18n/index.ts",
    ),
    "utf8",
  );

  assert.match(pageSource, /getDashboardAwarenessCounts\(projects\)/);
  assert.match(pageSource, /<ProjectAwarenessSummary/);
  assert.match(pageSource, /<WorkspaceDisclosure/);
  assert.match(pageSource, /if \(projects\.length === 0\)/);
  assert.match(pageSource, /<EmptyDashboard/);
  assert.match(pageSource, /project\.awareness\?\.status !== "unchanged"/);
  assert.doesNotMatch(pageSource, /modifiedFiles|healthScore|urgencyScore/i);

  for (const key of [
    "intelligenceWorkspaceDescription",
    "changedProjects",
    "projectReadiness",
    "attentionQueue",
    "whatChanged",
    "limitedAwarenessCount",
    "recentWork",
    "readinessBreakdownSummary",
  ]) {
    assert.equal(
      translationsSource.match(new RegExp(`\\b${key}:`, "g"))?.length,
      2,
      key,
    );
  }
});

process.stdout.write(`Dashboard 2.0 smoke passed: ${scenarios} scenarios.\n`);
