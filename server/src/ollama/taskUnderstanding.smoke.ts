import assert from "node:assert/strict";

import {
  buildFallbackTaskUnderstanding,
  filterTaskUnderstandingAmbiguities,
  normalizeTaskUnderstanding,
  type TaskUnderstanding,
} from "./taskUnderstanding.js";
import {
  applyTaskClarificationsToUnderstanding,
  buildSelectionTaskText,
} from "../taskPacks/taskClarifications.js";
import {
  resolveTaskUnderstandingInteraction,
} from "../taskPacks/taskUnderstandingInteraction.js";
import {
  buildCompactIntentProjectTreeSnapshot,
  buildIntentPrompt,
  TASK_UNDERSTANDING_INITIAL_NUM_PREDICT,
  TASK_UNDERSTANDING_PROJECT_PATH_LIMIT,
  TASK_UNDERSTANDING_REPAIR_NUM_PREDICT,
} from "./taskIntentAnalyzer.js";

const projectTree = [
  "apps/desktop/renderer/src/pages/SettingsPage.tsx",
  "apps/desktop/renderer/src/pages/LoginPage.tsx",
  "server/src/routes/auth.ts",
  "README.md",
];

const emptyStructuredIntent = {
  primaryTargets: [],
  positiveActions: [],
  protectedScopes: [],
  allowedEditScope: "unknown",
  ambiguities: [],
};

function fallback(
  rawTask: string,
  overrides: Partial<Parameters<typeof buildFallbackTaskUnderstanding>[0]> = {},
) {
  return buildFallbackTaskUnderstanding({
    rawTask,
    taskArea: "general",
    taskType: "general",
    confidence: 0.72,
    projectTree,
    structuredIntent: emptyStructuredIntent,
    ...overrides,
  });
}

function assertReady(result: TaskUnderstanding) {
  assert.equal(result.readiness, "ready");
  assert.equal(result.canProceed, true);
  assert.equal(result.clarificationQuestion, null);
}

function testMissingRussianReplacement() {
  const result = fallback(
    "На странице Settings измени пояснение под заголовком Experimental AI Core.",
  );
  assert.equal(result.readiness, "needs_clarification");
  assert.equal(result.canProceed, false);
  assert.equal(result.missingInformation[0]?.code, "replacement_value");
  assert.match(result.clarificationQuestion ?? "", /Какой точный/u);
}

function testRussianQuotedReplacement() {
  const result = fallback(
    "На странице Settings замени пояснение на «Shadow проверяет реальные файлы проекта».",
  );
  assertReady(result);
  assert.equal(result.action, "replace");
  assert.equal(
    result.explicitValues[0]?.value,
    "Shadow проверяет реальные файлы проекта",
  );
  assert.equal(result.explicitValues[0]?.kind, "text");
}

function testEnglishQuotedReplacement() {
  const result = fallback(
    'Replace the Settings description with "Shadow validates real project files".',
  );
  assertReady(result);
  assert.equal(
    result.explicitValues[0]?.value,
    "Shadow validates real project files",
  );
}

function testLiteralKinds() {
  const color = fallback("Set the button color to #22c55e.");
  assertReady(color);
  assert.equal(color.explicitValues[0]?.kind, "color");

  const url = fallback("Set the endpoint URL to https://example.com/api.");
  assertReady(url);
  assert.equal(url.explicitValues[0]?.kind, "url");

  const limit = fallback("Установи лимит на 25.");
  assertReady(limit);
  assert.equal(limit.explicitValues[0]?.kind, "number");

  const version = fallback("Set the version to v0.6.7.");
  assertReady(version);
  assert.equal(version.explicitValues[0]?.kind, "version");
}

function testTransformationGoalDoesNotRequireLiteral() {
  const result = fallback("Сделай пояснение под заголовком короче и понятнее.");
  assert.equal(result.readiness, "review");
  assert.equal(result.canProceed, true);
  assert.equal(result.missingInformation.length, 0);
  assert.equal(result.interpretationRisk, "subjective");
  assert.equal(result.changeDefinition, "open_ended");
}

function testRussianComparativeUiTaskUsesReview() {
  const result = fallback(
    "В компоненте Sidebar сделай навигационные элементы визуально компактнее и аккуратнее, сохранив текущую структуру и поведение.",
  );
  assert.equal(result.readiness, "review");
  assert.equal(result.canProceed, true);
  assert.equal(result.interpretationRisk, "subjective");
  assert.equal(result.changeDefinition, "open_ended");
}

function testEnglishComparativeUiTaskUsesReview() {
  const result = fallback(
    "Make the AppHeader visually lighter and more modern without changing its structure.",
  );
  assert.equal(result.readiness, "review");
  assert.equal(result.canProceed, true);
  assert.equal(result.interpretationRisk, "subjective");
  assert.equal(result.changeDefinition, "open_ended");
}

function testNoFilePathIsNotMissingContext() {
  const result = fallback("Почини авторизацию: токен иногда отваливается после перезапуска.");
  assertReady(result);
  assert.equal(result.missingInformation.length, 0);
  assert.ok(
    result.reasons.some((reason) =>
      reason.includes("No exact project path is required"),
    ),
  );
}

function testOpenEndedArchitectureTaskRequiresClarification() {
  const result = fallback("Добавь новый способ подключения в приложение.", {
    taskArea: "backend",
  });

  assert.equal(result.action, "create");
  assert.equal(result.changeDefinition, "open_ended");
  assert.equal(result.interpretationRisk, "uncertain");
  assert.equal(result.readiness, "needs_clarification");
  assert.equal(result.canProceed, false);
  assert.ok(
    result.missingInformation.some(
      (item) => item.code === "architecture_decision" && item.required,
    ),
  );
  assert.match(result.clarificationQuestion ?? "", /Уточните/u);
}

function testUngroundedModelHintDoesNotBypassArchitectureClarification() {
  const rawTask = "Добавь новый способ авторизации в приложение.";
  const base = fallback(rawTask, { taskArea: "backend" });
  const result = normalizeTaskUnderstanding({
    modelValue: {
      taskUnderstanding: {
        goal: "Добавить новый способ авторизации",
        action: "create",
        targetHints: ["authorization"],
        interpretationRisk: "objective",
        changeDefinition: "open_ended",
        confidence: 0.94,
      },
    },
    fallback: base,
    rawTask,
    taskArea: "backend",
    taskType: "backend",
    confidence: 0.94,
    projectTree,
    structuredIntent: {
      ...emptyStructuredIntent,
      ambiguities: ["Какой provider и пользовательский flow нужны?"],
    },
  });

  assert.equal(result.readiness, "needs_clarification");
  assert.equal(result.interpretationRisk, "uncertain");
  assert.ok(
    result.missingInformation.some(
      (item) => item.code === "architecture_decision",
    ),
  );
}

function testVagueTaskUsesReviewWithoutBlocking() {
  const result = fallback("Сделай тут нормально, а то всё деревянное.");
  assert.equal(result.readiness, "review");
  assert.equal(result.canProceed, true);
  assert.equal(result.clarificationQuestion, null);
}


function testSubjectivePolishUsesReview() {
  const result = fallback(
    "На странице Settings сделай блок Experimental AI Core менее деревянным.",
  );
  assert.equal(result.readiness, "review");
  assert.equal(result.canProceed, true);
  assert.equal(result.interpretationRisk, "subjective");
  assert.equal(result.changeDefinition, "open_ended");
}

function testModelSubjectiveOpenEndedUsesReview() {
  const rawTask = "Polish the Settings card.";
  const base = fallback(rawTask);
  const result = normalizeTaskUnderstanding({
    modelValue: {
      taskUnderstanding: {
        goal: "Polish the Settings card",
        action: "update",
        targetHints: ["Settings"],
        requestedChanges: ["polish the Settings card"],
        constraints: [],
        interpretationRisk: "subjective",
        changeDefinition: "open_ended",
        confidence: 0.86,
      },
    },
    fallback: base,
    rawTask,
    taskArea: "ui",
    taskType: "ui",
    confidence: 0.82,
    projectTree,
    structuredIntent: {
      ...emptyStructuredIntent,
      primaryTargets: [{ kind: "page", value: "Settings" }],
    },
  });

  assert.equal(result.readiness, "review");
  assert.equal(result.canProceed, true);
  assert.equal(result.interpretationRisk, "subjective");
  assert.equal(result.changeDefinition, "open_ended");
}

function testExactValueOverridesSubjectiveModelGuess() {
  const rawTask =
    'Replace the Settings description with "Shadow validates context".';
  const base = fallback(rawTask);
  const result = normalizeTaskUnderstanding({
    modelValue: {
      taskUnderstanding: {
        goal: "Replace the Settings description",
        action: "replace",
        targetHints: ["Settings"],
        interpretationRisk: "subjective",
        changeDefinition: "open_ended",
        confidence: 0.91,
      },
    },
    fallback: base,
    rawTask,
    taskArea: "ui",
    taskType: "ui",
    confidence: 0.82,
    projectTree,
    structuredIntent: {
      ...emptyStructuredIntent,
      primaryTargets: [{ kind: "page", value: "Settings" }],
    },
  });

  assertReady(result);
  assert.equal(result.interpretationRisk, "objective");
  assert.equal(result.changeDefinition, "exact");
}

function testStructuredTargetsAndConstraints() {
  const result = fallback("Обнови Settings, backend не трогай.", {
    taskArea: "ui",
    structuredIntent: {
      primaryTargets: [
        {
          kind: "page",
          value: "Settings",
          name: "Settings",
        },
      ],
      positiveActions: ["update Settings"],
      protectedScopes: ["backend/api"],
      allowedEditScope: "target_with_supporting_context",
      ambiguities: [],
    },
  });
  assertReady(result);
  assert.ok(result.constraints.includes("backend/api"));
}

function testModelMergeKeepsBackendAuthority() {
  const base = fallback(
    "На странице Settings замени пояснение на «Точный текст».",
  );
  const result = normalizeTaskUnderstanding({
    modelValue: {
      taskUnderstanding: {
        goal: "Replace the Settings explanation with the exact text",
        action: "replace",
        targetHints: ["Settings", "InventedAdminPage"],
        requestedChanges: ["replace Settings explanation"],
        constraints: ["Settings only"],
        missingInformation: ["replacement_value"],
        readiness: "needs_clarification",
        canProceed: false,
        clarificationQuestion: "What text?",
        confidence: 0.95,
      },
    },
    fallback: base,
    rawTask: "На странице Settings замени пояснение на «Точный текст».",
    taskArea: "ui",
    taskType: "ui",
    confidence: 0.82,
    projectTree,
    structuredIntent: {
      ...emptyStructuredIntent,
      primaryTargets: [{ kind: "page", value: "Settings" }],
    },
  });

  assertReady(result);
  assert.equal(result.source, "merged");
  assert.equal(result.targetHints.includes("InventedAdminPage"), false);
  assert.equal(result.explicitValues[0]?.value, "Точный текст");
  assert.equal(result.missingInformation.length, 0);
}

function testModelCannotClearRealMissingValue() {
  const rawTask = "Change the Settings description.";
  const base = fallback(rawTask);
  const result = normalizeTaskUnderstanding({
    modelValue: {
      taskUnderstanding: {
        goal: "Change the Settings description",
        action: "update",
        targetHints: ["Settings"],
        readiness: "ready",
        canProceed: true,
        confidence: 0.99,
      },
    },
    fallback: base,
    rawTask,
    taskArea: "ui",
    taskType: "ui",
    confidence: 0.9,
    projectTree,
    structuredIntent: {
      ...emptyStructuredIntent,
      primaryTargets: [{ kind: "page", value: "Settings" }],
    },
  });

  assert.equal(result.readiness, "needs_clarification");
  assert.equal(result.canProceed, false);
  assert.equal(result.missingInformation[0]?.code, "replacement_value");
}

function testMixedLanguageTask() {
  const result = fallback(
    "На странице Settings set description to `Shadow validates context локально`.",
  );
  assertReady(result);
  assert.equal(
    result.explicitValues[0]?.value,
    "Shadow validates context локально",
  );
}

function testClarificationUnblocksMissingReplacementWithoutChangingTargetSemantics() {
  const rawTask =
    "На странице Settings измени пояснение под заголовком Experimental AI Core.";
  const clarifications = [
    {
      question: "Какой точный новый текст или значение нужно использовать?",
      answer: "Shadow валидирует реальные файлы проекта.",
    },
  ];
  const selectionTask = buildSelectionTaskText(rawTask, clarifications);
  const result = applyTaskClarificationsToUnderstanding(
    fallback(selectionTask),
    clarifications,
  );

  assert.equal(selectionTask, rawTask);
  assertReady(result);
  assert.equal(
    result.explicitValues[0]?.value,
    "Shadow валидирует реальные файлы проекта.",
  );
  assert.doesNotMatch(result.goal, /User Clarifications|Question:|User answer:/u);
}

function testPathOnlyAmbiguityIsNotBlocking() {
  assert.deepEqual(
    filterTaskUnderstandingAmbiguities([
      "No explicit inventory path was found in the task text.",
      "The replacement value is unclear.",
    ]),
    ["The replacement value is unclear."],
  );
}


function testBalancedModeReviewsSubjectiveTasks() {
  const result = fallback(
    "На странице Settings сделай блок Experimental AI Core менее деревянным.",
  );
  const decision = resolveTaskUnderstandingInteraction(result, "balanced");
  assert.equal(result.readiness, "review");
  assert.equal(decision.action, "review");
  assert.equal(decision.reason, "semantic_review_requested");
}

function testBalancedModeDefensivelyReviewsOpenEndedSemantics() {
  const readyButOpenEnded = {
    ...fallback('Replace the Settings description with "Exact text".'),
    readiness: "ready" as const,
    interpretationRisk: "subjective" as const,
    changeDefinition: "open_ended" as const,
  };
  const decision = resolveTaskUnderstandingInteraction(
    readyButOpenEnded,
    "balanced",
  );
  assert.equal(decision.action, "review");
  assert.equal(decision.reason, "semantic_review_requested");
}

function testAutomaticModeContinuesReviewTasks() {
  const result = fallback(
    "На странице Settings сделай блок Experimental AI Core менее деревянным.",
  );
  const decision = resolveTaskUnderstandingInteraction(result, "automatic");
  assert.equal(result.readiness, "review");
  assert.equal(decision.action, "continue");
  assert.equal(decision.reason, "automatic_review_bypass");
}

function testConfirmAllModeReviewsReadyTasks() {
  const result = fallback(
    'На странице Settings замени текст на "Shadow validates real files".',
  );
  const decision = resolveTaskUnderstandingInteraction(result, "confirm_all");
  assert.equal(result.readiness, "ready");
  assert.equal(decision.action, "review");
  assert.equal(decision.reason, "confirm_all_tasks");
}

function testRequiredClarificationCannotBeBypassed() {
  const result = fallback(
    "На странице Settings измени пояснение под заголовком Experimental AI Core.",
  );
  assert.equal(result.readiness, "needs_clarification");

  for (const mode of ["automatic", "balanced", "confirm_all"] as const) {
    const decision = resolveTaskUnderstandingInteraction(result, mode);
    assert.equal(decision.action, "clarify");
    assert.equal(decision.reason, "required_information_missing");
  }
}


function testModelUnknownCannotEraseGroundedAction() {
  const rawTask =
    'На странице Settings замени пояснение на «Новый точный текст».'.trim();
  const fallbackUnderstanding = fallback(rawTask);
  const result = normalizeTaskUnderstanding({
    modelValue: {
      taskUnderstanding: {
        goal: rawTask,
        action: "unknown",
        targetHints: [],
        requestedChanges: [],
        constraints: [],
        interpretationRisk: "objective",
        changeDefinition: "exact",
        confidence: 0.8,
      },
    },
    fallback: fallbackUnderstanding,
    rawTask,
    taskArea: "general",
    taskType: "general",
    confidence: 0.8,
    projectTree,
    structuredIntent: emptyStructuredIntent,
  });

  assert.equal(result.action, "replace");
  assert.equal(result.readiness, "ready");
}

function testFallbackSource() {
  const result = fallback("Обнови README и добавь команды запуска.", {
    taskArea: "docs",
    taskType: "docs",
  });
  assert.equal(result.source, "fallback");
  assert.equal(result.action, "create");
  assertReady(result);
}


function testCompactIntentTreeKeepsNamedTarget() {
  const largeTree = Array.from({ length: 180 }, (_, index) =>
    `server/src/generated/Placeholder${index}.ts`,
  );
  largeTree.push("apps/desktop/renderer/src/components/layout/AppHeader.tsx");
  largeTree.push("apps/desktop/renderer/src/components/layout/Sidebar.tsx");

  const snapshot = buildCompactIntentProjectTreeSnapshot(
    "В компоненте AppHeader сделай верхнюю панель легче.",
    largeTree,
  );

  assert.ok(
    snapshot.includes(
      "apps/desktop/renderer/src/components/layout/AppHeader.tsx",
    ),
  );
  assert.ok(snapshot.length <= TASK_UNDERSTANDING_PROJECT_PATH_LIMIT);
  assert.equal(snapshot[0]?.endsWith("AppHeader.tsx"), true);
}

function testCompactIntentPromptDropsHeavyProjectMetadata() {
  const largeTree = Array.from({ length: 240 }, (_, index) =>
    `apps/desktop/renderer/src/pages/Page${index}.tsx`,
  );
  largeTree.push("apps/desktop/renderer/src/components/layout/Sidebar.tsx");

  const prompt = buildIntentPrompt({
    rawTask:
      "В компоненте Sidebar сделай группы навигации визуально легче, не меняя поведение.",
    taskType: "general",
    targetTool: "codex",
    project: {
      name: "contextforge",
      localPath: "C:/private/contextforge",
      packageManager: "npm",
      detectedStack: ["React", "TypeScript", "Vite", "Electron"],
      scripts: {
        huge: "x".repeat(12000),
      },
      readinessScore: 86,
    },
    projectTree: largeTree,
  });

  assert.ok(prompt.includes("Sidebar.tsx"));
  assert.ok(prompt.includes("Keep the complete response under 360 tokens"));
  assert.equal(prompt.includes("C:/private/contextforge"), false);
  assert.equal(prompt.includes('"huge"'), false);
  assert.equal(prompt.includes("readinessScore"), false);
  assert.equal(prompt.includes('"intentTags"'), false);
  assert.ok(prompt.length < 9000, `compact prompt too large: ${prompt.length}`);
}

function testCompactIntentGenerationLimits() {
  assert.equal(TASK_UNDERSTANDING_INITIAL_NUM_PREDICT, 520);
  assert.equal(TASK_UNDERSTANDING_REPAIR_NUM_PREDICT, 360);
  assert.ok(
    TASK_UNDERSTANDING_INITIAL_NUM_PREDICT < 1300,
    "initial Understanding budget must stay below the legacy 1300 tokens",
  );
}


function testCompactIntentTreePreservesBackendAndFullstackCoverage() {
  const largeTree = [
    ...Array.from({ length: 120 }, (_, index) =>
      `apps/desktop/renderer/src/components/ui/Widget${index}.tsx`,
    ),
    "apps/desktop/renderer/src/pages/SettingsPage.tsx",
    "apps/desktop/renderer/src/api/settingsApi.ts",
    "server/src/routes/settings.ts",
    "server/src/settings/settingsService.ts",
  ];

  const backendSnapshot = buildCompactIntentProjectTreeSnapshot(
    "В backend API настроек добавь поле keepModelReady, UI не меняй.",
    largeTree,
    TASK_UNDERSTANDING_PROJECT_PATH_LIMIT,
    "backend",
  );
  assert.ok(backendSnapshot.some((path) => path.startsWith("server/")));

  const fullstackSnapshot = buildCompactIntentProjectTreeSnapshot(
    "Добавь в Settings переключатель keepModelReady и backend API для сохранения настройки.",
    largeTree,
    TASK_UNDERSTANDING_PROJECT_PATH_LIMIT,
    "fullstack",
  );
  assert.ok(
    fullstackSnapshot.some((path) => path.includes("SettingsPage.tsx")),
  );
  assert.ok(fullstackSnapshot.some((path) => path.startsWith("server/")));
}

function testCompactIntentTreeOmitsUnrelatedSecretAndRuntimePaths() {
  const snapshot = buildCompactIntentProjectTreeSnapshot(
    "Обнови документацию по запуску проекта.",
    [
      ".env",
      "server/data/contextforge.sqlite",
      "dist/server.js",
      "README.md",
      "docs/SETUP.md",
    ],
  );

  assert.equal(snapshot.includes(".env"), false);
  assert.equal(snapshot.includes("server/data/contextforge.sqlite"), false);
  assert.equal(snapshot.includes("dist/server.js"), false);
  assert.ok(snapshot.includes("README.md") || snapshot.includes("docs/SETUP.md"));
}

const tests = [
  testMissingRussianReplacement,
  testRussianQuotedReplacement,
  testEnglishQuotedReplacement,
  testLiteralKinds,
  testTransformationGoalDoesNotRequireLiteral,
  testRussianComparativeUiTaskUsesReview,
  testEnglishComparativeUiTaskUsesReview,
  testNoFilePathIsNotMissingContext,
  testOpenEndedArchitectureTaskRequiresClarification,
  testUngroundedModelHintDoesNotBypassArchitectureClarification,
  testVagueTaskUsesReviewWithoutBlocking,
  testSubjectivePolishUsesReview,
  testModelSubjectiveOpenEndedUsesReview,
  testExactValueOverridesSubjectiveModelGuess,
  testStructuredTargetsAndConstraints,
  testModelMergeKeepsBackendAuthority,
  testModelCannotClearRealMissingValue,
  testMixedLanguageTask,
  testClarificationUnblocksMissingReplacementWithoutChangingTargetSemantics,
  testPathOnlyAmbiguityIsNotBlocking,
  testBalancedModeReviewsSubjectiveTasks,
  testBalancedModeDefensivelyReviewsOpenEndedSemantics,
  testAutomaticModeContinuesReviewTasks,
  testConfirmAllModeReviewsReadyTasks,
  testRequiredClarificationCannotBeBypassed,
  testFallbackSource,
  testModelUnknownCannotEraseGroundedAction,
  testCompactIntentTreeKeepsNamedTarget,
  testCompactIntentPromptDropsHeavyProjectMetadata,
  testCompactIntentGenerationLimits,
  testCompactIntentTreePreservesBackendAndFullstackCoverage,
  testCompactIntentTreeOmitsUnrelatedSecretAndRuntimePaths,
];

for (const test of tests) {
  test();
}

console.log(`task understanding smoke passed: ${tests.length} scenarios`);
