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
  "apps/desktop/renderer/src/lib/score.ts",
  "apps/desktop/renderer/src/hooks/useDashboardController.ts",
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
      rawTask: "В разделе проектов замени текст пустого состояния «No projects yet» на «Проектов пока нет».",
      projectTree,
      taskArea: "general",
      understanding: understanding({
        goal: "Replace the projects empty-state text.",
        action: "replace",
        requestedChanges: ["Replace the exact empty-state text."],
        changeDefinition: "exact",
        explicitValues: [
          { kind: "text", value: "No projects yet", exact: true, source: "user" },
          { kind: "text", value: "Проектов пока нет", exact: true, source: "user" },
        ],
      }),
      structuredIntent: null,
      fileRoleHints: ["state", "component"],
    });

    assert.deepEqual(
      contract.requiredLayers,
      [],
      "an exact empty-state text replacement must not force a state layer",
    );
    assert.equal(contract.mode, "implementation");
    scenarios += 1;
  }

  {
    const contract = buildTaskExecutionContract({
      rawTask: "В API генерации Task Pack добавь булево поле, показывающее, был ли refinement получен из кеша.",
      projectTree,
      taskArea: "backend",
      understanding: understanding({
        goal: "Add a boolean API field indicating whether refinement came from cache.",
        action: "update",
        requestedChanges: [
          "Expose cache provenance in the Task Pack generation API response.",
        ],
      }),
      structuredIntent: null,
      fileRoleHints: ["component", "state", "style", "api", "route", "service"],
    });

    assert.deepEqual(
      contract.requiredLayers,
      ["backend"],
      "cache provenance in an API response must not force UI/controller state",
    );
    assert.equal(contract.mode, "implementation");
    assert.ok(
      contract.forbiddenAssumptions.some((value) =>
        value.includes("equivalent producer value already exists"),
      ),
    );
    scenarios += 1;
  }

  {
    const contract = buildTaskExecutionContract({
      rawTask: "В разделе Projects замени текст пустого состояния.",
      projectTree: [
        ...projectTree,
        "server/src/routes/projects.ts",
        "apps/desktop/renderer/src/components/projects/ProjectsSection.tsx",
      ],
      taskArea: "general",
      understanding: understanding({
        targetHints: ["server/src/routes/projects.ts"],
      }),
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [
          {
            kind: "entity",
            value: "Projects",
            path: "server/src/routes/projects.ts",
            confidence: 0.9,
            evidence: "Model inferred a section target.",
            provenance: "model_proposed",
          },
        ],
        positiveActions: [],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: false,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
      fileRoleHints: ["component"],
    });

    assert.equal(
      contract.confirmedTargets.includes("server/src/routes/projects.ts"),
      false,
      "a UI section label must not user-confirm a same-stem backend file",
    );
    assert.ok(contract.proposedTargets.includes("server/src/routes/projects.ts"));
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

  {
    const base = buildTaskExecutionContract({
      rawTask: "Add a boolean cache provenance field to the Task Pack API response.",
      projectTree,
      taskArea: "backend",
      understanding: understanding(),
      structuredIntent: null,
      fileRoleHints: ["api", "route", "service"],
    });
    const gated = applySelectionEvidenceGate({
      contract: base,
      selectedFiles: [
        {
          path: "server/src/routes/taskPacks.ts",
          usage: "inspect-and-edit",
          evidenceLevel: "graph_supported",
          selectionEvidence: {
            targetSource: "user_text",
            pathValidity: "inventory_exact",
            ownershipEvidence: "route_graph",
            actionConfidence: "inspect_then_edit",
            semanticRoles: ["route", "contract"],
            symbols: ["generationCached", "cached"],
            chain: [],
            negativeConstraintConflicts: [],
            reason: "The route imports the producer and owns the API response.",
          },
        },
      ],
      existingImplementationRequiresReview: true,
      existingImplementationCandidates: [
        "server/src/ollama/taskPackGenerationReliability.ts",
      ],
    });

    assert.equal(gated.mode, "implementation");
    assert.equal(gated.implementationGateReasons.length, 0);
    assert.deepEqual(gated.confirmedTargets, ["server/src/routes/taskPacks.ts"]);
    scenarios += 1;
  }


  {
    const rawTask =
      "Исправь ошибку, из-за которой после повторного сканирования проекта карточка показывает старый readiness score.";
    const base = buildTaskExecutionContract({
      rawTask,
      projectTree,
      taskArea: "bugfix",
      understanding: understanding(),
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [
          {
            kind: "explicit_file",
            value: "apps/desktop/renderer/src/lib/score.ts",
            path: "apps/desktop/renderer/src/lib/score.ts",
            confidence: 0.9,
            evidence: "Model proposed a path from the word score.",
            provenance: "user_confirmed",
          },
        ],
        positiveActions: [],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: null,
        needsBackend: null,
        ambiguities: [],
        modelNotes: [],
      },
      fileRoleHints: ["component", "state"],
    });

    assert.equal(base.confirmedTargets.length, 0);
    assert.equal(base.targetEvidence[0]?.evidenceLevel, "inventory_exact");
    assert.equal(base.targetEvidence[0]?.confirmedForImplementation, false);

    const staleContract = {
      ...base,
      confirmedTargets: ["apps/desktop/renderer/src/lib/score.ts"],
      targetEvidence: [
        {
          target: "apps/desktop/renderer/src/lib/score.ts",
          path: "apps/desktop/renderer/src/lib/score.ts",
          evidenceLevel: "user_confirmed" as const,
          confirmedForImplementation: true,
          reason: "Stale model provenance.",
        },
      ],
    };
    const gated = applySelectionEvidenceGate({
      contract: staleContract,
      rawTask,
      selectedFiles: [
        {
          path: "apps/desktop/renderer/src/hooks/useDashboardController.ts",
          usage: "inspect-only",
          evidenceLevel: "graph_supported",
        },
      ],
    });

    assert.equal(gated.confirmedTargets.length, 0);
    assert.ok(
      !gated.implementationGateReasons.some((reason) =>
        reason.includes("Final selection omitted confirmed target"),
      ),
    );
    assert.ok(
      !gated.targetEvidence.some((target) =>
        target.path === "apps/desktop/renderer/src/lib/score.ts",
      ),
    );
    scenarios += 1;
  }

  {
    const rawTask = "Сделай карточки проектов удобнее и современнее.";
    const base = buildTaskExecutionContract({
      rawTask,
      projectTree: [
        ...projectTree,
        "apps/desktop/renderer/src/components/projects/ProjectCard.tsx",
      ],
      taskArea: "ui",
      understanding: understanding({
        action: "update",
        readiness: "review",
        reviewStatus: "accepted",
        interpretationRisk: "subjective",
        changeDefinition: "open_ended",
      }),
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [
          {
            kind: "component",
            value: "ProjectCard",
            path: "apps/desktop/renderer/src/components/projects/ProjectCard.tsx",
            confidence: 0.86,
            evidence: "Repository symbol match.",
            provenance: "graph_supported",
          },
        ],
        positiveActions: [],
        protectedScopes: [],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: true,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
      fileRoleHints: ["component"],
    });
    const gated = applySelectionEvidenceGate({
      contract: base,
      rawTask,
      selectedFiles: [
        {
          path: "apps/desktop/renderer/src/components/projects/ProjectCard.tsx",
          usage: "inspect-and-edit",
          evidenceLevel: "graph_supported",
          selectionEvidence: {
            targetSource: "user_text",
            pathValidity: "inventory_exact",
            ownershipEvidence: "symbol_exact",
            actionConfidence: "confirmed_edit",
            semanticRoles: ["display"],
            symbols: ["ProjectCard"],
            chain: [],
            negativeConstraintConflicts: [],
            reason: "The symbol owns the rendered card.",
          },
        },
      ],
    });

    assert.equal(gated.authorization?.intentAccepted, true);
    assert.equal(gated.authorization?.scopeConfirmed, false);
    assert.equal(gated.mode, "investigation");
    assert.equal(gated.allowImplementationGuidance, false);
    assert.equal(gated.confirmedTargets.length, 0);
    assert.ok(
      gated.implementationGateReasons.some((reason) =>
        reason.includes("Open-ended task scope is not confirmed"),
      ),
    );
    scenarios += 1;
  }

  {
    const rawTask = "Update the project status card behavior.";
    const targetPath =
      "apps/desktop/renderer/src/components/projects/ProjectCard.tsx";
    const selectedFiles = [
      {
        path: targetPath,
        usage: "inspect-and-edit",
        evidenceLevel: "graph_supported" as const,
        selectionEvidence: {
          targetSource: "user_text" as const,
          pathValidity: "inventory_exact" as const,
          ownershipEvidence: "symbol_exact" as const,
          actionConfidence: "confirmed_edit" as const,
          semanticRoles: ["display" as const],
          symbols: ["ProjectCard"],
          chain: [],
          negativeConstraintConflicts: [],
          reason: "The symbol owns the requested card behavior.",
        },
      },
    ];
    const pending = buildTaskExecutionContract({
      rawTask,
      projectTree: [...projectTree, targetPath],
      taskArea: "ui",
      understanding: understanding({
        readiness: "review",
        reviewStatus: "pending",
      }),
      structuredIntent: null,
      fileRoleHints: ["component"],
    });
    const pendingGated = applySelectionEvidenceGate({
      contract: pending,
      rawTask,
      selectedFiles,
    });
    assert.equal(pendingGated.mode, "investigation");
    assert.deepEqual(pendingGated.authorization?.authorizedTargets, []);

    const accepted = buildTaskExecutionContract({
      rawTask,
      projectTree: [...projectTree, targetPath],
      taskArea: "ui",
      understanding: understanding({
        readiness: "review",
        reviewStatus: "accepted",
      }),
      structuredIntent: null,
      fileRoleHints: ["component"],
    });
    const acceptedGated = applySelectionEvidenceGate({
      contract: accepted,
      rawTask,
      selectedFiles,
    });
    assert.equal(acceptedGated.mode, "implementation");
    assert.deepEqual(acceptedGated.confirmedTargets, [targetPath]);
    assert.deepEqual(acceptedGated.authorization?.authorizedTargets, [targetPath]);
    scenarios += 1;
  }

  {
    const rawTask =
      "В файле AGENTS.md добавь раздел Local verification с командами npm run test:selector и npm run build. Исходный код приложения не меняй.";
    const contract = buildTaskExecutionContract({
      rawTask,
      projectTree: [...projectTree, "AGENTS.md"],
      taskArea: "build",
      understanding: understanding({
        targetHints: ["AGENTS.md"],
        constraints: ["Do not change application source code."],
      }),
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [{
          kind: "explicit_file",
          value: "AGENTS.md",
          path: "AGENTS.md",
          confidence: 0.99,
          evidence: "Explicit real file path.",
          provenance: "user_confirmed",
        }],
        positiveActions: ["Add Local verification documentation"],
        protectedScopes: ["application source code"],
        allowedEditScope: "explicit_targets_only",
        needsStyles: false,
        needsBackend: null,
        ambiguities: [],
        modelNotes: [],
      },
      fileRoleHints: ["config", "test"],
    });

    assert.deepEqual(contract.requiredLayers, ["docs"]);
    assert.deepEqual(contract.confirmedTargets, ["AGENTS.md"]);
    scenarios += 1;
  }

  {
    const targetPath = "apps/desktop/renderer/src/App.backup.txt";
    const rawTask =
      `Удали устаревший ${targetPath}, если он не используется. ` +
      "Рабочий App.tsx и поведение приложения не меняй.";
    const contract = buildTaskExecutionContract({
      rawTask,
      projectTree: [targetPath, "apps/desktop/renderer/src/App.tsx"],
      taskArea: "ui",
      understanding: understanding({
        action: "remove",
        targetHints: [targetPath],
        constraints: ["Do not change App.tsx or application behavior."],
      }),
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [{
          kind: "explicit_file",
          value: targetPath,
          path: targetPath,
          confidence: 0.99,
          evidence: "The user named one exact file.",
          provenance: "user_confirmed",
        }],
        positiveActions: ["Remove the exact stale file if unused"],
        protectedScopes: ["App.tsx", "application behavior"],
        allowedEditScope: "explicit_targets_only",
        needsStyles: false,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
      fileRoleHints: [],
    });

    assert.deepEqual(contract.confirmedTargets, [targetPath]);
    assert.equal(
      contract.forbiddenAssumptions.some((value) =>
        value.includes(`Protected scope: ${targetPath}`),
      ),
      false,
    );
    scenarios += 1;
  }

  {
    const base = buildTaskExecutionContract({
      rawTask: "Sort saved items by creation date, newest first.",
      projectTree,
      taskArea: "general",
      understanding: understanding(),
      structuredIntent: null,
      fileRoleHints: [],
    });
    const gated = applySelectionEvidenceGate({
      contract: base,
      rawTask: "Sort saved items by creation date, newest first.",
      selectedFiles: [],
    });

    assert.equal(gated.mode, "investigation");
    assert.equal(gated.allowImplementationGuidance, false);
    assert.ok(
      gated.implementationGateReasons.some((reason) =>
        reason.includes("No implementation target is confirmed"),
      ),
    );
    scenarios += 1;
  }

  {
    const tasks = [
      "В Settings добавь кнопку проверки подключения. Используй существующий API и не создавай новый backend route.",
      "На странице Settings добавь кнопку проверки. Новый backend route не создавай.",
      "Добавь в Settings кнопку проверки через существующий status API без нового backend route.",
      "В разделе Settings сделай кнопку проверки и не добавляй отдельный backend route.",
      "На странице Settings добавь кнопку проверки; backend route создавать не нужно.",
    ];
    for (const rawTask of tasks) {
      const contract = buildTaskExecutionContract({
        rawTask,
        projectTree,
        taskArea: "fullstack",
        understanding: understanding({
          readiness: "review",
          reviewStatus: "accepted",
          changeDefinition: "open_ended",
          targetHints: [
            "apps/desktop/renderer/src/pages/SettingsPage.tsx",
          ],
        }),
        structuredIntent: {
          schemaVersion: 1,
          primaryTargets: [],
          positiveActions: ["Add a UI connection-check control."],
          protectedScopes: [],
          allowedEditScope: "target_with_supporting_context",
          needsStyles: null,
          needsBackend: true,
          ambiguities: [],
          modelNotes: [],
        },
        fileRoleHints: ["page", "client-api", "route"],
      });

      assert.equal(
        contract.requiredLayers.includes("backend"),
        false,
        `backend must stay protected for: ${rawTask}`,
      );
      assert.equal(contract.requiredLayers.includes("ui"), true);
      scenarios += 1;
    }
  }

  {
    const contract = buildTaskExecutionContract({
      rawTask:
        "Add a pairing helper to the connected devices screen. Keep the backend pairing API unchanged.",
      projectTree: [
        ...projectTree,
        "src/pages/DevicesPage.tsx",
        "src/app/api/pairing/route.ts",
      ],
      taskArea: "fullstack",
      understanding: understanding({
        targetHints: ["src/pages/DevicesPage.tsx"],
      }),
      structuredIntent: {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: ["Add a UI pairing helper."],
        protectedScopes: ["backend pairing api"],
        allowedEditScope: "target_with_supporting_context",
        needsStyles: false,
        needsBackend: false,
        ambiguities: [],
        modelNotes: [],
      },
      fileRoleHints: ["page", "api", "route"],
    });

    assert.equal(contract.requiredLayers.includes("backend"), false);
    assert.equal(contract.requiredLayers.includes("ui"), true);
    scenarios += 1;
  }

  const exactPrimaryTarget = (
    path: string,
    semanticRoles: Array<"display" | "reference"> = ["reference"],
  ) => ({
    path,
    usage: "inspect-and-edit",
    evidenceLevel: "graph_supported" as const,
    selectionEvidence: {
      targetSource: "user_text" as const,
      pathValidity: "inventory_exact" as const,
      ownershipEvidence: "symbol_exact" as const,
      actionConfidence: "confirmed_edit" as const,
      semanticRoles,
      symbols: ["TargetOwner"],
      chain: [],
      negativeConstraintConflicts: [],
      reason: "The exact current target has a grounded owner proof.",
    },
  });
  const supportingFile = (path: string) => ({
    path,
    usage: "inspect-only",
    evidenceLevel: "inventory_exact" as const,
    selectionEvidence: {
      targetSource: "ranking" as const,
      pathValidity: "inventory_exact" as const,
      ownershipEvidence: "reference_graph" as const,
      actionConfidence: "inspect_only" as const,
      semanticRoles: ["reference" as const],
      symbols: [],
      chain: [],
      negativeConstraintConflicts: [],
      reason: "Relevant supporting context only.",
    },
  });
  const groundedProof = (path: string) => ({
    path,
    role: "target" as const,
    evidenceCurrent: true as const,
    findingConfirmed: true as const,
    targetRoleSupported: true as const,
    snapshotCurrent: true as const,
    ambiguityResolved: true as const,
    constraintsSatisfied: true as const,
  });
  const explicitStructuredIntent = (path: string) => ({
    schemaVersion: 1 as const,
    primaryTargets: [{
      kind: "explicit_file" as const,
      value: path,
      path,
      confidence: 1,
      evidence: "Exact path provided by the user.",
      provenance: "user_confirmed" as const,
    }],
    positiveActions: ["Update the exact target."],
    protectedScopes: [],
    allowedEditScope: "target_with_supporting_context" as const,
    needsStyles: false,
    needsBackend: null,
    ambiguities: [],
    modelNotes: [],
  });
  const inventoryFile = (
    path: string,
    role: "types" | "component" = "types",
  ) => ({ path, kind: "source" as const, role });

  // A verified exact primary target outranks a single inferred area/layer mismatch.
  {
    const target = "src/types/options.ts";
    const rawTask = `In ${target} update TargetOwner.`;
    const base = buildTaskExecutionContract({
      rawTask,
      projectTree: [target],
      taskArea: "ui",
      understanding: understanding({ targetHints: [target], changeDefinition: "exact" }),
      structuredIntent: explicitStructuredIntent(target),
      fileRoleHints: ["types"],
    });
    const gated = applySelectionEvidenceGate({
      contract: base,
      rawTask,
      selectedFiles: [exactPrimaryTarget(target)],
      inventoryFiles: [inventoryFile(target)],
      repositoryGroundedProofs: [groundedProof(target)],
      verifiedExplicitPrimaryTargetPaths: [target],
    });
    assert.deepEqual(base.requiredLayers, ["ui"]);
    assert.deepEqual(gated.missingConfirmedLayers, ["ui"]);
    assert.equal(gated.mode, "implementation");
    assert.deepEqual(gated.authorization?.authorizedTargets, [target]);
    scenarios += 1;
  }

  // Matching inferred area behavior remains unchanged.
  {
    const target = "src/components/TargetPanel.tsx";
    const rawTask = `In ${target} update TargetOwner.`;
    const base = buildTaskExecutionContract({
      rawTask,
      projectTree: [target],
      taskArea: "ui",
      understanding: understanding({ targetHints: [target], changeDefinition: "exact" }),
      structuredIntent: explicitStructuredIntent(target),
      fileRoleHints: ["component"],
    });
    const gated = applySelectionEvidenceGate({
      contract: base,
      rawTask,
      selectedFiles: [exactPrimaryTarget(target, ["display"])],
      inventoryFiles: [inventoryFile(target, "component")],
      repositoryGroundedProofs: [groundedProof(target)],
      verifiedExplicitPrimaryTargetPaths: [target],
    });
    assert.equal(gated.mode, "implementation");
    assert.deepEqual(gated.missingConfirmedLayers, []);
    assert.deepEqual(gated.authorization?.authorizedTargets, [target]);
    scenarios += 1;
  }

  // Explicitly requested multi-layer work remains incomplete when one layer is absent.
  {
    const target = "src/components/TargetPanel.tsx";
    const rawTask = `Update the UI in ${target} and update the backend API.`;
    const base = buildTaskExecutionContract({
      rawTask,
      projectTree: [target, "server/src/api.ts"],
      taskArea: "fullstack",
      understanding: understanding({ targetHints: [target], changeDefinition: "exact" }),
      structuredIntent: explicitStructuredIntent(target),
      fileRoleHints: ["component", "api"],
    });
    const gated = applySelectionEvidenceGate({
      contract: base,
      rawTask,
      selectedFiles: [exactPrimaryTarget(target, ["display"])],
      inventoryFiles: [inventoryFile(target, "component"), { path: "server/src/api.ts", kind: "source", role: "api-route" }],
      repositoryGroundedProofs: [groundedProof(target)],
      verifiedExplicitPrimaryTargetPaths: [target],
    });
    assert.equal(base.requiredLayers.includes("ui"), true);
    assert.equal(base.requiredLayers.includes("backend"), true);
    assert.equal(gated.mode, "investigation");
    assert.ok(gated.implementationGateReasons.some((reason) => reason.includes("backend")));
    scenarios += 1;
  }

  // Without exact primary-target provenance, inferred layer behavior is unchanged.
  {
    const target = "src/types/options.ts";
    const rawTask = "Update the UI behavior.";
    const base = buildTaskExecutionContract({
      rawTask,
      projectTree: [target],
      taskArea: "ui",
      understanding: understanding(),
      structuredIntent: null,
      fileRoleHints: ["types"],
    });
    const gated = applySelectionEvidenceGate({
      contract: base,
      rawTask,
      selectedFiles: [exactPrimaryTarget(target)],
      inventoryFiles: [inventoryFile(target)],
      repositoryGroundedProofs: [groundedProof(target)],
    });
    assert.equal(gated.mode, "investigation");
    assert.ok(gated.implementationGateReasons.some((reason) => reason.includes("layer coverage")));
    scenarios += 1;
  }

  // A model/inventory proposal cannot use the exact-primary exception.
  {
    const target = "src/types/options.ts";
    const rawTask = "Update the UI behavior.";
    const base = buildTaskExecutionContract({
      rawTask,
      projectTree: [target],
      taskArea: "ui",
      understanding: understanding(),
      structuredIntent: null,
      fileRoleHints: ["types"],
    });
    const exact = exactPrimaryTarget(target);
    const proposed = {
      ...exact,
      selectionEvidence: {
        ...exact.selectionEvidence,
        targetSource: "ranking" as const,
      },
    };
    const gated = applySelectionEvidenceGate({
      contract: base,
      rawTask,
      selectedFiles: [proposed],
      inventoryFiles: [inventoryFile(target)],
      repositoryGroundedProofs: [groundedProof(target)],
      verifiedExplicitPrimaryTargetPaths: [target],
    });
    assert.equal(gated.mode, "investigation");
    assert.deepEqual(gated.authorization?.authorizedTargets, []);
    scenarios += 1;
  }

  // A useful sibling remains inspect-only while the exact target stays editable.
  {
    const target = "src/types/options.ts";
    const sibling = "src/components/OptionsPanel.tsx";
    const rawTask = `In ${target} update TargetOwner.`;
    const base = buildTaskExecutionContract({
      rawTask,
      projectTree: [target, sibling],
      taskArea: "ui",
      understanding: understanding({ targetHints: [target], changeDefinition: "exact" }),
      structuredIntent: explicitStructuredIntent(target),
      fileRoleHints: ["types", "component"],
    });
    const gated = applySelectionEvidenceGate({
      contract: base,
      rawTask,
      selectedFiles: [exactPrimaryTarget(target), supportingFile(sibling)],
      inventoryFiles: [inventoryFile(target), inventoryFile(sibling, "component")],
      repositoryGroundedProofs: [groundedProof(target)],
      verifiedExplicitPrimaryTargetPaths: [target],
    });
    assert.equal(gated.mode, "implementation");
    assert.deepEqual(gated.authorization?.authorizedTargets, [target]);
    assert.equal(gated.targetEvidence.find((item) => item.path === sibling)?.confirmedForImplementation, false);
    scenarios += 1;
  }

  // Equivalent selection/inventory ordering produces the same authority result.
  {
    const target = "src/types/options.ts";
    const sibling = "src/components/OptionsPanel.tsx";
    const rawTask = `In ${target} update TargetOwner.`;
    const base = buildTaskExecutionContract({
      rawTask,
      projectTree: [target, sibling],
      taskArea: "ui",
      understanding: understanding({ targetHints: [target], changeDefinition: "exact" }),
      structuredIntent: explicitStructuredIntent(target),
      fileRoleHints: ["types", "component"],
    });
    const evaluate = (reversed: boolean) => applySelectionEvidenceGate({
      contract: structuredClone(base),
      rawTask,
      selectedFiles: reversed
        ? [supportingFile(sibling), exactPrimaryTarget(target)]
        : [exactPrimaryTarget(target), supportingFile(sibling)],
      inventoryFiles: reversed
        ? [inventoryFile(sibling, "component"), inventoryFile(target)]
        : [inventoryFile(target), inventoryFile(sibling, "component")],
      repositoryGroundedProofs: [groundedProof(target)],
      verifiedExplicitPrimaryTargetPaths: [target],
    });
    const summarize = (contract: ReturnType<typeof evaluate>) => ({
      mode: contract.mode,
      confirmed: [...contract.confirmedTargets].sort(),
      authorized: [...(contract.authorization?.authorizedTargets ?? [])].sort(),
      gates: [...contract.implementationGateReasons].sort(),
      evidence: contract.targetEvidence.map((item) => ({ path: item.path, confirmed: item.confirmedForImplementation })).sort((left, right) => String(left.path).localeCompare(String(right.path))),
    });
    assert.deepEqual(summarize(evaluate(false)), summarize(evaluate(true)));
    scenarios += 1;
  }

  console.log(`task execution contract smoke passed: ${scenarios} scenarios`);
}

run();
