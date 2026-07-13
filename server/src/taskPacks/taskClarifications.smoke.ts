import assert from "node:assert/strict";

import type { TaskUnderstanding } from "../ollama/taskUnderstanding.js";
import {
  applyTaskClarificationsToUnderstanding,
  buildClarifiedTaskText,
  buildSelectionTaskText,
  classifyTaskClarificationQuestion,
  normalizeTaskClarifications,
  taskClarificationsSchema,
} from "./taskClarifications.js";

function baseUnderstanding(): TaskUnderstanding {
  return {
    schemaVersion: 1,
    goal: "На странице Settings измени пояснение под заголовком Experimental AI Core.",
    action: "update",
    targetHints: ["Settings", "Experimental AI Core"],
    requestedChanges: ["Измени пояснение"],
    constraints: [],
    interpretationRisk: "objective",
    changeDefinition: "bounded",
    explicitValues: [],
    missingInformation: [
      {
        code: "replacement_value",
        description: "The exact replacement value is missing.",
        required: true,
      },
    ],
    readiness: "needs_clarification",
    canProceed: false,
    clarificationQuestion: "Какой точный новый текст или значение нужно использовать?",
    confidence: 0.8,
    source: "fallback",
    reasons: ["Missing required information: replacement_value."],
  };
}

function testNoClarificationsKeepsOriginalTask() {
  assert.equal(buildClarifiedTaskText("  Fix the login form.  ", []), "Fix the login form.");
  assert.equal(buildSelectionTaskText("  Fix the login form.  ", []), "Fix the login form.");
}

function testClarificationIsAppendedSeparatelyForExport() {
  const result = buildClarifiedTaskText("Change the Settings description.", [
    {
      question: "What exact text should be used?",
      answer: "Shadow validates real project files.",
    },
  ]);

  assert.match(result, /^Change the Settings description\./u);
  assert.match(result, /## User Clarifications/u);
  assert.match(result, /Question: What exact text should be used\?/u);
  assert.match(result, /User answer: Shadow validates real project files\./u);
}

function testReplacementAnswerDoesNotContaminateSelectionInput() {
  const original =
    "На странице Settings измени пояснение под заголовком Experimental AI Core.";
  const result = buildSelectionTaskText(original, [
    {
      question: "Какой точный новый текст или значение нужно использовать?",
      answer: "Shadow сначала понимает задачу, затем выбирает реальные файлы проекта.",
    },
  ]);

  assert.equal(result, original);
  assert.doesNotMatch(result, /User Clarifications|Question:|User answer:/u);
}

function testTargetAnswerRemainsAvailableToSelection() {
  const result = buildSelectionTaskText("Измени пояснение.", [
    {
      question: "Какую конкретно страницу, компонент или функцию нужно изменить?",
      answer: "Settings page, Experimental AI Core section",
    },
  ]);

  assert.match(result, /^Измени пояснение\./u);
  assert.match(result, /Settings page, Experimental AI Core section/u);
  assert.doesNotMatch(result, /Clarification|Question:|User answer:/u);
}

function testReplacementClarificationResolvesUnderstanding() {
  const result = applyTaskClarificationsToUnderstanding(baseUnderstanding(), [
    {
      question: "Какой точный новый текст или значение нужно использовать?",
      answer: "Shadow сначала понимает задачу, затем выбирает реальные файлы проекта.",
    },
  ]);

  assert.equal(result.readiness, "ready");
  assert.equal(result.canProceed, true);
  assert.equal(result.clarificationQuestion, null);
  assert.equal(result.missingInformation.length, 0);
  assert.equal(result.interpretationRisk, "objective");
  assert.equal(result.changeDefinition, "exact");
  assert.equal(
    result.explicitValues[0]?.value,
    "Shadow сначала понимает задачу, затем выбирает реальные файлы проекта.",
  );
  assert.deepEqual(result.targetHints, ["Settings", "Experimental AI Core"]);
  assert.doesNotMatch(result.goal, /User Clarifications|Question:|User answer:/u);
}

function testArchitectureClarificationResolvesUnderstanding() {
  const result = applyTaskClarificationsToUnderstanding(
    {
      ...baseUnderstanding(),
      goal: "Добавь новый способ подключения в приложение.",
      action: "create",
      targetHints: [],
      ambiguities: ["Какой provider и пользовательский flow нужны?"],
      interpretationRisk: "uncertain",
      changeDefinition: "open_ended",
      missingInformation: [
        {
          code: "architecture_decision",
          description: "Какой provider и пользовательский flow нужны?",
          required: true,
        },
      ],
      clarificationQuestion:
        "Уточните ключевое решение перед реализацией: какой provider и пользовательский flow нужны?",
    },
    [
      {
        question:
          "Уточните ключевое решение перед реализацией: какой provider и пользовательский flow нужны?",
        answer: "Использовать device flow существующего GitHub-подключения для входа пользователя.",
      },
    ],
  );

  assert.equal(result.readiness, "ready");
  assert.equal(result.canProceed, true);
  assert.equal(result.interpretationRisk, "objective");
  assert.equal(result.changeDefinition, "bounded");
  assert.equal(result.ambiguities?.length ?? 0, 0);
  assert.equal(
    result.missingInformation.some(
      (item) => item.code === "architecture_decision",
    ),
    false,
  );
}

function testQuestionClassification() {
  assert.equal(
    classifyTaskClarificationQuestion(
      "Какой точный новый текст или значение нужно использовать?",
    ),
    "replacement_value",
  );
  assert.equal(
    classifyTaskClarificationQuestion(
      "Which exact page, component, or feature should be changed?",
    ),
    "target_confirmation",
  );
}

function testDuplicatesAreRemoved() {
  const normalized = normalizeTaskClarifications([
    { question: "What text?", answer: "New text" },
    { question: "  What text? ", answer: "New text" },
  ]);

  assert.equal(normalized.length, 1);
}

function testMultipleClarificationsPreserveOrder() {
  const result = buildClarifiedTaskText("Update the form.", [
    { question: "Which form?", answer: "Login form" },
    { question: "What should change?", answer: "Add loading feedback" },
  ]);

  assert.ok(result.indexOf("Clarification 1") < result.indexOf("Clarification 2"));
}

function testSchemaRejectsEmptyAnswer() {
  const result = taskClarificationsSchema.safeParse([
    { question: "What text?", answer: "" },
  ]);

  assert.equal(result.success, false);
}

const tests = [
  testNoClarificationsKeepsOriginalTask,
  testClarificationIsAppendedSeparatelyForExport,
  testReplacementAnswerDoesNotContaminateSelectionInput,
  testTargetAnswerRemainsAvailableToSelection,
  testReplacementClarificationResolvesUnderstanding,
  testArchitectureClarificationResolvesUnderstanding,
  testQuestionClassification,
  testDuplicatesAreRemoved,
  testMultipleClarificationsPreserveOrder,
  testSchemaRejectsEmptyAnswer,
];

for (const test of tests) {
  test();
}

console.log(`task clarification smoke passed: ${tests.length} scenarios`);
