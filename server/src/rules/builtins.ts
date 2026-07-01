import type {
  AcceptanceCriteriaPreset,
  PromptTemplate,
  RuleItem,
  RuleProfile,
  TargetTool,
  TemplateTaskType
} from "./types.js";

const TARGET_TOOLS: TargetTool[] = ["codex", "cursor", "claude", "generic"];

const TASK_TYPES: TemplateTaskType[] = [
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

const targetToolLabels: Record<TargetTool, string> = {
  codex: "Codex",
  cursor: "Cursor",
  claude: "Claude",
  generic: "Generic coding agent"
};

const targetToolInstructions: Record<TargetTool, string> = {
  codex:
    "Use a concise implementation plan, make focused edits, and keep the final response review-friendly.",
  cursor:
    "Use the selected context as the main working set, keep changes local to the task, and avoid broad rewrites.",
  claude:
    "Reason carefully about constraints, preserve existing behavior, and provide a clear final implementation summary.",
  generic:
    "Act as a careful AI coding agent. Inspect context first, make focused edits, and verify the result."
};

const taskTypeInstructions: Record<TemplateTaskType, string> = {
  general:
    "Handle the task with the smallest practical set of changes. Avoid unrelated restructuring.",
  ui:
    "Focus on UI pages, components, layout, styles, interaction states, copy, and visual consistency.",
  backend:
    "Focus on backend routes, services, validation, persistence, security boundaries, and API behavior.",
  fullstack:
    "Coordinate UI, client API bridge, backend/API, validation, and verification without inventing contracts.",
  build:
    "Focus on build configuration, imports, scripts, TypeScript/framework config, and reproducible verification.",
  bugfix:
    "Find the likely cause first, then apply a minimal targeted fix. Avoid unrelated refactors.",
  refactor:
    "Improve structure and maintainability without changing external behavior or public contracts.",
  docs:
    "Update documentation from real project files, scripts, config, and current behavior only.",
  tests:
    "Use existing test conventions where possible. Prefer verification that matches current project tooling."
};

function createTemplateContent(targetTool: TargetTool, taskType: TemplateTaskType) {
  return `
# AI Task Pack

## Target Tool

{{targetToolLabel}}

## Task Type

{{taskType}}

## Task

{{rawTask}}

## Project Context

- Project: {{projectName}}
- Package manager: {{packageManager}}
- Detected stack: {{detectedStack}}
- Readiness score: {{readinessScore}}

Project metadata:

\`\`\`json
{{projectMetadataJson}}
\`\`\`

## Agent Instructions

${targetToolInstructions[targetTool]}

${taskTypeInstructions[taskType]}

Before editing:

- Inspect the relevant file candidates and snippets provided by ContextForge.
- Treat inspect-only files as reference context.
- Treat asset-reference files as binary/reference context unless the task explicitly requires asset changes.
- Use only real files from the project.
- Keep the implementation focused on the user's actual task.

## Constraints

{{rules}}

## Known AI-Readiness Issues

{{readinessIssues}}

## Acceptance Criteria

{{acceptanceCriteria}}

## Verification

{{verification}}

## Expected Final Response

Return a concise final response with:

- Files changed
- What was changed
- Verification performed
- Any risks, limitations, or manual checks still needed
`.trim();
}

export const BUILT_IN_TEMPLATES: PromptTemplate[] = TARGET_TOOLS.flatMap((targetTool) =>
  TASK_TYPES.map((taskType) => ({
    id: `template.${targetTool}.${taskType}`,
    name: `${targetToolLabels[targetTool]} · ${taskType}`,
    description: `Built-in ${taskType} template for ${targetToolLabels[targetTool]}.`,
    targetTool,
    taskType,
    content: createTemplateContent(targetTool, taskType),
    isBuiltin: true
  }))
);

export const BUILT_IN_RULE_ITEMS: RuleItem[] = [
  {
    id: "rule.general.no-invented-files",
    title: "Do not invent project files",
    description: "Use only real files, folders, scripts, APIs, and dependencies.",
    category: "general",
    content:
      "Do not invent files, folders, APIs, scripts, dependencies, environment variables, or implementation details that are not present in the provided context.",
    isBuiltin: true
  },
  {
    id: "rule.general.inspect-first",
    title: "Inspect before editing",
    description: "Selected files must be inspected before making changes.",
    category: "general",
    content:
      "Inspect the selected files and snippets before editing. If snippets are partial or truncated, inspect the full file first.",
    isBuiltin: true
  },
  {
    id: "rule.general.focused-scope",
    title: "Focused review scope",
    description: "Avoid unrelated changes.",
    category: "general",
    content:
      "Keep changes focused and reviewable. Do not perform unrelated rewrites, formatting sweeps, dependency changes, or architecture changes.",
    isBuiltin: true
  },
  {
    id: "rule.general.protect-inspect-only",
    title: "Respect inspect-only files",
    description: "Inspect-only files are reference context.",
    category: "general",
    content:
      "Files marked as inspect-only are reference context. Do not edit them unless the user explicitly changes the task scope.",
    isBuiltin: true
  },
  {
    id: "rule.assets.reference-only",
    title: "Asset reference safety",
    description: "Binary and asset files should not be edited blindly.",
    category: "assets",
    content:
      "Files marked as asset-reference or non-text context should be treated as binary/reference context unless the task explicitly requests asset replacement or asset editing.",
    isBuiltin: true
  },
  {
    id: "rule.ui.no-backend-api-change",
    title: "No backend/API behavior changes",
    description: "For safe UI work, backend/API contracts must remain stable.",
    category: "ui",
    content:
      "Do not change backend/API behavior, request/response contracts, persistence, auth/session logic, or server validation for UI-only tasks.",
    isBuiltin: true
  },
  {
    id: "rule.ui.preserve-data-flow",
    title: "Preserve UI data flow",
    description: "Keep existing app logic intact unless requested.",
    category: "ui",
    content:
      "Preserve existing UI data flow, state behavior, routing, and business logic unless the task explicitly requests a behavior change.",
    isBuiltin: true
  },
  {
    id: "rule.ui.visual-consistency",
    title: "Visual consistency",
    description: "UI changes should fit the existing design system.",
    category: "ui",
    content:
      "Keep UI changes consistent with the existing component style, spacing, typography, interaction states, and page transitions.",
    isBuiltin: true
  },
  {
    id: "rule.backend.compatible-contracts",
    title: "Backwards-compatible API contracts",
    description: "Avoid breaking clients unless requested.",
    category: "backend",
    content:
      "Keep API contracts backwards compatible unless the task explicitly requests a breaking change. Update client types/bridges only when required.",
    isBuiltin: true
  },
  {
    id: "rule.backend.validate-inputs",
    title: "Validate inputs",
    description: "Backend changes need input validation and safe errors.",
    category: "backend",
    content:
      "Validate inputs, handle errors safely, and return consistent response shapes for backend/API changes.",
    isBuiltin: true
  },
  {
    id: "rule.backend.do-not-weaken-security",
    title: "Do not weaken security",
    description: "Auth/session/security behavior must not be weakened.",
    category: "backend",
    content:
      "Do not remove or weaken auth, session handling, validation, rate limits, permission checks, or other safety guards without explicit instruction.",
    isBuiltin: true
  },
  {
    id: "rule.bugfix.minimal-change",
    title: "Minimal bugfix",
    description: "Fix the bug without unrelated refactors.",
    category: "bugfix",
    content:
      "Apply the smallest targeted fix that addresses the bug. Avoid unrelated refactors, redesigns, or behavior changes.",
    isBuiltin: true
  },
  {
    id: "rule.bugfix.verify-regression",
    title: "Verify the regression",
    description: "Bugfix should include clear verification.",
    category: "bugfix",
    content:
      "Include verification steps that prove the broken behavior is fixed and nearby behavior still works.",
    isBuiltin: true
  },
  {
    id: "rule.refactor.no-behavior-change",
    title: "No behavior change",
    description: "Refactor must preserve external behavior.",
    category: "refactor",
    content:
      "Preserve external behavior, public APIs, routes, UI text, data shapes, and config semantics unless explicitly requested.",
    isBuiltin: true
  },
  {
    id: "rule.refactor.small-steps",
    title: "Small refactor steps",
    description: "Keep refactors understandable.",
    category: "refactor",
    content:
      "Keep refactor changes small, incremental, and easy to review. Do not mix refactor work with feature changes.",
    isBuiltin: true
  },
  {
    id: "rule.docs.real-commands-only",
    title: "Real commands only",
    description: "Docs must reflect actual scripts/config.",
    category: "docs",
    content:
      "Documentation must reflect real scripts, config files, setup requirements, and current behavior. Do not invent commands.",
    isBuiltin: true
  },
  {
    id: "rule.tests.existing-framework",
    title: "Use existing test setup",
    description: "Do not add new test dependencies casually.",
    category: "tests",
    content:
      "Use the existing test framework and project conventions if present. Do not introduce new test dependencies unless explicitly requested.",
    isBuiltin: true
  },
  {
    id: "rule.verification.no-fake-tests",
    title: "No fake verification",
    description: "Do not claim verification that was not done.",
    category: "verification",
    content:
      "Do not claim tests, builds, or checks were run unless they were actually run. If verification was not run, state what should be checked.",
    isBuiltin: true
  }
];

export const BUILT_IN_ACCEPTANCE_CRITERIA_PRESETS: AcceptanceCriteriaPreset[] = [
  {
    id: "criteria.general-done",
    name: "General done",
    description: "Generic completion criteria.",
    taskType: "general",
    criteria: [
      "The requested task is implemented using real project files only.",
      "Changes are focused and do not introduce unrelated behavior.",
      "The final response explains what changed and how to verify it."
    ],
    isBuiltin: true
  },
  {
    id: "criteria.ui-polish",
    name: "UI polish",
    description: "Criteria for safe UI improvements.",
    taskType: "ui",
    criteria: [
      "The UI change matches the existing visual system and interaction style.",
      "Backend/API behavior and contracts are unchanged.",
      "Relevant responsive, loading, empty, and error states are preserved or improved."
    ],
    isBuiltin: true
  },
  {
    id: "criteria.backend-api-safe",
    name: "Backend API safe",
    description: "Criteria for backend/API work.",
    taskType: "backend",
    criteria: [
      "Inputs are validated and errors are handled safely.",
      "Existing API response shapes remain compatible unless explicitly changed.",
      "Security-sensitive behavior is not weakened."
    ],
    isBuiltin: true
  },
  {
    id: "criteria.bug-fixed",
    name: "Bug fixed",
    description: "Criteria for bugfix work.",
    taskType: "bugfix",
    criteria: [
      "The root cause or likely cause is addressed.",
      "The fix is minimal and does not add unrelated changes.",
      "Verification covers the broken case and nearby behavior."
    ],
    isBuiltin: true
  },
  {
    id: "criteria.refactor-preserved",
    name: "Refactor preserved behavior",
    description: "Criteria for behavior-preserving refactors.",
    taskType: "refactor",
    criteria: [
      "External behavior is preserved.",
      "Public APIs, routes, data shapes, and UI copy are unchanged unless requested.",
      "The refactor improves readability, structure, or maintainability."
    ],
    isBuiltin: true
  },
  {
    id: "criteria.docs-accurate",
    name: "Docs accurate",
    description: "Criteria for documentation updates.",
    taskType: "docs",
    criteria: [
      "Documentation reflects actual files, scripts, config, and behavior.",
      "No invented commands, features, environment variables, or setup steps are added.",
      "The updated docs are clear for a developer using the project."
    ],
    isBuiltin: true
  },
  {
    id: "criteria.tests-verified",
    name: "Tests verified",
    description: "Criteria for tests and verification tasks.",
    taskType: "tests",
    criteria: [
      "Tests or verification steps match the existing project tooling.",
      "No unnecessary test dependencies are introduced.",
      "The final response states what was tested or what should be tested manually."
    ],
    isBuiltin: true
  }
];

export const BUILT_IN_RULE_PROFILES: RuleProfile[] = [
  {
    id: "profile.safe-general",
    name: "Safe general task",
    description: "Default safe profile for broad tasks.",
    taskType: "general",
    enabledRuleIds: [
      "rule.general.no-invented-files",
      "rule.general.inspect-first",
      "rule.general.focused-scope",
      "rule.general.protect-inspect-only",
      "rule.assets.reference-only",
      "rule.verification.no-fake-tests"
    ],
    customRules: [],
    acceptanceCriteriaPresetId: "criteria.general-done",
    isBuiltin: true
  },
  {
    id: "profile.safe-ui-task",
    name: "Safe UI task",
    description: "UI-focused changes without backend/API mutation.",
    taskType: "ui",
    enabledRuleIds: [
      "rule.general.no-invented-files",
      "rule.general.inspect-first",
      "rule.general.focused-scope",
      "rule.general.protect-inspect-only",
      "rule.assets.reference-only",
      "rule.ui.no-backend-api-change",
      "rule.ui.preserve-data-flow",
      "rule.ui.visual-consistency",
      "rule.verification.no-fake-tests"
    ],
    customRules: [],
    acceptanceCriteriaPresetId: "criteria.ui-polish",
    isBuiltin: true
  },
  {
    id: "profile.backend-safe-change",
    name: "Backend safe change",
    description: "Safe backend/API changes with validation and compatibility.",
    taskType: "backend",
    enabledRuleIds: [
      "rule.general.no-invented-files",
      "rule.general.inspect-first",
      "rule.general.focused-scope",
      "rule.backend.compatible-contracts",
      "rule.backend.validate-inputs",
      "rule.backend.do-not-weaken-security",
      "rule.verification.no-fake-tests"
    ],
    customRules: [],
    acceptanceCriteriaPresetId: "criteria.backend-api-safe",
    isBuiltin: true
  },
  {
    id: "profile.bugfix-minimal-change",
    name: "Bugfix minimal change",
    description: "Small targeted fixes without unrelated refactors.",
    taskType: "bugfix",
    enabledRuleIds: [
      "rule.general.no-invented-files",
      "rule.general.inspect-first",
      "rule.general.focused-scope",
      "rule.bugfix.minimal-change",
      "rule.bugfix.verify-regression",
      "rule.verification.no-fake-tests"
    ],
    customRules: [],
    acceptanceCriteriaPresetId: "criteria.bug-fixed",
    isBuiltin: true
  },
  {
    id: "profile.refactor-no-behavior-change",
    name: "Refactor no behavior change",
    description: "Refactor while preserving external behavior.",
    taskType: "refactor",
    enabledRuleIds: [
      "rule.general.no-invented-files",
      "rule.general.inspect-first",
      "rule.general.focused-scope",
      "rule.refactor.no-behavior-change",
      "rule.refactor.small-steps",
      "rule.verification.no-fake-tests"
    ],
    customRules: [],
    acceptanceCriteriaPresetId: "criteria.refactor-preserved",
    isBuiltin: true
  },
  {
    id: "profile.docs-update",
    name: "Docs update",
    description: "Documentation updates grounded in real project files.",
    taskType: "docs",
    enabledRuleIds: [
      "rule.general.no-invented-files",
      "rule.general.inspect-first",
      "rule.docs.real-commands-only",
      "rule.verification.no-fake-tests"
    ],
    customRules: [],
    acceptanceCriteriaPresetId: "criteria.docs-accurate",
    isBuiltin: true
  },
  {
    id: "profile.tests-verification",
    name: "Tests/verification",
    description: "Testing and verification using existing project tooling.",
    taskType: "tests",
    enabledRuleIds: [
      "rule.general.no-invented-files",
      "rule.general.inspect-first",
      "rule.tests.existing-framework",
      "rule.verification.no-fake-tests"
    ],
    customRules: [],
    acceptanceCriteriaPresetId: "criteria.tests-verified",
    isBuiltin: true
  }
];