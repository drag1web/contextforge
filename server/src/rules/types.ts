export type TargetTool = "codex" | "cursor" | "claude" | "generic";

export type TemplateTaskType =
  | "general"
  | "ui"
  | "backend"
  | "fullstack"
  | "build"
  | "bugfix"
  | "refactor"
  | "docs"
  | "tests";

export type RuleCategory =
  | "general"
  | "ui"
  | "backend"
  | "bugfix"
  | "refactor"
  | "docs"
  | "tests"
  | "assets"
  | "verification";

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  targetTool: TargetTool;
  taskType: TemplateTaskType;
  content: string;
  isBuiltin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleItem {
  id: string;
  title: string;
  description: string;
  category: RuleCategory;
  content: string;
  isBuiltin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleProfile {
  id: string;
  name: string;
  description: string;
  taskType: TemplateTaskType;
  enabledRuleIds: string[];
  customRules: string[];
  acceptanceCriteriaPresetId?: string | null;
  isBuiltin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcceptanceCriteriaPreset {
  id: string;
  name: string;
  description: string;
  taskType: TemplateTaskType;
  criteria: string[];
  isBuiltin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RulesAndTemplatesStore {
  version: number;
  templates: PromptTemplate[];
  ruleItems: RuleItem[];
  ruleProfiles: RuleProfile[];
  acceptanceCriteriaPresets: AcceptanceCriteriaPreset[];
}