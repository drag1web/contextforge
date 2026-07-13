import { z } from "zod";

import type { TaskUnderstanding } from "../ollama/taskUnderstanding.js";
import { classifyTaskValue } from "../ollama/taskValueGrounding.js";

export const taskClarificationSchema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(2000),
});

export const taskClarificationsSchema = z
  .array(taskClarificationSchema)
  .max(8)
  .default([]);

export type TaskClarification = z.infer<typeof taskClarificationSchema>;

export type TaskClarificationKind =
  | "replacement_value"
  | "target_confirmation"
  | "architecture_decision"
  | "constraint"
  | "general";

const REPLACEMENT_QUESTION_PATTERN =
  /(?:exact\s+(?:new\s+)?(?:text|value|copy|label|title|description|message)|what\s+(?:text|value|copy|label|title|description|message)|какой\s+точн[\p{L}\p{N}_-]*\s+(?:нов[\p{L}\p{N}_-]*\s+)?(?:текст|значен[\p{L}\p{N}_-]*|формулиров[\p{L}\p{N}_-]*|надпис[\p{L}\p{N}_-]*|описан[\p{L}\p{N}_-]*))/iu;
const TARGET_QUESTION_PATTERN =
  /(?:which\s+(?:exact\s+)?(?:page|screen|component|feature|file|route|section|target)|what\s+(?:page|screen|component|feature|file|route|section)|какую?\s+(?:конкретн[\p{L}\p{N}_-]*\s+)?(?:страниц[\p{L}\p{N}_-]*|экран[\p{L}\p{N}_-]*|компонент[\p{L}\p{N}_-]*|функц[\p{L}\p{N}_-]*|файл[\p{L}\p{N}_-]*|маршрут[\p{L}\p{N}_-]*|секци[\p{L}\p{N}_-]*|цель[\p{L}\p{N}_-]*))/iu;
const CONSTRAINT_QUESTION_PATTERN =
  /(?:what\s+(?:must|should)\s+not\s+change|which\s+(?:files?|areas?|parts?)\s+(?:must|should)\s+remain|что\s+не\s+(?:менять|трогать)|какие?\s+(?:файлы|области|части)\s+не\s+(?:менять|трогать))/iu;
const ARCHITECTURE_QUESTION_PATTERN =
  /(?:key\s+(?:implementation\s+)?decision|exact\s+(?:behavior|flow|approach)|which\s+parts?\s+of\s+the\s+system|вариант\s+(?:поведения|реализации)|пользовательск\w*\s+flow|какие\s+части\s+системы|ключев\w*\s+решен)/iu;

function normalizeLine(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueByNormalized(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeLine(value);
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function classifyTaskClarificationQuestion(
  question: string,
): TaskClarificationKind {
  const value = question.trim();

  if (REPLACEMENT_QUESTION_PATTERN.test(value)) return "replacement_value";
  if (TARGET_QUESTION_PATTERN.test(value)) return "target_confirmation";
  if (ARCHITECTURE_QUESTION_PATTERN.test(value)) return "architecture_decision";
  if (CONSTRAINT_QUESTION_PATTERN.test(value)) return "constraint";

  return "general";
}

export function normalizeTaskClarifications(
  clarifications: readonly TaskClarification[] | undefined,
) {
  const seen = new Set<string>();
  const normalized: TaskClarification[] = [];

  for (const clarification of clarifications ?? []) {
    const question = clarification.question.trim().replace(/\s+/g, " ");
    const answer = clarification.answer.trim().replace(/\r\n/g, "\n");
    const key = `${question.toLowerCase()}\u0000${answer.toLowerCase()}`;

    if (!question || !answer || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({ question, answer });

    if (normalized.length >= 8) {
      break;
    }
  }

  return normalized;
}

/**
 * Human-readable representation for the final Task Pack prompt and export.
 * This Markdown must never be reused as selector-ranking input.
 */
export function buildClarifiedTaskText(
  rawTask: string,
  clarifications: readonly TaskClarification[] | undefined,
) {
  const originalTask = rawTask.trim();
  const normalized = normalizeTaskClarifications(clarifications);

  if (normalized.length === 0) {
    return originalTask;
  }

  const clarificationBlock = normalized
    .map(
      (clarification, index) =>
        [
          `### Clarification ${index + 1}`,
          "",
          `Question: ${clarification.question}`,
          "",
          `User answer: ${clarification.answer}`,
          "",
          `User-provided clarification value (JSON): ${JSON.stringify(clarification.answer)}`,
        ].join("\n"),
    )
    .join("\n\n");

  return [
    originalTask,
    "",
    "## User Clarifications",
    "",
    clarificationBlock,
  ].join("\n");
}

/**
 * Clean semantic input for intent analysis and file selection.
 * Replacement answers describe desired content rather than implementation
 * targets, so they are omitted from selector text. Target and scope answers
 * remain available without service-specific labels or Markdown headings.
 */
export function buildSelectionTaskText(
  rawTask: string,
  clarifications: readonly TaskClarification[] | undefined,
) {
  const originalTask = rawTask.trim();
  const selectionAnswers = normalizeTaskClarifications(clarifications)
    .filter(
      (clarification) =>
        classifyTaskClarificationQuestion(clarification.question) !==
        "replacement_value",
    )
    .map((clarification) => clarification.answer.trim())
    .filter(Boolean);

  if (selectionAnswers.length === 0) {
    return originalTask;
  }

  return [originalTask, ...selectionAnswers].join("\n\n");
}

/**
 * Applies user answers to the backend-owned Task Understanding contract without
 * re-running selector semantics over presentation Markdown.
 */
export function applyTaskClarificationsToUnderstanding(
  understanding: TaskUnderstanding,
  clarifications: readonly TaskClarification[] | undefined,
): TaskUnderstanding {
  const normalized = normalizeTaskClarifications(clarifications);

  if (normalized.length === 0) {
    return understanding;
  }

  const targetHints = [...understanding.targetHints];
  const requestedChanges = [...understanding.requestedChanges];
  const constraints = [...understanding.constraints];
  const explicitValues = [...understanding.explicitValues];
  let missingInformation = [...understanding.missingInformation];
  let ambiguities = [...(understanding.ambiguities ?? [])];
  let interpretationRisk = understanding.interpretationRisk;
  let changeDefinition = understanding.changeDefinition;
  let resolvedCount = 0;

  for (const clarification of normalized) {
    const kind = classifyTaskClarificationQuestion(clarification.question);
    const answer = clarification.answer.trim();

    if (!answer) continue;

    if (kind === "replacement_value") {
      if (!explicitValues.some((item) => item.value === answer)) {
        explicitValues.push({
          kind: classifyTaskValue(answer),
          value: answer,
          exact: true,
          source: "user",
        });
      }

      interpretationRisk = "objective";
      changeDefinition = "exact";

      const before = missingInformation.length;
      missingInformation = missingInformation.filter(
        (item) => item.code !== "replacement_value",
      );
      if (missingInformation.length !== before) resolvedCount += 1;
      continue;
    }

    if (kind === "target_confirmation") {
      targetHints.push(answer);

      const before = missingInformation.length;
      missingInformation = missingInformation.filter(
        (item) => item.code !== "target_confirmation",
      );
      if (missingInformation.length !== before) resolvedCount += 1;
      continue;
    }


    if (kind === "architecture_decision") {
      requestedChanges.push(answer);
      const before = missingInformation.length;
      missingInformation = missingInformation.filter(
        (item) => item.code !== "architecture_decision",
      );
      ambiguities = [];
      interpretationRisk = "objective";
      changeDefinition = "bounded";
      if (missingInformation.length !== before) resolvedCount += 1;
      continue;
    }

    if (kind === "constraint") {
      constraints.push(answer);
      continue;
    }

    requestedChanges.push(answer);
    if (missingInformation.some((item) => item.code === "architecture_decision")) {
      missingInformation = missingInformation.filter(
        (item) => item.code !== "architecture_decision",
      );
      ambiguities = [];
      interpretationRisk = "objective";
      changeDefinition = "bounded";
      resolvedCount += 1;
    }
  }

  const hasRequiredMissing = missingInformation.some((item) => item.required);
  const readiness = hasRequiredMissing
    ? "needs_clarification"
    : understanding.readiness === "needs_clarification"
      ? "ready"
      : understanding.readiness;

  return {
    ...understanding,
    targetHints: uniqueByNormalized(targetHints).slice(0, 12),
    requestedChanges: uniqueByNormalized(requestedChanges).slice(0, 12),
    constraints: uniqueByNormalized(constraints).slice(0, 12),
    ambiguities: uniqueByNormalized(ambiguities).slice(0, 8),
    interpretationRisk,
    changeDefinition,
    explicitValues: explicitValues.slice(0, 12),
    missingInformation,
    readiness,
    canProceed: readiness !== "needs_clarification",
    clarificationQuestion:
      readiness === "needs_clarification"
        ? understanding.clarificationQuestion
        : null,
    confidence:
      readiness === "ready"
        ? Math.max(understanding.confidence, 0.8)
        : understanding.confidence,
    source: "merged",
    reasons: uniqueByNormalized([
      ...understanding.reasons,
      `Applied ${normalized.length} user clarification(s) without adding presentation metadata to selector input.`,
      resolvedCount > 0
        ? `Resolved ${resolvedCount} required clarification field(s).`
        : "Clarifications added supporting task detail.",
    ]).slice(0, 12),
  };
}
