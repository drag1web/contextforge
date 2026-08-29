import path from "node:path";

export type ExternalRetirementExpectedOutcome =
  | "grounded_selection"
  | "safe_no_selection"
  | "typed_infrastructure_rollback";

export type ExternalRetirementExpectedStatus =
  | "v2_applied"
  | "v2_no_selection"
  | "clarification_required"
  | "review_required"
  | "safe_fail"
  | "legacy_rollback"
  | "engine_error";

export interface ExternalRetirementCaseManifest {
  id: string;
  title: string;
  repositoryShape: string;
  task: string;
  requestedTaskType: string;
  expectations: {
    expectedOutcome: ExternalRetirementExpectedOutcome;
    allowedStatuses: readonly ExternalRetirementExpectedStatus[];
    requiredPaths: readonly string[];
    forbiddenPaths: readonly string[];
    ambiguityExpected: boolean;
    expectedRollbackReason: "capacity_exhausted" | "execution_timeout" | "execution_error" | null;
  };
}

export interface ExternalRetirementProjectManifest {
  id: string;
  rootPath: string;
  cases: readonly ExternalRetirementCaseManifest[];
}

export interface ExternalRetirementValidationManifest {
  schemaVersion: 1;
  manifestId: string;
  title: string;
  candidateFallbackRateThreshold?: number;
  projects: readonly ExternalRetirementProjectManifest[];
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,100}$/u;
const RELATIVE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f]+$/u;
const STATUSES = new Set(["v2_applied", "v2_no_selection", "clarification_required", "review_required", "safe_fail", "legacy_rollback", "engine_error"]);
const OUTCOMES = new Set(["grounded_selection", "safe_no_selection", "typed_infrastructure_rollback"]);
const ROLLBACKS = new Set(["capacity_exhausted", "execution_timeout", "execution_error"]);

export class ExternalRetirementManifestError extends Error {
  readonly code = "invalid_external_retirement_manifest" as const;
  constructor() {
    super("External retirement manifest failed closed runtime validation.");
    this.name = "ExternalRetirementManifestError";
  }
}

function record(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new ExternalRetirementManifestError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.includes(key)) ||
      Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set || !("value" in descriptor) || !descriptor.enumerable) ||
      required.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) throw new ExternalRetirementManifestError();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function array(value: unknown, maximum = 500): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new ExternalRetirementManifestError();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) throw new ExternalRetirementManifestError();
  }
  return value;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum || /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) {
    throw new ExternalRetirementManifestError();
  }
  return value.trim();
}

function identifier(value: unknown): string {
  const result = text(value, 101);
  if (!IDENTIFIER.test(result)) throw new ExternalRetirementManifestError();
  return result;
}

function relativePath(value: unknown): string {
  const result = text(value, 500).replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!RELATIVE_PATH.test(result) || result.endsWith("/") || result.includes("//")) throw new ExternalRetirementManifestError();
  return result;
}

function unique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.map((value) => {
    const itemKey = key(value).toLowerCase();
    if (seen.has(itemKey)) throw new ExternalRetirementManifestError();
    seen.add(itemKey);
    return value;
  });
}

function validateCase(raw: unknown): ExternalRetirementCaseManifest {
  const item = record(raw,
    ["id", "title", "repositoryShape", "task", "requestedTaskType", "expectations"],
    ["id", "title", "repositoryShape", "task", "requestedTaskType", "expectations"]);
  const expectations = record(item.expectations,
    ["expectedOutcome", "allowedStatuses", "requiredPaths", "forbiddenPaths", "ambiguityExpected", "expectedRollbackReason"],
    ["expectedOutcome", "allowedStatuses", "requiredPaths", "forbiddenPaths", "ambiguityExpected", "expectedRollbackReason"]);
  if (!OUTCOMES.has(expectations.expectedOutcome as string) || typeof expectations.ambiguityExpected !== "boolean" ||
      (expectations.expectedRollbackReason !== null && !ROLLBACKS.has(expectations.expectedRollbackReason as string))) {
    throw new ExternalRetirementManifestError();
  }
  const allowedStatuses = unique(array(expectations.allowedStatuses, 7).map((value) => {
    if (typeof value !== "string" || !STATUSES.has(value)) throw new ExternalRetirementManifestError();
    return value as ExternalRetirementExpectedStatus;
  }), (value) => value);
  if (allowedStatuses.length === 0) throw new ExternalRetirementManifestError();
  const requiredPaths = unique(array(expectations.requiredPaths, 64).map(relativePath), (value) => value);
  const forbiddenPaths = unique(array(expectations.forbiddenPaths, 64).map(relativePath), (value) => value);
  return {
    id: identifier(item.id), title: text(item.title, 200), repositoryShape: identifier(item.repositoryShape),
    task: text(item.task, 8_000), requestedTaskType: text(item.requestedTaskType, 80),
    expectations: {
      expectedOutcome: expectations.expectedOutcome as ExternalRetirementExpectedOutcome,
      allowedStatuses, requiredPaths, forbiddenPaths,
      ambiguityExpected: expectations.ambiguityExpected,
      expectedRollbackReason: expectations.expectedRollbackReason as ExternalRetirementCaseManifest["expectations"]["expectedRollbackReason"],
    },
  };
}

export function validateExternalRetirementManifest(raw: unknown): ExternalRetirementValidationManifest {
  const value = record(raw, ["schemaVersion", "manifestId", "title", "candidateFallbackRateThreshold", "projects"],
    ["schemaVersion", "manifestId", "title", "projects"]);
  if (value.schemaVersion !== 1) throw new ExternalRetirementManifestError();
  if (value.candidateFallbackRateThreshold !== undefined &&
      (typeof value.candidateFallbackRateThreshold !== "number" || !Number.isFinite(value.candidateFallbackRateThreshold) ||
       value.candidateFallbackRateThreshold < 0 || value.candidateFallbackRateThreshold > 1)) throw new ExternalRetirementManifestError();
  const projects = unique(array(value.projects, 50).map((rawProject) => {
    const project = record(rawProject, ["id", "rootPath", "cases"], ["id", "rootPath", "cases"]);
    const rootPath = text(project.rootPath, 1_000);
    if (!path.isAbsolute(rootPath)) throw new ExternalRetirementManifestError();
    const cases = unique(array(project.cases, 500).map(validateCase), (item) => item.id);
    if (cases.length === 0) throw new ExternalRetirementManifestError();
    return { id: identifier(project.id), rootPath, cases };
  }), (project) => project.id);
  if (projects.length === 0) throw new ExternalRetirementManifestError();
  const caseIds = new Set<string>();
  projects.forEach((project) => project.cases.forEach((item) => {
    if (caseIds.has(item.id)) throw new ExternalRetirementManifestError();
    caseIds.add(item.id);
  }));
  return structuredClone({
    schemaVersion: 1 as const,
    manifestId: identifier(value.manifestId),
    title: text(value.title, 200),
    ...(value.candidateFallbackRateThreshold === undefined ? {} : { candidateFallbackRateThreshold: value.candidateFallbackRateThreshold }),
    projects,
  });
}
