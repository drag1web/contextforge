import type {
  AcceptanceCriteriaPreset,
  ContextComposerPreview,
  PromptTemplate,
  RuleProfile,
  TaskPackDraft,
  TemplateTaskType
} from "../types";

export type TaskPackQualityStatus = "pass" | "improve" | "warn" | "fail";

export interface TaskPackQualityCheck {
  id: string;
  label: string;
  message: string;
  status: TaskPackQualityStatus;
  points: number;
  maxPoints: number;
}

export interface TaskPackQualityResult {
  score: number;
  maxScore: number;
  label: string;
  summary: string;
  status: TaskPackQualityStatus;
  checks: TaskPackQualityCheck[];
  warnings: string[];
  suggestions: string[];
  stats: {
    taskChars: number;
    taskWords: number;
    enabledRules: number;
    customRules: number;
    criteria: number;
    hasTemplate: boolean;
    hasProfile: boolean;
  };
}

export interface TaskPackQualityInput {
  draft: TaskPackDraft;
  selectedTemplate?: PromptTemplate;
  selectedProfile?: RuleProfile;
  selectedAcceptancePreset?: AcceptanceCriteriaPreset;
  enabledRulesCount: number;
  customRulesCount: number;
  totalCriteriaCount: number;
}

const ACTION_PATTERNS = [
  /\b(add|fix|implement|update|refactor|remove|improve|rewrite|redesign|debug|test|document|verify)\b/i,
  /\b(добав|исправ|сдел|обнов|передел|перепиш|улучш|почин|провер|протест|документ)\w*/i
];

const VERIFICATION_PATTERNS = [
  /\b(test|build|lint|typecheck|verify|check|manual|npm run|pnpm|yarn|pytest|vitest|jest)\b/i,
  /\b(провер|сборк|тест|билд|линт|ручн|команд)\w*/i
];

const SCOPE_PATTERNS = [
  /\b(file|component|page|modal|route|api|endpoint|backend|frontend|renderer|server|template|profile|dropdown)\b/i,
  /\b(файл|компонент|страниц|модал|роут|эндпоинт|бекенд|фронт|шаблон|профил|дропдаун)\w*/i,
  /[\w.-]+\.(tsx|ts|jsx|js|css|scss|md|json|yml|yaml)\b/i
];

const CONSTRAINT_PATTERNS = [
  /\b(do not|don't|avoid|keep|preserve|without changing|no unrelated|only|scope)\b/i,
  /\b(не трог|не меня|без измен|сохран|только|аккурат|не лез|не лом)\w*/i
];

const BROAD_TASK_PATTERNS = [
  /\b(do everything|fix everything|make it better|improve everything|rewrite all|from scratch)\b/i,
  /\b(сделай красиво|сделай лучше|переделай всё|перепиши всё|всё исправь|как-нибудь|что-нибудь|хз)\b/i
];

function hasAnyPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean).length;
}

function makeCheck(
  id: string,
  label: string,
  message: string,
  status: TaskPackQualityStatus,
  points: number,
  maxPoints: number
): TaskPackQualityCheck {
  return {
    id,
    label,
    message,
    status,
    points: Math.max(0, Math.min(points, maxPoints)),
    maxPoints
  };
}

export function evaluateTaskPackQuality({
  draft,
  selectedTemplate,
  selectedProfile,
  selectedAcceptancePreset,
  enabledRulesCount,
  customRulesCount,
  totalCriteriaCount
}: TaskPackQualityInput): TaskPackQualityResult {
  const rawTask = draft.rawTask.trim();
  const taskChars = rawTask.length;
  const taskWords = countWords(rawTask);
  const hasAction = hasAnyPattern(rawTask, ACTION_PATTERNS);
  const hasScope = hasAnyPattern(rawTask, SCOPE_PATTERNS);
  const hasConstraint = hasAnyPattern(rawTask, CONSTRAINT_PATTERNS);
  const hasVerification =
    hasAnyPattern(rawTask, VERIFICATION_PATTERNS) ||
    hasAnyPattern(draft.acceptanceCriteriaText ?? "", VERIFICATION_PATTERNS);
  const looksTooBroad = hasAnyPattern(rawTask, BROAD_TASK_PATTERNS);

  const checks: TaskPackQualityCheck[] = [];

  if (taskChars < 3) {
    checks.push(
      makeCheck(
        "task-clarity",
        "Task clarity",
        "Write the actual task before generating a Task Pack.",
        "fail",
        0,
        25
      )
    );
  } else if (taskChars < 40) {
    checks.push(
      makeCheck(
        "task-clarity",
        "Task clarity",
        "The task is very short. Add the target area, expected change and constraints.",
        "warn",
        8,
        25
      )
    );
  } else if (taskChars < 120 || !hasAction) {
    checks.push(
      makeCheck(
        "task-clarity",
        "Task clarity",
        hasAction
          ? "The task is understandable, but more implementation detail would help the agent."
          : "Add a clear action verb: fix, implement, refactor, redesign, update or test.",
        "improve",
        hasAction ? 17 : 14,
        25
      )
    );
  } else {
    checks.push(
      makeCheck(
        "task-clarity",
        "Task clarity",
        "The task has enough detail for an agent to start safely.",
        "pass",
        25,
        25
      )
    );
  }

  let scopePoints = 0;
  if (hasScope) scopePoints += 9;
  if (hasConstraint) scopePoints += 7;
  if (!looksTooBroad && taskChars >= 40) scopePoints += 4;

  checks.push(
    makeCheck(
      "scope-control",
      "Scope control",
      scopePoints >= 17
        ? "Scope and boundaries are clear."
        : scopePoints >= 9
          ? "Some scope is present, but boundaries could be tighter."
          : "Add the page/file/area and what should not be changed.",
      scopePoints >= 17 ? "pass" : scopePoints >= 9 ? "improve" : "warn",
      scopePoints,
      20
    )
  );

  const recipePoints =
    (draft.targetTool ? 4 : 0) +
    (draft.taskType && draft.taskType !== "general" ? 4 : 2) +
    (selectedTemplate ? 6 : 0) +
    (selectedProfile ? 6 : 0);

  checks.push(
    makeCheck(
      "recipe",
      "Agent recipe",
      recipePoints >= 18
        ? "Agent, task type, prompt template and rule profile are wired."
        : recipePoints >= 12
          ? "Recipe is partially configured. Check template and rule profile."
          : "Choose a preset or open Setup to wire template and rules.",
      recipePoints >= 18 ? "pass" : recipePoints >= 12 ? "improve" : "warn",
      recipePoints,
      20
    )
  );

  const rulesPoints =
    Math.min(enabledRulesCount, 6) * 2 +
    Math.min(customRulesCount, 3) * 2 +
    (selectedProfile ? 3 : 0);

  checks.push(
    makeCheck(
      "constraints",
      "Rules & constraints",
      rulesPoints >= 14
        ? "The Task Pack has enough workflow constraints without being empty."
        : rulesPoints >= 8
          ? "Some rules are enabled. Add task-specific constraints if needed."
          : "Enable a focused rule profile or add custom constraints.",
      rulesPoints >= 14 ? "pass" : rulesPoints >= 8 ? "improve" : "warn",
      rulesPoints,
      18
    )
  );

  const criteriaPoints =
    Math.min(totalCriteriaCount, 5) * 3 +
    (selectedAcceptancePreset ? 3 : 0) +
    (hasVerification ? 4 : 0);

  checks.push(
    makeCheck(
      "verification",
      "Verification",
      criteriaPoints >= 18
        ? "Acceptance criteria and verification signals are strong."
        : criteriaPoints >= 9
          ? "There are checks, but explicit build/test/manual verification would improve the pack."
          : "Add acceptance criteria and how the result should be verified.",
      criteriaPoints >= 18 ? "pass" : criteriaPoints >= 9 ? "improve" : "warn",
      criteriaPoints,
      22
    )
  );

  const safetyPoints = looksTooBroad
    ? 4
    : taskChars >= 40 && (hasConstraint || enabledRulesCount > 0)
      ? 15
      : 10;

  checks.push(
    makeCheck(
      "safety",
      "Safety posture",
      looksTooBroad
        ? "The task sounds broad. Narrow it before giving it to an agent."
        : safetyPoints >= 15
          ? "Safety posture is good for an external coding agent."
          : "Add limits such as files not to touch, behavior to preserve or risky areas.",
      looksTooBroad ? "warn" : safetyPoints >= 15 ? "pass" : "improve",
      safetyPoints,
      15
    )
  );

  const maxScore = checks.reduce((sum, check) => sum + check.maxPoints, 0);
  const rawScore = checks.reduce((sum, check) => sum + check.points, 0);
  const score = Math.round((rawScore / maxScore) * 100);

  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (taskChars < 40) {
    warnings.push("Task text is too short for reliable context selection.");
    suggestions.push("Add the exact page, component, route or backend area that should change.");
  }

  if (!hasScope) {
    suggestions.push("Mention the target file, page, component, API route or feature area.");
  }

  if (!hasConstraint) {
    suggestions.push("Add at least one boundary, for example: keep backend unchanged or avoid unrelated refactors.");
  }

  if (!selectedTemplate) {
    warnings.push("No prompt template is selected.");
  }

  if (!selectedProfile || enabledRulesCount === 0) {
    warnings.push("No focused rule profile is active.");
  }

  if (totalCriteriaCount === 0) {
    warnings.push("No acceptance criteria are attached to the Task Pack.");
    suggestions.push("Add the verification command or final-response checklist the agent must follow.");
  } else if (!hasVerification) {
    suggestions.push("Add explicit verification wording: build, test, lint, manual check or screenshot review.");
  }

  if (looksTooBroad) {
    warnings.push("The task contains broad wording that may make the agent over-edit.");
    suggestions.push("Split broad redesign/refactor work into a smaller task with a clear done state.");
  }

  const status: TaskPackQualityStatus =
    score >= 82 ? "pass" : score >= 62 ? "improve" : score >= 38 ? "warn" : "fail";

  const label =
    status === "pass"
      ? "Strong"
      : status === "improve"
        ? "Good, needs polish"
        : status === "warn"
          ? "Needs detail"
          : "Not ready";

  const summary =
    status === "pass"
      ? "This Task Pack is likely ready for an external coding agent."
      : status === "improve"
        ? "The pack is usable, but a few details would make it safer."
        : status === "warn"
          ? "The pack may work, but the agent could miss scope or verification."
          : "Add a real task and basic setup before generating.";

  return {
    score,
    maxScore: 100,
    label,
    summary,
    status,
    checks,
    warnings: Array.from(new Set(warnings)),
    suggestions: Array.from(new Set(suggestions)).slice(0, 5),
    stats: {
      taskChars,
      taskWords,
      enabledRules: enabledRulesCount,
      customRules: customRulesCount,
      criteria: totalCriteriaCount,
      hasTemplate: Boolean(selectedTemplate),
      hasProfile: Boolean(selectedProfile)
    }
  };
}

export type TaskPackIntentStatus = "empty" | "match" | "review" | "warning";
export type TaskPackIntentSignalTone = "neutral" | "positive" | "warning";
export type TaskPackIntentMismatchSeverity = "review" | "warning";

export interface TaskPackIntentSignal {
  label: string;
  value: string;
  tone: TaskPackIntentSignalTone;
}

export interface TaskPackIntentMismatch {
  id: string;
  severity: TaskPackIntentMismatchSeverity;
  title: string;
  message: string;
  action?: string;
}

export interface TaskPackIntentResult {
  status: TaskPackIntentStatus;
  inferredTaskType: TemplateTaskType | "unknown";
  label: string;
  summary: string;
  confidence: number;
  signals: TaskPackIntentSignal[];
  mismatches: TaskPackIntentMismatch[];
  suggestions: string[];
}

export interface TaskPackIntentInput {
  draft: TaskPackDraft;
  selectedTemplate?: PromptTemplate;
  selectedProfile?: RuleProfile;
  contextIntent?: ContextComposerPreview["taskIntent"] | null;
}

const TASK_TYPE_OPTIONS_FOR_INTENT: TemplateTaskType[] = [
  "general",
  "ui",
  "backend",
  "fullstack",
  "build",
  "bugfix",
  "refactor",
  "docs",
  "tests"
];

function getTaskTypeDisplayName(taskType: TemplateTaskType | "unknown") {
  if (taskType === "ui") return "UI / UX";
  if (taskType === "backend") return "Backend";
  if (taskType === "fullstack") return "Fullstack";
  if (taskType === "build") return "Build";
  if (taskType === "bugfix") return "Bug fix";
  if (taskType === "refactor") return "Refactor";
  if (taskType === "docs") return "Docs";
  if (taskType === "tests") return "Tests";
  if (taskType === "general") return "General";
  return "Unknown";
}

function normalizeTaskType(value?: string | null): TemplateTaskType | "unknown" {
  if (!value) return "unknown";
  return TASK_TYPE_OPTIONS_FOR_INTENT.includes(value as TemplateTaskType)
    ? (value as TemplateTaskType)
    : "unknown";
}

function normalizeIntentConfidence(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  const percent = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function isCompatibleTaskType(selected: TemplateTaskType, inferred: TemplateTaskType | "unknown") {
  if (inferred === "unknown" || selected === inferred) return true;
  if (selected === "general") return false;
  if (selected === "fullstack" && (inferred === "ui" || inferred === "backend")) return true;
  if (inferred === "fullstack" && (selected === "ui" || selected === "backend")) return false;
  if (inferred === "bugfix" && selected !== "docs") return true;
  return false;
}

function hasReliableDynamicIntent(contextIntent?: ContextComposerPreview["taskIntent"] | null) {
  if (!contextIntent) return false;
  const confidence = normalizeIntentConfidence(contextIntent.confidence);

  return contextIntent.source === "ollama" && confidence >= 70;
}

export function analyzeTaskPackIntent({
  draft,
  selectedTemplate,
  selectedProfile,
  contextIntent
}: TaskPackIntentInput): TaskPackIntentResult {
  const rawTask = draft.rawTask.trim();
  const selectedTaskType = normalizeTaskType(draft.taskType) === "unknown"
    ? "general"
    : (normalizeTaskType(draft.taskType) as TemplateTaskType);
  const contextTaskType = normalizeTaskType(contextIntent?.taskArea);
  const dynamicIntentIsReliable = hasReliableDynamicIntent(contextIntent);
  const inferredTaskType: TemplateTaskType | "unknown" = dynamicIntentIsReliable ? contextTaskType : "unknown";
  const confidence = dynamicIntentIsReliable
    ? normalizeIntentConfidence(contextIntent?.confidence)
    : rawTask.length >= 3
      ? selectedTaskType === "general" ? 45 : 58
      : 0;

  if (rawTask.length < 3) {
    return {
      status: "empty",
      inferredTaskType: "unknown",
      label: "No task yet",
      summary: "Write the task first, then ContextForge can compare it with the selected recipe.",
      confidence: 0,
      signals: [
        { label: "Recipe", value: getTaskTypeDisplayName(selectedTaskType), tone: "neutral" },
        { label: "Target", value: draft.targetTool || "None", tone: "neutral" }
      ],
      mismatches: [],
      suggestions: ["Describe the concrete change before generating or analyzing context."]
    };
  }

  const mismatches: TaskPackIntentMismatch[] = [];
  const suggestions: string[] = [];

  if (dynamicIntentIsReliable && inferredTaskType !== "unknown" && !isCompatibleTaskType(selectedTaskType, inferredTaskType)) {
    mismatches.push({
      id: "task-type-mismatch",
      severity: selectedTaskType === "general" ? "review" : "warning",
      title: "Recipe may not match analyzed intent",
      message: `The context analyzer reported ${getTaskTypeDisplayName(inferredTaskType)}, while the selected task type is ${getTaskTypeDisplayName(selectedTaskType)}.`,
      action: `Switch task type to ${getTaskTypeDisplayName(inferredTaskType)} if that matches the intended edit.`
    });
  }

  if (selectedTemplate && !isCompatibleTaskType(selectedTaskType, selectedTemplate.taskType)) {
    mismatches.push({
      id: "template-recipe-mismatch",
      severity: "review",
      title: "Template does not match selected recipe",
      message: `Selected template is ${getTaskTypeDisplayName(selectedTemplate.taskType)}, while the current recipe is ${getTaskTypeDisplayName(selectedTaskType)}.`,
      action: "Open Recipe and choose a template that matches the selected task type."
    });
  }

  if (selectedProfile && !isCompatibleTaskType(selectedTaskType, selectedProfile.taskType)) {
    mismatches.push({
      id: "profile-recipe-mismatch",
      severity: "review",
      title: "Rule profile does not match selected recipe",
      message: `Selected rule profile is ${getTaskTypeDisplayName(selectedProfile.taskType)}, while the current recipe is ${getTaskTypeDisplayName(selectedTaskType)}.`,
      action: "Use a rule profile that matches the selected task type."
    });
  }

  if (dynamicIntentIsReliable && inferredTaskType !== "unknown" && selectedTemplate && !isCompatibleTaskType(selectedTemplate.taskType, inferredTaskType)) {
    mismatches.push({
      id: "template-intent-mismatch",
      severity: "review",
      title: "Template focus differs from analyzed intent",
      message: `The context analyzer reported ${getTaskTypeDisplayName(inferredTaskType)}, but the selected template is ${getTaskTypeDisplayName(selectedTemplate.taskType)}.`,
      action: "Open Recipe and choose a closer prompt template."
    });
  }

  const structuredIntent = contextIntent?.structuredIntent;

  if (dynamicIntentIsReliable && structuredIntent?.needsBackend === false && (selectedTaskType === "backend" || selectedTaskType === "fullstack")) {
    mismatches.push({
      id: "backend-scope-conflict",
      severity: "warning",
      title: "Backend work may be outside the analyzed scope",
      message: "Structured intent says backend changes are not needed, but the selected recipe allows backend work.",
      action: "Use UI / UX or General unless backend changes are truly required."
    });
  }

  if (dynamicIntentIsReliable && structuredIntent?.needsStyles === false && (selectedTaskType === "ui" || selectedTaskType === "fullstack")) {
    mismatches.push({
      id: "ui-scope-conflict",
      severity: "warning",
      title: "UI work may be outside the analyzed scope",
      message: "Structured intent says style/UI changes are not needed, but the selected recipe allows interface work.",
      action: "Use Backend or General unless UI changes are truly required."
    });
  }

  if (contextIntent && !dynamicIntentIsReliable) {
    suggestions.push(
      contextIntent.source === "fallback"
        ? "Context analysis used fallback intent, so semantic mismatch warnings stay conservative."
        : "Run analysis again with a configured provider for stronger semantic intent checks."
    );
  }

  if (!contextIntent) {
    suggestions.push("Analyze context to compare this recipe against dynamic project-aware intent.");
  }

  if (mismatches.length > 0) {
    suggestions.push("Review the Recipe section before generating the Task Pack.");
  }

  if (structuredIntent?.ambiguities?.length) {
    suggestions.push("Resolve analyzer ambiguities before exporting if this task is risky.");
  }

  const status: TaskPackIntentStatus =
    mismatches.some((item) => item.severity === "warning")
      ? "warning"
      : mismatches.length > 0
        ? "review"
        : "match";

  const label =
    status === "warning"
      ? "Intent needs review"
      : status === "review"
        ? "Review recipe fit"
        : dynamicIntentIsReliable && inferredTaskType !== "unknown"
          ? `${getTaskTypeDisplayName(inferredTaskType)} intent`
          : selectedTaskType === "general"
            ? "Recipe-guided intent"
            : `${getTaskTypeDisplayName(selectedTaskType)} recipe`;

  const summary =
    status === "warning"
      ? "Dynamic analyzer output and the selected setup may conflict. Review before exporting."
      : status === "review"
        ? "Recipe metadata needs a quick review before export."
        : dynamicIntentIsReliable && inferredTaskType !== "unknown"
          ? "Analyzed project intent and selected setup look aligned."
          : contextIntent
            ? "Analyzer output is conservative, so ContextForge is not forcing a semantic mismatch."
            : "No dynamic context analysis has run yet; this card is checking selected recipe metadata only.";

  const signals: TaskPackIntentSignal[] = [
    {
      label: dynamicIntentIsReliable ? "Analyzed" : "Mode",
      value: dynamicIntentIsReliable && inferredTaskType !== "unknown"
        ? getTaskTypeDisplayName(inferredTaskType)
        : contextIntent
          ? `${contextIntent.source} review`
          : "Recipe metadata",
      tone: status === "match" ? "positive" : status === "warning" ? "warning" : "neutral"
    },
    {
      label: "Selected",
      value: getTaskTypeDisplayName(selectedTaskType),
      tone: isCompatibleTaskType(selectedTaskType, inferredTaskType) ? "positive" : "warning"
    },
    {
      label: "Confidence",
      value: `${confidence}%`,
      tone: confidence >= 70 ? "positive" : "neutral"
    }
  ];

  return {
    status,
    inferredTaskType,
    label,
    summary,
    confidence,
    signals,
    mismatches: mismatches.slice(0, 4),
    suggestions: Array.from(new Set(suggestions)).slice(0, 4)
  };
}
