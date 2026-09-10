import type {
  ContextComposerEngineFileView,
  ContextComposerEvidenceView,
  ContextComposerFindingView,
  ContextComposerPreview,
} from "../../types";

export type ContextDiffValue = string | boolean | number | null | string[];

export interface ContextDiffFieldChange {
  field: string;
  before: ContextDiffValue;
  after: ContextDiffValue;
}

export interface ContextDiffFileSnapshot extends ContextComposerEngineFileView {
  normalizedPath: string;
}

export interface ContextDiffSnapshot {
  engine: {
    status: string;
    effectiveSource: string;
    stopReason: string | null;
    fallbackReason: string | null;
  };
  files: ContextDiffFileSnapshot[];
  findings: ContextComposerFindingView[];
  evidence: ContextComposerEvidenceView[];
  limitations: string[];
  unresolvedQuestions: Array<{ category: string; status: string }>;
}

export interface ContextDiffRecordChange<T> {
  before: T;
  after: T;
  changes: ContextDiffFieldChange[];
}

export interface ContextDiffRecordSet<T> {
  added: T[];
  removed: T[];
  changed: Array<ContextDiffRecordChange<T>>;
  unchanged: T[];
}

export interface ContextDiffResult {
  engineChanges: ContextDiffFieldChange[];
  files: ContextDiffRecordSet<ContextDiffFileSnapshot>;
  findings: ContextDiffRecordSet<ContextComposerFindingView>;
  evidence: ContextDiffRecordSet<ContextComposerEvidenceView>;
  limitations: {
    added: string[];
    removed: string[];
    unchanged: string[];
  };
  unresolvedQuestions: {
    added: Array<{ category: string; status: string }>;
    removed: Array<{ category: string; status: string }>;
    unchanged: Array<{ category: string; status: string }>;
  };
}

export interface ContextDiffSessionState {
  sourcePreview: ContextComposerPreview;
  previous: ContextDiffSnapshot | null;
  current: ContextDiffSnapshot | null;
}

const FILE_FIELDS = [
  "role", "usage", "source", "reviewRequired", "reasonCode", "reasonCodes",
  "findingIds", "evidenceIds",
] as const;
const FINDING_FIELDS = [
  "type", "statement", "status", "authorizationHint", "limitations", "evidenceIds",
] as const;
const EVIDENCE_FIELDS = [
  "role", "strength", "predicate", "relationKind", "path", "startLine", "endLine", "reasonCode",
] as const;

function normalizePath(path: string) {
  return path.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function copyFinding(finding: ContextComposerFindingView): ContextComposerFindingView {
  return {
    findingId: finding.findingId,
    type: finding.type,
    statement: finding.statement,
    status: finding.status,
    authorizationHint: finding.authorizationHint,
    limitations: sortedUnique(finding.limitations),
    evidenceIds: sortedUnique(finding.evidenceIds),
  };
}

function copyEvidence(evidence: ContextComposerEvidenceView): ContextComposerEvidenceView {
  return {
    evidenceId: evidence.evidenceId,
    role: evidence.role,
    strength: evidence.strength,
    ...(evidence.predicate === undefined ? {} : { predicate: evidence.predicate }),
    ...(evidence.relationKind === undefined ? {} : { relationKind: evidence.relationKind }),
    ...(evidence.path === undefined ? {} : { path: evidence.path }),
    ...(evidence.startLine === undefined ? {} : { startLine: evidence.startLine }),
    ...(evidence.endLine === undefined ? {} : { endLine: evidence.endLine }),
    reasonCode: evidence.reasonCode,
  };
}

function copyFile(file: ContextComposerEngineFileView): ContextDiffFileSnapshot {
  return {
    path: file.path,
    normalizedPath: normalizePath(file.path),
    role: file.role,
    usage: file.usage,
    source: file.source,
    reviewRequired: file.reviewRequired,
    reasonCode: file.reasonCode,
    reasonCodes: sortedUnique(file.reasonCodes),
    findingIds: sortedUnique(file.findingIds),
    findings: file.findings.map(copyFinding).sort((left, right) => left.findingId.localeCompare(right.findingId)),
    evidenceIds: sortedUnique(file.evidenceIds),
    evidence: file.evidence.map(copyEvidence).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
  };
}

function collectUniqueRecords<T>(
  records: readonly T[],
  identity: (record: T) => string,
): T[] | null {
  const unique = new Map<string, T>();
  for (const record of records) {
    const id = identity(record);
    const existing = unique.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) return null;
    unique.set(id, record);
  }
  return [...unique.values()].sort((left, right) => identity(left).localeCompare(identity(right)));
}

export function createContextDiffSnapshot(
  preview: ContextComposerPreview,
): ContextDiffSnapshot | null {
  const view = preview.contextEngine;
  if (!view) return null;
  const files = view.files.map(copyFile).sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
  if (new Set(files.map((file) => file.normalizedPath)).size !== files.length) return null;
  const findings = collectUniqueRecords(files.flatMap((file) => file.findings), (finding) => finding.findingId);
  const evidence = collectUniqueRecords(files.flatMap((file) => file.evidence), (record) => record.evidenceId);
  if (!findings || !evidence) return null;

  return deepFreeze({
    engine: {
      status: view.status,
      effectiveSource: view.effectiveSource,
      stopReason: view.stopReason,
      fallbackReason: view.fallbackReason,
    },
    files,
    findings,
    evidence,
    limitations: sortedUnique(view.limitations),
    unresolvedQuestions: [...view.unresolvedQuestions]
      .map((question) => ({ category: question.category, status: question.status }))
      .sort((left, right) => left.category.localeCompare(right.category) || left.status.localeCompare(right.status)),
  });
}

function sameAnalysisScope(left: ContextComposerPreview, right: ContextComposerPreview) {
  return left.project.id === right.project.id &&
    left.task.originalRawTask === right.task.originalRawTask &&
    left.task.requestedTaskType === right.task.requestedTaskType &&
    left.task.targetTool === right.task.targetTool &&
    JSON.stringify(left.task.clarifications) === JSON.stringify(right.task.clarifications);
}

export function advanceContextDiffSession(
  current: ContextDiffSessionState | null,
  preview: ContextComposerPreview,
): ContextDiffSessionState {
  if (current?.sourcePreview === preview) return current;
  const snapshot = createContextDiffSnapshot(preview);
  return {
    sourcePreview: preview,
    previous: current?.current && sameAnalysisScope(current.sourcePreview, preview)
      ? current.current
      : null,
    current: snapshot,
  };
}

function valueOf(record: object, field: string): ContextDiffValue {
  const value = (record as Record<string, unknown>)[field];
  if (value === undefined) return null;
  if (Array.isArray(value)) return value as string[];
  return value as string | boolean | number | null;
}

function fieldChanges(
  before: object,
  after: object,
  fields: readonly string[],
): ContextDiffFieldChange[] {
  return fields.flatMap((field) => {
    const beforeValue = valueOf(before, field);
    const afterValue = valueOf(after, field);
    return JSON.stringify(beforeValue) === JSON.stringify(afterValue)
      ? []
      : [{ field, before: beforeValue, after: afterValue }];
  });
}

function diffRecords<T>(
  previous: readonly T[],
  current: readonly T[],
  identity: (record: T) => string,
  fields: readonly string[],
): ContextDiffRecordSet<T> {
  const previousById = new Map(previous.map((record) => [identity(record), record]));
  const currentById = new Map(current.map((record) => [identity(record), record]));
  const added = current.filter((record) => !previousById.has(identity(record)));
  const removed = previous.filter((record) => !currentById.has(identity(record)));
  const changed: Array<ContextDiffRecordChange<T>> = [];
  const unchanged: T[] = [];
  for (const currentRecord of current) {
    const previousRecord = previousById.get(identity(currentRecord));
    if (!previousRecord) continue;
    const changes = fieldChanges(previousRecord as object, currentRecord as object, fields);
    if (changes.length > 0) changed.push({ before: previousRecord, after: currentRecord, changes });
    else unchanged.push(currentRecord);
  }
  return { added, removed, changed, unchanged };
}

function diffStrings(previous: readonly string[], current: readonly string[]) {
  const previousSet = new Set(previous);
  const currentSet = new Set(current);
  return {
    added: current.filter((value) => !previousSet.has(value)),
    removed: previous.filter((value) => !currentSet.has(value)),
    unchanged: current.filter((value) => previousSet.has(value)),
  };
}

function diffQuestions(
  previous: ContextDiffSnapshot["unresolvedQuestions"],
  current: ContextDiffSnapshot["unresolvedQuestions"],
) {
  const identity = (question: { category: string; status: string }) =>
    JSON.stringify([question.category, question.status]);
  const previousIds = new Set(previous.map(identity));
  const currentIds = new Set(current.map(identity));
  return {
    added: current.filter((question) => !previousIds.has(identity(question))),
    removed: previous.filter((question) => !currentIds.has(identity(question))),
    unchanged: current.filter((question) => previousIds.has(identity(question))),
  };
}

export function compareContextDiffSnapshots(
  previous: ContextDiffSnapshot,
  current: ContextDiffSnapshot,
): ContextDiffResult {
  return {
    engineChanges: fieldChanges(previous.engine, current.engine, [
      "status", "effectiveSource", "stopReason", "fallbackReason",
    ]),
    files: diffRecords(previous.files, current.files, (file) => file.normalizedPath, FILE_FIELDS),
    findings: diffRecords(previous.findings, current.findings, (finding) => finding.findingId, FINDING_FIELDS),
    evidence: diffRecords(previous.evidence, current.evidence, (evidence) => evidence.evidenceId, EVIDENCE_FIELDS),
    limitations: diffStrings(previous.limitations, current.limitations),
    unresolvedQuestions: diffQuestions(previous.unresolvedQuestions, current.unresolvedQuestions),
  };
}

export function contextDiffPathIdentity(path: string) {
  return normalizePath(path);
}
