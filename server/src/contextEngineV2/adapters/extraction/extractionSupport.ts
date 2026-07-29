import { createHash } from "node:crypto";

import type {
  EntityId,
  EntityKind,
  FactExtractionMethod,
  FactId,
  FactPredicate,
  FactRecord,
  JsonObject,
  LiteralValue,
  RepositoryEntity,
  SourceSpan,
} from "../../contracts/index.js";
import type {
  ExtractionLimitation,
  ExtractorInput,
} from "../../ports/index.js";
import { isSecretLikeSemanticLiteral } from "../../domain/semanticLiteralSafety.js";

export interface ExtractorContext {
  input: ExtractorInput;
  extractorId: string;
  extractorVersion: string;
  method: FactExtractionMethod;
  observedAt: string;
}

export interface SourceOffsets {
  start: number;
  end: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeSemanticString(value: string): string {
  return isSecretLikeSemanticLiteral(value)
    ? `[redacted:sha256:${sha256(value)}]`
    : value;
}

function safeJsonValue<T>(value: T): T {
  if (typeof value === "string") {
    return safeSemanticString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => safeJsonValue(entry)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, safeJsonValue(entry)]),
    ) as T;
  }
  return value;
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === undefined) {
    return '"<undefined>"';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => stableCompare(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(`<${typeof value}>`);
}

export function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function identity(prefix: string, value: unknown): string {
  return `${prefix}_${sha256(stableSerialize(value))}`;
}

function lineAndColumn(content: string, offset: number): {
  line: number;
  column: number;
} {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

export function createSourceSpan(
  context: ExtractorContext,
  offsets: SourceOffsets,
): SourceSpan {
  const start = Math.max(0, Math.min(offsets.start, context.input.content.length));
  const end = Math.max(start, Math.min(offsets.end, context.input.content.length));
  const startCoordinate = lineAndColumn(context.input.content, start);
  const endCoordinate = lineAndColumn(context.input.content, end);
  const normalizedExcerpt = context.input.content
    .slice(start, end)
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  return {
    kind: "source_span",
    snapshotId: context.input.snapshotId,
    fileId: context.input.fileId,
    path: context.input.path,
    startLine: startCoordinate.line,
    startColumn: startCoordinate.column,
    endLine: endCoordinate.line,
    endColumn: endCoordinate.column,
    contentFingerprint: context.input.contentFingerprint,
    excerptHash: `sha256:${sha256(normalizedExcerpt)}`,
  };
}

export function createEntity(
  context: ExtractorContext,
  input: {
    semanticKey: string;
    kind: EntityKind;
    displayName: string;
    canonicalName?: string;
    source?: SourceOffsets;
    fileBacked?: boolean;
    attributes?: JsonObject;
  },
): RepositoryEntity {
  const id = identity("entity", {
    snapshotId: context.input.snapshotId,
    fileId: context.input.fileId,
    path: context.input.path,
    contentFingerprint: context.input.contentFingerprint,
    extractorId: context.extractorId,
    extractorVersion: context.extractorVersion,
    semanticKey: input.semanticKey,
    kind: input.kind,
    source: input.source ?? null,
  }) as EntityId;
  return {
    id,
    snapshotId: context.input.snapshotId,
    kind: input.kind,
    displayName: safeSemanticString(input.displayName),
    ...(input.canonicalName !== undefined
      ? { canonicalName: safeSemanticString(input.canonicalName) }
      : {}),
    ...(input.fileBacked === false ? {} : { fileId: context.input.fileId }),
    ...(input.attributes !== undefined
      ? { attributes: safeJsonValue(input.attributes) }
      : {}),
  };
}

function factIdentity(
  context: ExtractorContext,
  input: {
    kind: FactRecord["kind"];
    subject: RepositoryEntity;
    predicate: FactPredicate;
    object: RepositoryEntity | LiteralValue;
    source: SourceOffsets;
  },
): FactId {
  return identity("fact", {
    snapshotId: context.input.snapshotId,
    fileId: context.input.fileId,
    contentFingerprint: context.input.contentFingerprint,
    extractorId: context.extractorId,
    extractorVersion: context.extractorVersion,
    source: input.source,
    kind: input.kind,
    subjectId: input.subject.id,
    predicate: input.predicate,
    object:
      input.kind === "relation"
        ? { entityId: (input.object as RepositoryEntity).id }
        : input.object,
  }) as FactId;
}

export function createRelationFact(
  context: ExtractorContext,
  input: {
    subject: RepositoryEntity;
    predicate: FactPredicate;
    object: RepositoryEntity;
    source: SourceOffsets;
    attributes?: JsonObject;
  },
): FactRecord {
  return {
    kind: "relation",
    id: factIdentity(context, { ...input, kind: "relation" }),
    snapshotId: context.input.snapshotId,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    source: createSourceSpan(context, input.source),
    provenance: {
      extractorId: context.extractorId,
      extractorVersion: context.extractorVersion,
      method: context.method,
      observedAt: context.observedAt,
    },
    strength: "exact",
    status: "active",
    attributes: safeJsonValue(input.attributes ?? {}),
  };
}

export function createLiteralFact(
  context: ExtractorContext,
  input: {
    subject: RepositoryEntity;
    predicate: FactPredicate;
    object: LiteralValue;
    source: SourceOffsets;
    attributes?: JsonObject;
  },
): FactRecord {
  return {
    kind: "fact",
    id: factIdentity(context, { ...input, kind: "fact" }),
    snapshotId: context.input.snapshotId,
    subject: input.subject,
    predicate: input.predicate,
    object: safeJsonValue(input.object),
    source: createSourceSpan(context, input.source),
    provenance: {
      extractorId: context.extractorId,
      extractorVersion: context.extractorVersion,
      method: context.method,
      observedAt: context.observedAt,
    },
    strength: "exact",
    status: "active",
    attributes: safeJsonValue(input.attributes ?? {}),
  };
}

export function limitation(
  extractorId: string,
  extractorVersion: string,
  code: ExtractionLimitation["code"],
  message: string,
): ExtractionLimitation {
  return { extractorId, extractorVersion, code, message };
}
