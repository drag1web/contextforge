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
  assertReady(result);
  assert.equal(result.missingInformation.length, 0);
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

function testFallbackSource() {
  const result = fallback("Обнови README и добавь команды запуска.", {
    taskArea: "docs",
    taskType: "docs",
  });
  assert.equal(result.source, "fallback");
  assert.equal(result.action, "create");
  assertReady(result);
}

const tests = [
  testMissingRussianReplacement,
  testRussianQuotedReplacement,
  testEnglishQuotedReplacement,
  testLiteralKinds,
  testTransformationGoalDoesNotRequireLiteral,
  testNoFilePathIsNotMissingContext,
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
  testAutomaticModeContinuesReviewTasks,
  testConfirmAllModeReviewsReadyTasks,
  testRequiredClarificationCannotBeBypassed,
  testFallbackSource,
];

for (const test of tests) {
  test();
}

console.log("task understanding smoke passed: 26 scenarios");
