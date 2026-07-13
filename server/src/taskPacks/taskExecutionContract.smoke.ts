import assert from "node:assert/strict";

import type { TaskUnderstanding } from "../ollama/taskUnderstanding.js";
import {
  applySelectionEvidenceGate,
  buildTaskExecutionContract,
} from "./taskExecutionContract.js";

const projectTree = [
  "apps/desktop/renderer/src/components/layout/Sidebar.tsx",
  "apps/desktop/renderer/src/components/performance/PerformanceDiagnosticsModal.tsx",
  "apps/desktop/renderer/src/api/client.ts",
  "apps/desktop/renderer/src/types/index.ts",
  "server/src/routes/taskPacks.ts",
  "server/src/performance/performanceTrace.ts",
  "server/src/taskPacks/taskUnderstandingSnapshot.ts",
  "server/src/performance/performanceTrace.smoke.ts",
];

function understanding(
  overrides: Partial<TaskUnderstanding> = {},
): TaskUnderstanding {
  return {
    schemaVersion: 1,
    goal: "Update the requested behavior.",
    action: "update",
    targetHints: [],
    requestedChanges: ["Update the requested behavior."],
    constraints: [],
    ambiguities: [],
    interpretationRisk: "objective",
    changeDefinition: "bounded",
    explicitValues: [],
    missingInformation: [],
    readiness: "ready",
    canProceed: true,
    clarificationQuestion: null,
    confidence: 0.85,
    source: "merged",
    reasons: [],
    ...overrides,
  };
}

function run() {
  let scenarios = 0;

  {
    const contract = buildTaskExecutionContract({
      rawTask: "Update Sidebar.",
      projectTree,
      taskArea: "ui",
      understanding: understanding({
        targetHints: [
          "apps/desktop/renderer/src/components/layout/Sidebar.tsx",
        ],
      }),
      structuredIntent: {
        primaryTargets: [
          {
            kind: "component",
            value: "Sidebar",
            path: "apps/desktop/renderer/src/components/layout/Sidebar.tsx",
            confidence: 0.98,
            evidence: "Exact component match",
          },
        ],
        positiveActions: [],
        protectedScopes: [],
        allowedEditScope: "explicit_targets_only",
        needsStyles: false,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
        schemaVersion: 1,
      },
      fileRoleHints: ["component"],
    });

    assert.equal(contract.mode, "implementation");
    assert.deepEqual(contract.requiredLayers, ["ui"]);
    assert.deepEqual(contract.confirmedTargets, [
      "apps/desktop/renderer/src/components/layout/Sidebar.tsx",
    ]);
    assert.equal(contract.allowImplementationGuidance, true);
    scenarios += 1;
  }

  {
    const contract = buildTaskExecutionContract({
      rawTask: "Expose performance timing in backend and UI.",
      projectTree,
      taskArea: "fullstack",
      understanding: understanding(),
      structuredIntent: null,
      fileRoleHints: ["api", "route"],
    });

    assert.equal(contract.mode, "implementation");
    assert.ok(contract.requiredLayers.includes("backend"));
    assert.ok(contract.requiredLayers.includes("client-api"));
    assert.ok(contract.requiredLayers.includes("ui"));
    assert.equal(contract.requiresLayerCoverage, true);
    scenarios += 1;
  }

  {
    const contract = buildTaskExecutionContract({
      rawTask: "Fix stale cache status after repeated generation.",
      projectTree,
      taskArea: "bugfix",
      understanding: understanding({ action: "fix" }),
      structuredIntent: null,
      fileRoleHints: ["state", "api"],
    });

    assert.equal(contract.mode, "investigation");
    assert.equal(contract.allowImplementationGuidance, false);
    assert.ok(contract.requiredLayers.includes("state"));
    assert.equal(contract.requiredLayers.includes("client-api"), false);
    assert.equal(contract.confirmedTargets.length, 0);
    scenarios += 1;
  }

  {
    const contract = buildTaskExecutionContract({
      rawTask: "Add a new connection method.",
      projectTree,
      taskArea: "backend",
      understanding: understanding({
        action: "create",
        interpretationRisk: "uncertain",
        changeDefinition: "open_ended",
        ambiguities: ["Which provider and user flow should be supported?"],
        missingInformation: [
          {
            code: "architecture_decision",
            description: "Which provider and user flow should be supported?",
            required: true,
          },
        ],
        readiness: "needs_clarification",
        canProceed: false,
        clarificationQuestion:
          "Which provider and user flow should be supported?",
      }),
      structuredIntent: null,
      fileRoleHints: ["route", "service"],
    });

    assert.equal(contract.mode, "clarification_required");
    assert.equal(contract.allowImplementationGuidance, false);
    assert.equal(contract.unresolvedDecisions.length, 1);
    scenarios += 1;
  }


  {
    const contract = buildTaskExecutionContract({
      rawTask: "Add GitHub OAuth login to the application.",
      projectTree,
      taskArea: "fullstack",
      understanding: understanding({
        readiness: "review",
        changeDefinition: "bounded",
        targetHints: ["/auth/github", "/api/auth/callback/github"],
      }),
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [
          {
            kind: "route",
            value: "/auth/github",
            routePath: "/auth/github",
            confidence: 0.95,
            evidence: "Model-proposed route.",
            provenance: "model_proposed",
          },
        ],
        positiveActions: [],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: true,
        ambiguities: [],
        modelNotes: [],
      },
      fileRoleHints: ["page", "route", "service"],
    });

    assert.equal(contract.mode, "investigation");
    assert.equal(contract.confirmedTargets.length, 0);
    assert.ok(contract.proposedTargets.includes("/auth/github"));
    assert.equal(contract.targetEvidence[0]?.evidenceLevel, "model_proposed");
    assert.equal(contract.allowImplementationGuidance, false);
    scenarios += 1;
  }

  {
    const base = buildTaskExecutionContract({
      rawTask: "Expose performance timing in backend and UI.",
      projectTree,
      taskArea: "fullstack",
      understanding: understanding(),
      structuredIntent: null,
      fileRoleHints: ["api", "route"],
    });
    const gated = applySelectionEvidenceGate({
      contract: base,
      selectedFiles: [
        {
          path: "server/src/performance/performanceTrace.ts",
          usage: "inspect-and-edit",
          evidenceLevel: "model_proposed",
        },
        {
          path: "apps/desktop/renderer/src/components/performance/PerformanceDiagnosticsModal.tsx",
          usage: "inspect-and-edit",
          evidenceLevel: "inventory_exact",
        },
      ],
      missingRequiredLayers: ["client-api"],
      existingImplementationCandidates: [
        "server/src/performance/performanceTrace.ts",
      ],
    });

    assert.equal(gated.mode, "investigation");
    assert.equal(gated.allowImplementationGuidance, false);
    assert.ok(
      gated.implementationGateReasons.some((reason) =>
        reason.includes("Required layer coverage is incomplete"),
      ),
    );
    assert.ok(
      gated.implementationGateReasons.some((reason) =>
        reason.includes("ownership still needs code evidence"),
      ),
    );
    scenarios += 1;
  }

  console.log(`task execution contract smoke passed: ${scenarios} scenarios`);
}

run();
