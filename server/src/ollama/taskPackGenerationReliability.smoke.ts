import assert from "node:assert/strict";

import type { AiGenerateResult } from "../ai/providerService.js";
import type { AppSettings } from "../settings/settingsService.js";
import { buildContextForgeNotesSection } from "../routes/taskPacks.js";
import {
  applyTaskPackRefinement,
  buildTaskPackRefinementPrompt,
  detectTaskPackAmbiguities,
  enforceTaskPackRefinementPolicy,
  extractExplicitReplacementValue,
  generateReliableTaskPack,
  parseTaskPackRefinement,
  validateFinalTaskPack,
  type TaskPackGenerationPromptInput,
} from "./taskPackGenerationReliability.js";

const TEMPLATE = `# AI Task Pack

## Target Tool

Codex

## Task Type

general

## Task

Improve settings loading.

## Project Context

Project: contextforge

## Relevant File Candidates

- SettingsPage.tsx

## Agent Instructions

Use focused edits.

## Constraints

- Do not invent files.

## Known AI-Readiness Issues

- No test script detected.

## Acceptance Criteria

- The requested behavior works.

## ContextForge Rules & Criteria

- Preserve validated rules.

## Verification

- Run npm run build.

## ContextForge Assisted Notes

- Context selected by Shadow.

## Expected Final Response

- Summarize changed files.
`;

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ollamaUrl: "http://localhost:11434",
    generationMode: "ollama",
    aiProvider: "ollama",
    defaultTargetTool: "codex",
    defaultTaskType: "general",
    defaultOllamaModel: "test-model",
    openAiCompatibleBaseUrl: "http://localhost:1234/v1",
    openAiCompatibleModel: null,
    openAiCompatibleApiKeyConfigured: false,
    geminiBaseUrl: "https://example.invalid",
    geminiModel: null,
    geminiApiKeyConfigured: false,
    anthropicBaseUrl: "https://example.invalid",
    anthropicModel: null,
    anthropicApiKeyConfigured: false,
    language: "en",
    theme: "dark",
    composerFileLimits: {
      default: 8,
      ui: 7,
      backend: 8,
      fullstack: 10,
      build: 7,
      bugfix: 7,
      refactor: 8,
      docs: 6,
      tests: 7,
    },
    contextQualityMode: "balanced",
    selectorPipelineMode: "shadow_primary",
    taskUnderstandingInteractionMode: "balanced",
    sidebarShowDescriptions: false,
    onboardingEnabled: true,
    onboardingShowEveryLaunch: false,
    onboardingCompleted: true,
    ...overrides,
  };
}

function promptInput(
  overrides: Partial<TaskPackGenerationPromptInput> = {},
): TaskPackGenerationPromptInput {
  return {
    project: {
      name: "contextforge",
      packageManager: "npm",
      detectedStack: ["React", "TypeScript", "Express"],
      readinessScore: 90,
      scripts: { build: "tsc", dev: "vite" },
    },
    rawTask: "Improve settings loading without changing unrelated behavior.",
    taskType: "ui",
    targetTool: "codex",
    effectiveTaskArea: "ui",
    relevantFiles: [
      {
        path: "apps/desktop/renderer/src/pages/SettingsPage.tsx",
        usage: "inspect-and-edit",
        reason: "Primary settings page.",
      },
    ],
    taskIntent: {
      source: "ollama",
      taskArea: "ui",
      riskLevel: "medium",
      confidence: 0.88,
      structuredIntent: {
        primaryTargets: [
          {
            kind: "page",
            path: "apps/desktop/renderer/src/pages/SettingsPage.tsx",
          },
        ],
        allowedEditScope: "ui-only",
      },
    },
    selectionQuality: {
      status: "ready",
      score: 94,
      requiredManualReview: false,
      warnings: [],
      blockingReasons: [],
    },
    executionContract: {
      schemaVersion: 1,
      mode: "implementation",
      requiredLayers: ["ui"],
      confirmedTargets: [
        "apps/desktop/renderer/src/pages/SettingsPage.tsx",
      ],
      targetEvidence: [],
      proposedTargets: [],
      unresolvedDecisions: [],
      implementationGateReasons: [],
      forbiddenAssumptions: [],
      allowImplementationGuidance: true,
      requiresLayerCoverage: false,
      reasons: ["Exact UI target is confirmed."],
    },
    templatePrompt: TEMPLATE,
    ...overrides,
  };
}

const VALID_REFINEMENT = {
  implementationGuidance: [
    "Inspect SettingsPage.tsx and keep the loading change local to the existing settings flow.",
  ],
  constraints: ["Do not edit inspect-only files."],
  acceptanceCriteria: [
    "Loading and error states are visible without changing unrelated settings behavior.",
  ],
  verificationSteps: ["Run npm run build."],
  finalResponseRequirements: ["List changed files and verification performed."],
};

function aiResult(content: string): AiGenerateResult {
  return {
    content,
    provider: "ollama",
    model: "test-model",
  };
}

async function run() {
  let scenarios = 0;

  {
    const parsed = parseTaskPackRefinement(JSON.stringify(VALID_REFINEMENT));
    assert.ok(parsed.refinement);
    assert.equal(parsed.parseStage, "direct-json");
    scenarios += 1;
  }

  {
    const parsed = parseTaskPackRefinement(
      `Sure:\n\n\`\`\`json\n${JSON.stringify(VALID_REFINEMENT)}\n\`\`\``,
    );
    assert.ok(parsed.refinement);
    assert.equal(parsed.parseStage, "fenced-json");
    scenarios += 1;
  }

  {
    const parsed = parseTaskPackRefinement(
      JSON.stringify({
        implementation_plan:
          "Inspect the real settings page; keep the edit focused.",
        safeguards: "Do not invent files.",
        acceptance_criteria: "The loading state is visible.",
        verification: "Run npm run build.",
        final_response: "Report changed files.",
      }),
    );
    assert.ok(parsed.refinement);
    assert.equal(parsed.parseStage, "local-repair");
    scenarios += 1;
  }

  {
    const parsed = parseTaskPackRefinement(
      JSON.stringify({
        implementationGuidance: ["Inspect the real owner."],
        constraints: [],
        acceptanceCriteria: ["The owner is grounded."],
        verificationSteps: ["Run the relevant smoke test."],
        finalResponseRequirements: {
          requirements: "List changed files and report verification results.",
        },
      }),
    );
    assert.ok(parsed.refinement);
    assert.equal(parsed.parseStage, "local-repair");
    assert.deepEqual(parsed.refinement.finalResponseRequirements, [
      "List changed files and report verification results.",
    ]);
    scenarios += 1;
  }

  {
    const parsed = parseTaskPackRefinement(
      '{"implementationGuidance":["unfinished]',
    );
    assert.equal(parsed.refinement, null);
    assert.ok(parsed.issueCodes.includes("truncated_response"));
    scenarios += 1;
  }

  {
    const merged = applyTaskPackRefinement(TEMPLATE, VALID_REFINEMENT);
    assert.ok(
      merged.content.includes("### AI-refined implementation guidance"),
    );
    assert.ok(merged.content.includes("### Task-specific acceptance checks"));
    assert.ok(merged.content.includes("Preserve validated rules."));
    assert.ok(merged.refinementItems >= 4);
    scenarios += 1;
  }

  {
    const changedTask = TEMPLATE.replace(
      "Improve settings loading.",
      "Invent a different task.",
    );
    const validation = validateFinalTaskPack(changedTask, TEMPLATE);
    assert.equal(validation.ok, false);
    assert.ok(validation.issueCodes.includes("protected_section_changed:Task"));
    scenarios += 1;
  }

  {
    const missingSection = TEMPLATE.replace(
      /## Verification[\s\S]*?(?=## ContextForge Assisted Notes)/,
      "",
    );
    const validation = validateFinalTaskPack(missingSection, TEMPLATE);
    assert.equal(validation.ok, false);
    assert.ok(validation.issueCodes.includes("missing_section:Verification"));
    scenarios += 1;
  }

  {
    const built = buildTaskPackRefinementPrompt(promptInput());
    assert.ok(built.prompt.length < 24_000);
    assert.equal(built.diagnostics.compacted, false);
    assert.ok(!built.prompt.includes("C:\\Users\\"));
    assert.ok(!built.prompt.includes("Code Context Snippets"));
    scenarios += 1;
  }

  {
    const hugeTemplate = TEMPLATE.replace(
      "Use focused edits.",
      "Use focused edits.\n" + "Long existing instruction. ".repeat(4_000),
    )
      .replace(
        "- Do not invent files.",
        "- Do not invent files.\n" + "Long constraint. ".repeat(4_000),
      )
      .replace(
        "- The requested behavior works.",
        "- The requested behavior works.\n" +
          "Long acceptance check. ".repeat(4_000),
      )
      .replace(
        "- Run npm run build.",
        "- Run npm run build.\n" + "Long verification step. ".repeat(4_000),
      )
      .replace(
        "- Summarize changed files.",
        "- Summarize changed files.\n" +
          "Long response requirement. ".repeat(4_000),
      );
    const largeFiles = Array.from({ length: 16 }, (_, index) => ({
      path: `src/feature-${index}/implementation.ts`,
      usage: index === 0 ? "inspect-and-edit" : "inspect-only",
      reason: "Grounded supporting context. ".repeat(40),
    }));
    const built = buildTaskPackRefinementPrompt(
      promptInput({
        templatePrompt: hugeTemplate,
        rawTask: "Detailed task requirement. ".repeat(900),
        relevantFiles: largeFiles,
      }),
    );
    assert.ok(built.prompt.length <= 24_000);
    assert.equal(built.diagnostics.compacted, true);
    assert.ok(built.diagnostics.truncatedFields.length > 0);
    scenarios += 1;
  }

  {
    const pathological = "x".repeat(100_000);
    const built = buildTaskPackRefinementPrompt(
      promptInput({
        project: {
          name: pathological,
          packageManager: pathological,
          detectedStack: Array.from({ length: 20 }, () => pathological),
          readinessScore: 90,
          scripts: { build: pathological, test: pathological },
        },
        rawTask: pathological,
        taskType: pathological,
        targetTool: pathological,
        effectiveTaskArea: pathological,
        relevantFiles: Array.from({ length: 20 }, () => ({
          path: pathological,
          usage: pathological,
          reason: pathological,
        })),
        selectionQuality: {
          status: pathological,
          score: 90,
          requiredManualReview: false,
          warnings: [pathological, pathological],
          blockingReasons: [pathological, pathological],
        },
      }),
    );
    assert.ok(built.prompt.length <= 24_000);
    assert.equal(built.diagnostics.compacted, true);
    assert.ok(
      built.diagnostics.truncatedFields.includes("emergencyPromptPayload"),
    );
    scenarios += 1;
  }

  {
    const result = await generateReliableTaskPack({
      ...promptInput(),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings({ generationMode: "template" }),
        generate: async () => {
          throw new Error("should not run");
        },
      },
    });
    assert.equal(result.mode, "template");
    assert.equal(result.usedFallback, false);
    assert.equal(result.diagnostics.status, "template");
    assert.equal(result.diagnostics.attempts.length, 0);
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        implementationGuidance: [
          ...VALID_REFINEMENT.implementationGuidance,
          "Commit the change with a clear message.",
        ],
      },
      promptInput(),
    );
    assert.ok(
      !policy.refinement.implementationGuidance.some((item) =>
        /commit the change/i.test(item),
      ),
    );
    assert.equal(policy.diagnostics.rejectedItems, 1);
    assert.ok(
      policy.diagnostics.rejectionCodes.includes("unauthorized_git_commit"),
    );
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        implementationGuidance: ["Push the changes to the repository."],
      },
      promptInput(),
    );
    assert.equal(policy.refinement.implementationGuidance.length, 0);
    assert.ok(
      policy.diagnostics.rejectionCodes.includes("unauthorized_git_push"),
    );
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        implementationGuidance: ["Commit the change with a clear message."],
      },
      promptInput({
        rawTask: "Update SettingsPage.tsx and commit the change.",
      }),
    );
    assert.equal(policy.refinement.implementationGuidance.length, 1);
    assert.equal(policy.diagnostics.rejectedItems, 0);
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        constraints: ["Do not commit or push any changes."],
      },
      promptInput(),
    );
    assert.deepEqual(policy.refinement.constraints, [
      "Do not commit or push any changes.",
    ]);
    assert.equal(policy.diagnostics.rejectedItems, 0);
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        finalResponseRequirements: [
          "Confirm successful execution of the build script and manual verification on the Settings page.",
        ],
      },
      promptInput(),
    );
    assert.ok(
      policy.refinement.finalResponseRequirements.some((item) =>
        item.includes("report the actual result"),
      ),
    );
    assert.ok(
      policy.refinement.finalResponseRequirements.some((item) =>
        item.includes("what was actually verified"),
      ),
    );
    assert.equal(policy.diagnostics.rewrittenItems, 1);
    assert.ok(
      policy.diagnostics.rejectionCodes.includes("forced_verification_claim"),
    );
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        finalResponseRequirements: [
          "Confirm that manual visual inspection confirms the desired aesthetic improvement.",
        ],
      },
      promptInput(),
    );
    assert.ok(
      policy.refinement.finalResponseRequirements.some((item) =>
        item.includes("what was actually verified"),
      ),
    );
    assert.ok(
      !policy.refinement.finalResponseRequirements.some((item) =>
        item.includes("desired aesthetic improvement"),
      ),
    );
    assert.equal(policy.diagnostics.rewrittenItems, 1);
    assert.ok(
      policy.diagnostics.rejectionCodes.includes("forced_verification_claim"),
    );
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        implementationGuidance: [
          "Edit src/invented/MissingPage.tsx before changing SettingsPage.tsx.",
        ],
      },
      promptInput(),
    );
    assert.equal(policy.refinement.implementationGuidance.length, 0);
    assert.ok(
      policy.diagnostics.rejectionCodes.includes("unselected_file_reference"),
    );
    scenarios += 1;
  }

  {
    const appHeaderTemplate = `${TEMPLATE}

### apps/desktop/renderer/src/components/layout/AppHeader.tsx

export function AppHeader() { return <header><h2>{title}</h2><Button>Add project</Button></header>; }`;
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        implementationGuidance: [
          "Adjust padding and border classes in AppHeader.tsx while keeping the existing title and button structure.",
          "Keep the logo, navigation links, and user profile in their current positions.",
        ],
        acceptanceCriteria: [
          "The AppHeader remains structurally unchanged.",
          "The profile menu and avatar remain clickable.",
        ],
      },
      promptInput({
        rawTask:
          "В компоненте AppHeader сделай верхнюю панель визуально легче и современнее, не меняя её структуру.",
        relevantFiles: [
          {
            path: "apps/desktop/renderer/src/components/layout/AppHeader.tsx",
            usage: "inspect-and-edit",
            reason: "Explicit target.",
          },
        ],
        templatePrompt: appHeaderTemplate,
      }),
    );
    assert.ok(
      policy.refinement.implementationGuidance.some((item) =>
        item.includes("Adjust padding and border classes"),
      ),
    );
    assert.ok(
      !policy.refinement.implementationGuidance.some((item) =>
        /logo|navigation links|user profile/i.test(item),
      ),
    );
    assert.ok(
      !policy.refinement.acceptanceCriteria.some((item) =>
        /profile menu|avatar/i.test(item),
      ),
    );
    assert.ok(
      policy.diagnostics.rejectionCodes.includes("ungrounded_ui_element"),
    );
    scenarios += 1;
  }

  {
    const ambiguities = detectTaskPackAmbiguities(
      "На странице Settings измени пояснение под заголовком Experimental AI Core.",
    );
    assert.deepEqual(ambiguities, ["missing_replacement_value"]);

    const policy = enforceTaskPackRefinementPolicy(
      VALID_REFINEMENT,
      promptInput({
        rawTask:
          "На странице Settings измени пояснение под заголовком Experimental AI Core.",
      }),
    );
    assert.ok(
      policy.refinement.constraints.some((item) =>
        item.includes("exact replacement text or value was not provided"),
      ),
    );
    assert.equal(policy.diagnostics.injectedItems, 1);
    scenarios += 1;
  }

  {
    assert.deepEqual(
      detectTaskPackAmbiguities(
        'Replace the Settings description with "Use Shadow for deterministic selection".',
      ),
      [],
    );
    assert.deepEqual(
      detectTaskPackAmbiguities(
        "Сделай пояснение под заголовком короче и понятнее.",
      ),
      [],
    );
    scenarios += 1;
  }

  {
    const russianQuoted =
      "На странице Settings замени пояснение под заголовком Experimental AI Core на «Shadow выбирает контекст локально и проверяет реальные файлы проекта».";
    assert.deepEqual(detectTaskPackAmbiguities(russianQuoted), []);
    assert.deepEqual(extractExplicitReplacementValue(russianQuoted), {
      provided: true,
      exactValue:
        "Shadow выбирает контекст локально и проверяет реальные файлы проекта",
    });

    const englishSmartQuoted =
      "Replace the Settings description with “Use Shadow for deterministic selection”.";
    assert.deepEqual(detectTaskPackAmbiguities(englishSmartQuoted), []);
    assert.equal(
      extractExplicitReplacementValue(englishSmartQuoted).exactValue,
      "Use Shadow for deterministic selection",
    );
    scenarios += 1;
  }

  {
    const literalTasks = [
      ["Поменяй цвет на #1a2b3c.", "#1a2b3c"],
      ["Set timeout to 5000.", "5000"],
      [
        "Update endpoint to https://api.example.com/v2.",
        "https://api.example.com/v2",
      ],
      ["Измени лимит = 25.", "25"],
      ["Обнови версию: 2.4.1.", "2.4.1"],
    ] as const;

    for (const [task, exactValue] of literalTasks) {
      assert.deepEqual(detectTaskPackAmbiguities(task), []);
      assert.equal(
        extractExplicitReplacementValue(task).exactValue,
        exactValue,
      );
    }
    scenarios += 1;
  }

  {
    assert.deepEqual(
      detectTaskPackAmbiguities(
        "Измени на странице Settings пояснение под заголовком Experimental AI Core.",
      ),
      ["missing_replacement_value"],
    );
    assert.deepEqual(detectTaskPackAmbiguities("Замени пояснение на «»."), [
      "missing_replacement_value",
    ]);
    scenarios += 1;
  }

  {
    const exactTask =
      "На странице Settings замени пояснение на «Shadow выбирает контекст локально».";
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        constraints: ["Keep the change local to the selected page."],
      },
      promptInput({ rawTask: exactTask }),
    );

    assert.deepEqual(policy.diagnostics.ambiguityCodes, []);
    assert.ok(
      policy.refinement.constraints.some((item) =>
        item.includes('"Shadow выбирает контекст локально"'),
      ),
    );
    assert.ok(
      policy.diagnostics.consistencyCodes.includes("explicit_value_grounded"),
    );
    assert.ok(
      !policy.diagnostics.consistencyCodes.includes(
        "clarification_mode_enabled",
      ),
    );
    scenarios += 1;
  }

  {
    const unsafeRefinement = {
      ...VALID_REFINEMENT,
      implementationGuidance: [
        ...VALID_REFINEMENT.implementationGuidance,
        "Commit the change with a clear message.",
      ],
      finalResponseRequirements: [
        "Confirm successful execution of the build script and manual verification on the Settings page.",
      ],
    };
    const result = await generateReliableTaskPack({
      ...promptInput({
        rawTask:
          "На странице Settings измени пояснение под заголовком Experimental AI Core.",
      }),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings(),
        generate: async () => aiResult(JSON.stringify(unsafeRefinement)),
      },
    });
    assert.equal(result.mode, "ollama");
    assert.equal(result.usedFallback, false);
    assert.ok(!result.content.includes("Commit the change"));
    assert.ok(!result.content.includes("Confirm successful execution"));
    assert.ok(
      result.content.includes(
        "The exact replacement text or value was not provided",
      ),
    );
    assert.equal(result.diagnostics.output.policy.rejectedItems, 2);
    assert.equal(result.diagnostics.output.policy.rewrittenItems, 1);
    assert.equal(result.diagnostics.output.policy.injectedItems, 1);
    scenarios += 1;
  }

  {
    const allUnsafe = {
      implementationGuidance: ["Commit the change."],
      constraints: ["Push the branch."],
      acceptanceCriteria: ["Create a pull request."],
      verificationSteps: ["Merge the branch."],
      finalResponseRequirements: ["Publish a release."],
    };
    const result = await generateReliableTaskPack({
      ...promptInput({ rawTask: "Make a focused settings update." }),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings(),
        generate: async () => aiResult(JSON.stringify(allUnsafe)),
      },
    });
    assert.equal(result.mode, "template");
    assert.equal(result.usedFallback, true);
    assert.equal(result.diagnostics.fallbackReason, "semantic_policy_rejected");
    assert.ok(
      result.diagnostics.output.policy.rejectionCodes.includes(
        "unauthorized_git_commit",
      ),
    );
    scenarios += 1;
  }

  {
    const noisyClarificationRefinement = {
      implementationGuidance: [
        "Locate the Experimental AI Core description in SettingsPage.tsx.",
        "Modify the description and keep the surrounding JSX unchanged.",
        "Test the Settings page after the change.",
      ],
      constraints: [
        "Do not modify unrelated components.",
        "Update only the requested text value.",
      ],
      acceptanceCriteria: [
        "SettingsPage.tsx contains the updated explanation.",
        "The Settings page renders the new text correctly.",
      ],
      verificationSteps: [
        "Run npm run build after the modification.",
        "Navigate to Settings and confirm the new text is visible.",
      ],
      finalResponseRequirements: [
        "List SettingsPage.tsx as modified.",
        "Report the successful build result.",
      ],
    };
    const policy = enforceTaskPackRefinementPolicy(
      noisyClarificationRefinement,
      promptInput({
        rawTask:
          "На странице Settings измени пояснение под заголовком Experimental AI Core.",
      }),
    );

    assert.ok(
      policy.refinement.implementationGuidance.some((item) =>
        item.includes("ask the user for the exact replacement"),
      ),
    );
    assert.ok(
      !policy.refinement.implementationGuidance.some((item) =>
        /modify the description|test the settings page/i.test(item),
      ),
    );
    assert.ok(
      policy.refinement.constraints.includes(
        "Do not modify unrelated components.",
      ),
    );
    assert.deepEqual(policy.refinement.acceptanceCriteria, [
      "Current-run acceptance gate: obtain the exact replacement value from the user and make no project changes before it is supplied.",
      "After clarification, keep the implementation limited to the selected target and the user-provided value.",
    ]);
    assert.ok(
      policy.refinement.verificationSteps[0].startsWith(
        "Do not run implementation verification",
      ),
    );
    assert.ok(
      policy.refinement.finalResponseRequirements.some((item) =>
        item.includes("no files were changed"),
      ),
    );
    assert.ok(
      policy.diagnostics.consistencyCodes.includes(
        "clarification_mode_enabled",
      ),
    );
    assert.ok(
      policy.diagnostics.consistencyCodes.includes(
        "completion_requirements_deferred",
      ),
    );
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        implementationGuidance: [
          "Inspect SettingsPage.tsx and keep the loading change local to the existing settings flow.",
          "Inspect SettingsPage.tsx; keep the loading change local to the existing settings flow.",
        ],
      },
      promptInput(),
    );
    assert.equal(policy.refinement.implementationGuidance.length, 1);
    assert.equal(policy.diagnostics.deduplicatedItems, 1);
    assert.ok(
      policy.diagnostics.consistencyCodes.includes(
        "semantic_duplicates_removed",
      ),
    );
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      {
        ...VALID_REFINEMENT,
        implementationGuidance: [
          "Inspect the selected page structure.",
          "Review the existing loading state.",
          "Trace the current error handling path.",
          "Identify the retry action boundary.",
          "Preserve the existing component contract.",
          "Keep the change within the selected UI scope.",
          "Reuse the current button component.",
          "Avoid changing backend request semantics.",
          "Check the existing translation pattern.",
          "Document any remaining UI limitation.",
        ],
      },
      promptInput(),
    );
    assert.equal(policy.refinement.implementationGuidance.length, 7);
    assert.equal(policy.diagnostics.limitedItems, 3);
    assert.ok(
      policy.diagnostics.consistencyCodes.includes("section_limits_applied"),
    );
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy(
      VALID_REFINEMENT,
      promptInput({
        rawTask:
          'Replace the Settings description with "Use Shadow for deterministic selection".',
      }),
    );
    assert.deepEqual(policy.diagnostics.ambiguityCodes, []);
    assert.ok(
      !policy.diagnostics.consistencyCodes.includes(
        "clarification_mode_enabled",
      ),
    );
    assert.ok(
      policy.refinement.acceptanceCriteria.includes(
        VALID_REFINEMENT.acceptanceCriteria[0],
      ),
    );
    scenarios += 1;
  }

  {
    const conflictingRefinement = {
      implementationGuidance: [
        "Locate the Experimental AI Core description in SettingsPage.tsx.",
        "Modify the text and preserve the surrounding layout.",
      ],
      constraints: ["Do not modify unrelated files."],
      acceptanceCriteria: [
        "SettingsPage.tsx contains the updated explanation.",
      ],
      verificationSteps: ["Run npm run build after the change."],
      finalResponseRequirements: [
        "List SettingsPage.tsx as the modified file.",
        "Report the build result.",
      ],
    };
    const result = await generateReliableTaskPack({
      ...promptInput({
        rawTask:
          "На странице Settings измени пояснение под заголовком Experimental AI Core.",
      }),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings(),
        generate: async () => aiResult(JSON.stringify(conflictingRefinement)),
      },
    });

    assert.equal(result.mode, "ollama");
    assert.equal(result.usedFallback, false);
    assert.ok(
      result.content.includes(
        "Current-run acceptance gate: obtain the exact replacement value",
      ),
    );
    assert.ok(result.content.includes("report that no files were changed"));
    assert.ok(!result.content.includes("contains the updated explanation"));
    assert.ok(
      !result.content.includes("List SettingsPage.tsx as the modified file"),
    );
    assert.ok(
      result.diagnostics.output.policy.consistencyCodes.includes(
        "final_response_rewritten",
      ),
    );
    scenarios += 1;
  }

  {
    const result = await generateReliableTaskPack({
      ...promptInput({ rawTask: "valid-direct" }),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings(),
        generate: async () => aiResult(JSON.stringify(VALID_REFINEMENT)),
      },
    });
    assert.equal(result.mode, "ollama");
    assert.equal(result.usedFallback, false);
    assert.equal(result.diagnostics.status, "generated");
    assert.equal(result.diagnostics.attempts.length, 1);
    assert.ok(result.content.includes("AI-refined implementation guidance"));
    scenarios += 1;
  }

  {
    const responses = [
      '{"implementationGuidance":["unfinished]',
      JSON.stringify(VALID_REFINEMENT),
    ];
    const prompts: string[] = [];
    const result = await generateReliableTaskPack({
      ...promptInput({ rawTask: "retry-success" }),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings(),
        generate: async (input) => {
          prompts.push(input.prompt);
          return aiResult(responses.shift() ?? "");
        },
      },
    });
    assert.equal(result.mode, "ollama");
    assert.equal(result.diagnostics.status, "retried");
    assert.equal(result.diagnostics.attempts.length, 2);
    assert.ok(result.message.includes("controlled retry"));
    assert.equal(prompts.length, 2);
    assert.ok(prompts[1]!.length < prompts[0]!.length);
    assert.match(prompts[1]!, /Every field must be an array of strings/u);
    assert.match(prompts[1]!, /previous response was truncated/iu);
    scenarios += 1;
  }

  {
    const result = await generateReliableTaskPack({
      ...promptInput({ rawTask: "invalid-twice" }),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings(),
        generate: async () => aiResult("not json"),
      },
    });
    assert.equal(result.mode, "template");
    assert.equal(result.usedFallback, true);
    assert.equal(result.diagnostics.status, "fallback");
    assert.equal(result.diagnostics.fallbackReason, "invalid_json");
    assert.equal(result.content, TEMPLATE);
    assert.equal(result.diagnostics.attempts.length, 2);
    assert.ok(!JSON.stringify(result.diagnostics).includes("not json"));
    scenarios += 1;
  }

  {
    const responseFormats: Array<string | undefined> = [];
    const result = await generateReliableTaskPack({
      ...promptInput({ rawTask: "provider-error" }),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings(),
        generate: async (input) => {
          responseFormats.push(input.responseFormat);
          throw new Error("C:\\Users\\private\\secret.env TOKEN=abc");
        },
      },
    });
    assert.equal(result.diagnostics.fallbackReason, "provider_error");
    assert.equal(result.diagnostics.attempts.length, 2);
    assert.deepEqual(responseFormats, ["json", "text"]);
    const diagnosticsJson = JSON.stringify(result.diagnostics);
    assert.ok(!diagnosticsJson.includes("C:\\Users"));
    assert.ok(!diagnosticsJson.includes("TOKEN=abc"));
    scenarios += 1;
  }

  {
    const result = await generateReliableTaskPack({
      ...promptInput({ rawTask: "no-model" }),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings({ defaultOllamaModel: null }),
        generate: async () => aiResult(JSON.stringify(VALID_REFINEMENT)),
      },
    });
    assert.equal(result.mode, "template");
    assert.equal(result.usedFallback, true);
    assert.equal(result.diagnostics.fallbackReason, "model_not_configured");
    scenarios += 1;
  }

  {
    let generateCalls = 0;
    const result = await generateReliableTaskPack({
      ...promptInput({
        rawTask: "Fix stale state after repeated generation.",
        executionContract: {
          schemaVersion: 1,
          mode: "investigation",
          requiredLayers: ["state", "client-api", "ui"],
          confirmedTargets: [],
          targetEvidence: [],
          proposedTargets: [],
          unresolvedDecisions: [],
          implementationGateReasons: [],
          forbiddenAssumptions: [
            "Do not assume a display component owns the stale state.",
          ],
          allowImplementationGuidance: false,
          requiresLayerCoverage: true,
          reasons: ["Bugfix requires investigation."],
        },
      }),
      fallbackContent: TEMPLATE,
      bypassCache: true,
      dependencies: {
        getSettings: async () => settings({ generationMode: "template" }),
        generate: async () => {
          generateCalls += 1;
          return aiResult(JSON.stringify(VALID_REFINEMENT));
        },
      },
    });

    assert.equal(result.mode, "template");
    assert.equal(generateCalls, 0);
    assert.match(result.content, /investigation candidates/u);
    assert.match(result.content, /root cause/u);
    assert.ok(
      result.diagnostics.output.policy.consistencyCodes.includes(
        "execution_contract_investigation_applied",
      ),
    );
    scenarios += 1;
  }

  {
    let generateCalls = 0;
    const dependencies = {
      getSettings: async () => settings(),
      generate: async () => {
        generateCalls += 1;
        return aiResult(JSON.stringify(VALID_REFINEMENT));
      },
    };
    const first = await generateReliableTaskPack({
      ...promptInput({ templatePrompt: "volatile selector note A" }),
      fallbackContent: TEMPLATE,
      cacheIdentity: "stable-semantic-cache-smoke-v4",
      dependencies,
    });
    const second = await generateReliableTaskPack({
      ...promptInput({ templatePrompt: "volatile selector note B" }),
      fallbackContent: TEMPLATE,
      cacheIdentity: "stable-semantic-cache-smoke-v4",
      dependencies,
    });
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(generateCalls, 1);
    scenarios += 1;
  }

  {
    const input = promptInput({
      rawTask: "Add a new connection method.",
      executionContract: {
        schemaVersion: 1,
        mode: "clarification_required",
        requiredLayers: ["backend"],
        confirmedTargets: [],
        targetEvidence: [],
        proposedTargets: [],
        unresolvedDecisions: [
          "Which provider and user flow should be supported?",
        ],
        implementationGateReasons: [],
        forbiddenAssumptions: [
          "Do not invent providers, endpoints, or token flows.",
        ],
        allowImplementationGuidance: false,
        requiresLayerCoverage: false,
        reasons: ["Architecture decision is missing."],
      },
    });
    const result = enforceTaskPackRefinementPolicy(
      {
        implementationGuidance: [
          "Add a token exchange endpoint in SettingsPage.tsx.",
        ],
        constraints: ["Only modify SettingsPage.tsx."],
        acceptanceCriteria: ["The provider login works."],
        verificationSteps: ["Run npm run build."],
        finalResponseRequirements: ["Confirm the flow works."],
      },
      input,
    );

    assert.ok(
      result.refinement.implementationGuidance.some((item) =>
        item.includes("Ask the user to clarify"),
      ),
    );
    assert.ok(
      result.refinement.finalResponseRequirements.some((item) =>
        item.includes("no files were changed"),
      ),
    );
    assert.ok(
      result.diagnostics.consistencyCodes.includes(
        "execution_contract_clarification_applied",
      ),
    );
    scenarios += 1;
  }

  {
    const input = promptInput({
      rawTask: "Fix stale status after regeneration.",
      relevantFiles: [
        {
          path: "apps/desktop/renderer/src/components/generation/GenerationDiagnosticsModal.tsx",
          usage: "inspect-only",
          reason: "Investigation candidate; needs confirmation.",
        },
      ],
      executionContract: {
        schemaVersion: 1,
        mode: "investigation",
        requiredLayers: ["state", "client-api", "ui"],
        confirmedTargets: [],
        targetEvidence: [],
        proposedTargets: [],
        unresolvedDecisions: [],
        implementationGateReasons: [],
        forbiddenAssumptions: [
          "Do not assume the display component owns the stale state.",
        ],
        allowImplementationGuidance: false,
        requiresLayerCoverage: true,
        reasons: ["Bugfix requires ownership tracing."],
      },
    });
    const result = enforceTaskPackRefinementPolicy(
      {
        implementationGuidance: [
          "Add useEffect in GenerationDiagnosticsModal.tsx to refresh cache state.",
        ],
        constraints: ["Only modify GenerationDiagnosticsModal.tsx."],
        acceptanceCriteria: ["The modal refreshes its local state."],
        verificationSteps: ["Run npm run build."],
        finalResponseRequirements: ["List the modified modal."],
      },
      input,
    );

    const combined = JSON.stringify(result.refinement);
    assert.doesNotMatch(combined, /useEffect|Only modify/u);
    assert.match(combined, /investigation candidates/u);
    assert.match(combined, /root cause/u);
    assert.ok(
      result.diagnostics.consistencyCodes.includes(
        "execution_contract_investigation_applied",
      ),
    );
    scenarios += 1;
  }

  {
    const notes = buildContextForgeNotesSection({
      taskType: "general",
      effectiveTaskArea: "fullstack",
      projectTree: [],
      relevantFiles: [],
      fileSnippets: [],
      fileReferences: [],
      fileSelection: {
        selectedFiles: [],
        rejectedModelPaths: [],
        notes: [],
        source: "fallback",
        durationMs: 12,
        usedFallback: true,
        diagnostics: {
          candidateLayerCoverage: ["backend", "ui"],
          confirmedLayerCoverage: ["backend"],
          missingConfirmedLayers: ["ui"],
          missingRequiredLayers: [],
          selectionSource: "fallback",
        } as any,
      } as any,
      selectionQuality: {
        score: 40,
        status: "warning",
        requiredManualReview: true,
        blockingReasons: [],
        warnings: [],
      } as any,
      executionContract: {
        schemaVersion: 1,
        mode: "investigation",
        requiredLayers: ["backend", "ui"],
        confirmedTargets: [],
        proposedTargets: [],
        targetEvidence: [],
        unresolvedDecisions: [],
        implementationGateReasons: ["UI layer is candidate-only."],
        forbiddenAssumptions: [],
        allowImplementationGuidance: false,
        requiresLayerCoverage: true,
        reasons: [],
      },
      projectMemories: [],
      inventorySummary: {
        totalFiles: 0,
        scannedFiles: 0,
        truncated: false,
        notes: [],
      },
      notes: [],
    });

    assert.match(notes, /Candidate layer coverage: backend, ui/u);
    assert.match(notes, /Confirmed layer coverage: backend/u);
    assert.match(notes, /Missing confirmed layers: ui/u);
    assert.doesNotMatch(notes, /Missing required layers: none/u);
    assert.match(notes, /Missing required layers \(candidate-level\): none/u);
    scenarios += 1;
  }

  console.log(
    `task pack generation reliability smoke passed: ${scenarios} scenarios`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
