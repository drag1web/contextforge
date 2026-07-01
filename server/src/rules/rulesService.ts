import crypto from "node:crypto";

import {
  BUILT_IN_ACCEPTANCE_CRITERIA_PRESETS,
  BUILT_IN_RULE_ITEMS,
  BUILT_IN_RULE_PROFILES,
  BUILT_IN_TEMPLATES
} from "./builtins.js";
import { readRulesAndTemplatesStore, writeRulesAndTemplatesStore } from "./rulesStore.js";
import type {
  AcceptanceCriteriaPreset,
  PromptTemplate,
  RuleItem,
  RuleProfile,
  TargetTool,
  TemplateTaskType
} from "./types.js";

const VALID_TARGET_TOOLS: TargetTool[] = ["codex", "cursor", "claude", "generic"];

const VALID_TASK_TYPES: TemplateTaskType[] = [
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

export class RulesServiceError extends Error {
  constructor(
    message: string,
    public statusCode = 400
  ) {
    super(message);
  }
}

interface ProjectLike {
  name: string;
  localPath?: string;
  packageManager?: string | null;
  detectedStack?: string[];
  scripts?: Record<string, string>;
  readinessScore?: number;
  readinessReport?: {
    issues?: string[];
  } | null;
}

interface BuildTaskPackTemplateInput {
  project: ProjectLike;
  rawTask: string;
  taskType: string;
  targetTool: string;
  templateId?: string;
  ruleProfileId?: string;
  enabledRuleIds?: string[];
  customRules?: string[];
  acceptanceCriteriaPresetId?: string;
  acceptanceCriteria?: string[];
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTargetTool(value: string): TargetTool {
  return VALID_TARGET_TOOLS.includes(value as TargetTool)
    ? (value as TargetTool)
    : "generic";
}

function normalizeTaskType(value: string): TemplateTaskType {
  return VALID_TASK_TYPES.includes(value as TemplateTaskType)
    ? (value as TemplateTaskType)
    : "general";
}

function mergeById<T extends { id: string }>(builtins: T[], custom: T[]) {
  const builtinIds = new Set(builtins.map((item) => item.id));

  return [
    ...builtins,
    ...custom.filter((item) => item?.id && !builtinIds.has(item.id))
  ];
}

function sanitizeText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function sanitizeTextList(values: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => sanitizeText(value, maxLength))
        .filter(Boolean)
    )
  ).slice(0, maxItems);
}

function ensureNotBuiltin(id: string, builtInIds: Set<string>, entity: string) {
  if (builtInIds.has(id)) {
    throw new RulesServiceError(`Built-in ${entity} cannot be modified or deleted. Copy it first.`, 403);
  }
}

function getTargetToolLabel(targetTool: TargetTool) {
  const labels: Record<TargetTool, string> = {
    codex: "Codex",
    cursor: "Cursor",
    claude: "Claude",
    generic: "Generic coding agent"
  };

  return labels[targetTool];
}

function formatList(values: string[], emptyMessage: string) {
  if (values.length === 0) {
    return `- ${emptyMessage}`;
  }

  return values.map((value) => `- ${value}`).join("\n");
}

function formatRules(ruleItems: RuleItem[], customRules: string[]) {
  const builtInRules = ruleItems.map((rule) => `- **${rule.title}:** ${rule.content}`);
  const custom = customRules.map((rule) => `- ${rule}`);

  return [...builtInRules, ...custom].join("\n") || "- Keep changes focused, safe, and reviewable.";
}

function formatAcceptanceCriteria(criteria: string[]) {
  return formatList(criteria, "The task is completed safely and the final response explains how to verify it.");
}

function formatRuleContractSection({
  template,
  profile,
  ruleItems,
  customRules,
  acceptanceCriteriaPreset,
  acceptanceCriteria
}: {
  template: PromptTemplate;
  profile: RuleProfile | null;
  ruleItems: RuleItem[];
  customRules: string[];
  acceptanceCriteriaPreset: AcceptanceCriteriaPreset | null;
  acceptanceCriteria: string[];
}) {
  const enabledRules =
    ruleItems.length > 0
      ? ruleItems
        .map((rule) => `- **${rule.title}** (${rule.category}): ${rule.content}`)
        .join("\n")
      : "- No toggle rules selected.";

  const custom =
    customRules.length > 0
      ? customRules.map((rule) => `- ${rule}`).join("\n")
      : "- No custom user rules provided.";

  const criteria =
    acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")
      : "- No acceptance criteria provided.";

  return `
## ContextForge Rules & Criteria

This section is generated and validated by ContextForge. Preserve it exactly.

### Selected Template

- ID: ${template.id}
- Name: ${template.name}
- Target tool: ${template.targetTool}
- Task type: ${template.taskType}
- Built-in: ${template.isBuiltin ? "yes" : "no"}

### Selected Rule Profile

${profile
      ? [
        `- ID: ${profile.id}`,
        `- Name: ${profile.name}`,
        `- Task type: ${profile.taskType}`,
        `- Built-in: ${profile.isBuiltin ? "yes" : "no"}`
      ].join("\n")
      : "- No rule profile selected."}

### Enabled Toggle Rules

${enabledRules}

### Custom User Rules

${custom}

### Acceptance Criteria Preset

${acceptanceCriteriaPreset
      ? [
        `- ID: ${acceptanceCriteriaPreset.id}`,
        `- Name: ${acceptanceCriteriaPreset.name}`,
        `- Task type: ${acceptanceCriteriaPreset.taskType}`
      ].join("\n")
      : "- No acceptance criteria preset selected."}

### Final Acceptance Criteria

${criteria}
`.trim();
}

function formatReadinessIssues(project: ProjectLike) {
  const issues = project.readinessReport?.issues ?? [];
  return formatList(issues, "No known AI-readiness issues were provided.");
}

function buildVerification(project: ProjectLike) {
  const scripts = project.scripts ?? {};
  const commands: string[] = [];

  if (scripts.typecheck) {
    commands.push("Run the existing typecheck script.");
  }

  if (scripts.lint) {
    commands.push("Run the existing lint script.");
  }

  if (scripts.test) {
    commands.push("Run the existing test script.");
  }

  if (scripts.build) {
    commands.push("Run the existing build script if the change can affect production output.");
  }

  if (commands.length === 0) {
    return [
      "- No verification scripts were detected in project metadata.",
      "- Perform focused manual verification for the changed behavior.",
      "- Do not claim automated checks were run unless they were actually run."
    ].join("\n");
  }

  return [
    ...commands.map((command) => `- ${command}`),
    "- If a command cannot be run, explain why and provide manual verification steps."
  ].join("\n");
}

function renderTemplate(content: string, variables: Record<string, string>) {
  return content.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => {
    return variables[key] ?? "";
  });
}

async function getCustomStore() {
  return readRulesAndTemplatesStore();
}

export async function getTemplates() {
  const store = await getCustomStore();
  return mergeById(BUILT_IN_TEMPLATES, store.templates);
}

export async function getRuleItems() {
  const store = await getCustomStore();
  return mergeById(BUILT_IN_RULE_ITEMS, store.ruleItems);
}

export async function getRuleProfiles() {
  const store = await getCustomStore();
  return mergeById(BUILT_IN_RULE_PROFILES, store.ruleProfiles);
}

export async function getAcceptanceCriteriaPresets() {
  const store = await getCustomStore();
  return mergeById(
    BUILT_IN_ACCEPTANCE_CRITERIA_PRESETS,
    store.acceptanceCriteriaPresets
  );
}

export async function getRulesAndTemplatesCatalog() {
  const [templates, ruleItems, ruleProfiles, acceptanceCriteriaPresets] =
    await Promise.all([
      getTemplates(),
      getRuleItems(),
      getRuleProfiles(),
      getAcceptanceCriteriaPresets()
    ]);

  return {
    templates,
    ruleItems,
    ruleProfiles,
    acceptanceCriteriaPresets
  };
}

export async function createTemplate(input: {
  name: string;
  description?: string;
  targetTool: string;
  taskType: string;
  content: string;
}) {
  const store = await getCustomStore();

  const template: PromptTemplate = {
    id: `custom.template.${crypto.randomUUID()}`,
    name: sanitizeText(input.name, 120),
    description: sanitizeText(input.description, 500),
    targetTool: normalizeTargetTool(input.targetTool),
    taskType: normalizeTaskType(input.taskType),
    content: sanitizeText(input.content, 20_000),
    isBuiltin: false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  store.templates.push(template);
  await writeRulesAndTemplatesStore(store);

  return template;
}

export async function updateTemplate(id: string, input: Partial<PromptTemplate>) {
  const builtInIds = new Set(BUILT_IN_TEMPLATES.map((template) => template.id));
  ensureNotBuiltin(id, builtInIds, "template");

  const store = await getCustomStore();
  const index = store.templates.findIndex((template) => template.id === id);

  if (index === -1) {
    throw new RulesServiceError("Template not found.", 404);
  }

  const current = store.templates[index];

  const updated: PromptTemplate = {
    ...current,
    name: input.name === undefined ? current.name : sanitizeText(input.name, 120),
    description:
      input.description === undefined
        ? current.description
        : sanitizeText(input.description, 500),
    targetTool:
      input.targetTool === undefined
        ? current.targetTool
        : normalizeTargetTool(input.targetTool),
    taskType:
      input.taskType === undefined
        ? current.taskType
        : normalizeTaskType(input.taskType),
    content:
      input.content === undefined
        ? current.content
        : sanitizeText(input.content, 20_000),
    isBuiltin: false,
    updatedAt: nowIso()
  };

  store.templates[index] = updated;
  await writeRulesAndTemplatesStore(store);

  return updated;
}

export async function deleteTemplate(id: string) {
  const builtInIds = new Set(BUILT_IN_TEMPLATES.map((template) => template.id));
  ensureNotBuiltin(id, builtInIds, "template");

  const store = await getCustomStore();
  const nextTemplates = store.templates.filter((template) => template.id !== id);

  if (nextTemplates.length === store.templates.length) {
    throw new RulesServiceError("Template not found.", 404);
  }

  store.templates = nextTemplates;
  await writeRulesAndTemplatesStore(store);

  return true;
}

export async function createRuleProfile(input: {
  name: string;
  description?: string;
  taskType: string;
  enabledRuleIds?: string[];
  customRules?: string[];
  acceptanceCriteriaPresetId?: string | null;
}) {
  await validateRuleIds(input.enabledRuleIds ?? []);

  if (input.acceptanceCriteriaPresetId) {
    await ensureAcceptanceCriteriaPresetExists(input.acceptanceCriteriaPresetId);
  }

  const store = await getCustomStore();

  const profile: RuleProfile = {
    id: `custom.profile.${crypto.randomUUID()}`,
    name: sanitizeText(input.name, 120),
    description: sanitizeText(input.description, 500),
    taskType: normalizeTaskType(input.taskType),
    enabledRuleIds: sanitizeTextList(input.enabledRuleIds ?? [], 80, 180),
    customRules: sanitizeTextList(input.customRules ?? [], 20, 700),
    acceptanceCriteriaPresetId: input.acceptanceCriteriaPresetId ?? null,
    isBuiltin: false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  store.ruleProfiles.push(profile);
  await writeRulesAndTemplatesStore(store);

  return profile;
}

export async function updateRuleProfile(id: string, input: Partial<RuleProfile>) {
  const builtInIds = new Set(BUILT_IN_RULE_PROFILES.map((profile) => profile.id));
  ensureNotBuiltin(id, builtInIds, "rule profile");

  if (input.enabledRuleIds) {
    await validateRuleIds(input.enabledRuleIds);
  }

  if (input.acceptanceCriteriaPresetId) {
    await ensureAcceptanceCriteriaPresetExists(input.acceptanceCriteriaPresetId);
  }

  const store = await getCustomStore();
  const index = store.ruleProfiles.findIndex((profile) => profile.id === id);

  if (index === -1) {
    throw new RulesServiceError("Rule profile not found.", 404);
  }

  const current = store.ruleProfiles[index];

  const updated: RuleProfile = {
    ...current,
    name: input.name === undefined ? current.name : sanitizeText(input.name, 120),
    description:
      input.description === undefined
        ? current.description
        : sanitizeText(input.description, 500),
    taskType:
      input.taskType === undefined
        ? current.taskType
        : normalizeTaskType(input.taskType),
    enabledRuleIds:
      input.enabledRuleIds === undefined
        ? current.enabledRuleIds
        : sanitizeTextList(input.enabledRuleIds, 80, 180),
    customRules:
      input.customRules === undefined
        ? current.customRules
        : sanitizeTextList(input.customRules, 20, 700),
    acceptanceCriteriaPresetId:
      input.acceptanceCriteriaPresetId === undefined
        ? current.acceptanceCriteriaPresetId
        : input.acceptanceCriteriaPresetId,
    isBuiltin: false,
    updatedAt: nowIso()
  };

  store.ruleProfiles[index] = updated;
  await writeRulesAndTemplatesStore(store);

  return updated;
}

export async function deleteRuleProfile(id: string) {
  const builtInIds = new Set(BUILT_IN_RULE_PROFILES.map((profile) => profile.id));
  ensureNotBuiltin(id, builtInIds, "rule profile");

  const store = await getCustomStore();
  const nextProfiles = store.ruleProfiles.filter((profile) => profile.id !== id);

  if (nextProfiles.length === store.ruleProfiles.length) {
    throw new RulesServiceError("Rule profile not found.", 404);
  }

  store.ruleProfiles = nextProfiles;
  await writeRulesAndTemplatesStore(store);

  return true;
}

async function validateRuleIds(ruleIds: string[]) {
  const allRules = await getRuleItems();
  const knownRuleIds = new Set(allRules.map((rule) => rule.id));
  const unknownRuleIds = ruleIds.filter((ruleId) => !knownRuleIds.has(ruleId));

  if (unknownRuleIds.length > 0) {
    throw new RulesServiceError(
      `Unknown rule id(s): ${unknownRuleIds.join(", ")}.`,
      400
    );
  }
}

async function ensureAcceptanceCriteriaPresetExists(presetId: string) {
  const presets = await getAcceptanceCriteriaPresets();

  if (!presets.some((preset) => preset.id === presetId)) {
    throw new RulesServiceError(`Acceptance criteria preset not found: ${presetId}.`, 404);
  }
}

function selectDefaultTemplate(
  templates: PromptTemplate[],
  targetTool: TargetTool,
  taskType: TemplateTaskType
) {
  return (
    templates.find(
      (template) =>
        template.targetTool === targetTool && template.taskType === taskType
    ) ??
    templates.find(
      (template) =>
        template.targetTool === targetTool && template.taskType === "general"
    ) ??
    templates.find(
      (template) =>
        template.targetTool === "generic" && template.taskType === taskType
    ) ??
    templates.find(
      (template) =>
        template.targetTool === "generic" && template.taskType === "general"
    )
  );
}

function selectDefaultProfile(
  profiles: RuleProfile[],
  taskType: TemplateTaskType
) {
  const profileIdByTaskType: Partial<Record<TemplateTaskType, string>> = {
    general: "profile.safe-general",
    ui: "profile.safe-ui-task",
    backend: "profile.backend-safe-change",
    fullstack: "profile.backend-safe-change",
    build: "profile.backend-safe-change",
    bugfix: "profile.bugfix-minimal-change",
    refactor: "profile.refactor-no-behavior-change",
    docs: "profile.docs-update",
    tests: "profile.tests-verification"
  };

  const preferredId = profileIdByTaskType[taskType] ?? "profile.safe-general";

  return (
    profiles.find((profile) => profile.id === preferredId) ??
    profiles.find((profile) => profile.id === "profile.safe-general") ??
    profiles[0]
  );
}

export async function buildTaskPackRulesTemplatePrompt(
  input: BuildTaskPackTemplateInput
) {
  const targetTool = normalizeTargetTool(input.targetTool);
  const taskType = normalizeTaskType(input.taskType);

  const catalog = await getRulesAndTemplatesCatalog();

  const template = input.templateId
    ? catalog.templates.find((item) => item.id === input.templateId)
    : selectDefaultTemplate(catalog.templates, targetTool, taskType);

  if (!template) {
    throw new RulesServiceError("Prompt template not found.", 404);
  }

  const profile = input.ruleProfileId
    ? catalog.ruleProfiles.find((item) => item.id === input.ruleProfileId)
    : selectDefaultProfile(catalog.ruleProfiles, taskType);

  if (input.ruleProfileId && !profile) {
    throw new RulesServiceError("Rule profile not found.", 404);
  }

  const hasExplicitEnabledRuleIds = Array.isArray(input.enabledRuleIds);

  const enabledRuleIds = hasExplicitEnabledRuleIds
    ? sanitizeTextList(input.enabledRuleIds, 80, 180)
    : profile?.enabledRuleIds ?? [];

  await validateRuleIds(enabledRuleIds);

  const enabledRuleIdSet = new Set(enabledRuleIds);
  const selectedRuleItems = catalog.ruleItems.filter((rule) =>
    enabledRuleIdSet.has(rule.id)
  );

  const profileCustomRules = profile?.customRules ?? [];
  const customRules = sanitizeTextList(
    [...profileCustomRules, ...(input.customRules ?? [])],
    20,
    700
  );

  const presetId =
    input.acceptanceCriteriaPresetId ??
    profile?.acceptanceCriteriaPresetId ??
    null;

  const preset = presetId
    ? catalog.acceptanceCriteriaPresets.find((item) => item.id === presetId)
    : null;

  if (presetId && !preset) {
    throw new RulesServiceError("Acceptance criteria preset not found.", 404);
  }

  const acceptanceCriteria = sanitizeTextList(
    [...(preset?.criteria ?? []), ...(input.acceptanceCriteria ?? [])],
    30,
    700
  );

  const projectMetadata = {
    name: input.project.name,
    localPath: input.project.localPath,
    packageManager: input.project.packageManager,
    detectedStack: input.project.detectedStack,
    scripts: input.project.scripts,
    readinessScore: input.project.readinessScore
  };

  const renderedTemplatePrompt = renderTemplate(template.content, {
    targetTool,
    targetToolLabel: getTargetToolLabel(targetTool),
    taskType,
    rawTask: input.rawTask,
    projectName: input.project.name,
    packageManager: input.project.packageManager ?? "unknown",
    detectedStack:
      input.project.detectedStack && input.project.detectedStack.length > 0
        ? input.project.detectedStack.join(", ")
        : "unknown",
    readinessScore: String(input.project.readinessScore ?? "unknown"),
    projectMetadataJson: JSON.stringify(projectMetadata, null, 2),
    rules: formatRules(selectedRuleItems, customRules),
    readinessIssues: formatReadinessIssues(input.project),
    acceptanceCriteria: formatAcceptanceCriteria(acceptanceCriteria),
    verification: buildVerification(input.project)
  });

  const rulesContractSection = formatRuleContractSection({
    template,
    profile: profile ?? null,
    ruleItems: selectedRuleItems,
    customRules,
    acceptanceCriteriaPreset: preset ?? null,
    acceptanceCriteria
  });

  const prompt = [
    renderedTemplatePrompt,
    "",
    "---",
    "",
    rulesContractSection
  ].join("\n").trim();

  return {
    prompt,
    recipe: {
      template,
      profile: profile ?? null,
      ruleItems: selectedRuleItems,
      customRules,
      acceptanceCriteriaPreset: preset ?? null,
      acceptanceCriteria
    }
  };
}