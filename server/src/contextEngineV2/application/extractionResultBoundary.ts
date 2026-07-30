import type {
  FactRecord,
  InvestigationOperation,
  InvestigationRequest,
  RepositoryEntity,
  RepositorySnapshot,
  SourceSpan,
} from "../contracts/index.js";
import {
  assertFactSnapshotConsistency,
} from "../domain/invariant.js";
import {
  assertEntityEvaluationConsistency,
  assertFactEvaluationConsistency,
} from "../domain/evaluationInvariants.js";
import { assertRepositoryEntitySnapshotConsistency } from "../domain/knowledgeGraphInvariant.js";
import {
  assertDescriptorSafeDomainValue,
  assertDescriptorSafeFactRecord,
  assertDescriptorSafeRepositoryEntityRecord,
} from "../domain/rawRecordPreflight.js";
import {
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  cloneDomainValue,
  indexDomainRecordsById,
  sameDomainRecord,
} from "../domain/investigationDomainSupport.js";
import type {
  ExtractionLimitation,
  ExtractionResult,
  ExtractorInput,
} from "../ports/factExtractorPort.js";
import {
  FILE_DEFINITION_PREDICATES,
  REFERENCE_OBJECT_PREDICATES,
  isAllowedFilelessReferenceObject,
  isFileBackedDefinitionFact,
} from "./entityRolePolicy.js";
import { pathMatchesNegativeConstraints } from "./negativeConstraintMatcher.js";

const EXTRACTION_RESULT_FIELDS = ["entities", "facts", "limitations"] as const;
const LIMITATION_FIELDS = [
  "extractorId",
  "extractorVersion",
  "code",
  "message",
] as const;
const LIMITATION_CODES = new Set<ExtractionLimitation["code"]>([
  "unsupported_language",
  "syntax_error",
  "partial_parse",
  "unsupported_construct",
  "malformed_manifest",
  "extractor_failure",
]);
const FILELESS_REFERENCE_KINDS = new Set<RepositoryEntity["kind"]>([
  "component",
  "external_dependency",
  "module",
  "symbol",
]);

class ExtractionResultBoundaryError extends Error {
  constructor() {
    super("Fact extraction output failed the authorized input boundary.");
    this.name = "ExtractionResultBoundaryError";
  }
}

function fail(): never {
  throw new ExtractionResultBoundaryError();
}

function assertFilelessReferenceEntity(entity: RepositoryEntity): void {
  if (!FILELESS_REFERENCE_KINDS.has(entity.kind)) fail();
  if (entity.kind === "external_dependency") return;
  const attributes = entity.attributes;
  if (
    attributes === undefined ||
    (typeof attributes.moduleSpecifier !== "string" &&
      attributes.referenceKind !== "unresolved_syntax_reference")
  ) {
    fail();
  }
}

function assertEntityBoundToInput(input: {
  entity: RepositoryEntity;
  extractorInput: ExtractorInput;
  snapshot: RepositorySnapshot;
}): void {
  assertDescriptorSafeRepositoryEntityRecord(input.entity);
  assertEntityEvaluationConsistency({
    entity: input.entity,
    snapshotId: input.extractorInput.snapshotId,
  });
  assertRepositoryEntitySnapshotConsistency(input.entity, input.snapshot);
  if (input.entity.fileId === undefined) {
    assertFilelessReferenceEntity(input.entity);
  } else if (input.entity.fileId !== input.extractorInput.fileId) {
    fail();
  }
}

function assertSourceSpanBoundToContent(
  source: SourceSpan,
  extractorInput: ExtractorInput,
): void {
  if (
    source.snapshotId !== extractorInput.snapshotId ||
    source.fileId !== extractorInput.fileId ||
    source.path !== extractorInput.path ||
    source.contentFingerprint !== extractorInput.contentFingerprint
  ) {
    fail();
  }
  const lines = extractorInput.content.split(/\r\n|\n|\r/u);
  if (source.startLine > lines.length || source.endLine > lines.length) fail();
  const startLine = lines[source.startLine - 1];
  const endLine = lines[source.endLine - 1];
  if (
    startLine === undefined ||
    endLine === undefined ||
    source.startColumn > startLine.length + 1 ||
    source.endColumn > endLine.length + 1
  ) {
    fail();
  }
}

function assertFactBoundToInput(input: {
  fact: FactRecord;
  extractorInput: ExtractorInput;
  snapshot: RepositorySnapshot;
}): void {
  assertDescriptorSafeFactRecord(input.fact);
  if (Object.hasOwn(input.fact.provenance, "operationId")) fail();
  assertFactEvaluationConsistency({
    fact: input.fact,
    snapshotId: input.extractorInput.snapshotId,
  });
  assertFactSnapshotConsistency(input.fact, input.snapshot);
  if (input.fact.source.kind !== "source_span") fail();
  assertSourceSpanBoundToContent(input.fact.source, input.extractorInput);
  assertEntityBoundToInput({
    entity: input.fact.subject,
    extractorInput: input.extractorInput,
    snapshot: input.snapshot,
  });
  if (input.fact.subject.fileId !== input.extractorInput.fileId) fail();
  if (input.fact.kind === "relation") {
    assertEntityBoundToInput({
      entity: input.fact.object,
      extractorInput: input.extractorInput,
      snapshot: input.snapshot,
    });
    if (
      FILE_DEFINITION_PREDICATES.has(input.fact.predicate) &&
      !isFileBackedDefinitionFact({
        fact: input.fact,
        snapshot: input.snapshot,
        predicate: input.fact.predicate,
      })
    ) {
      fail();
    }
    if (
      input.fact.object.fileId === undefined &&
      !isAllowedFilelessReferenceObject({
        entity: input.fact.object,
        predicate: input.fact.predicate,
      })
    ) {
      fail();
    }
  }
}

function assertFilelessReferenceConsistency(result: ExtractionResult): void {
  const entitiesById = indexDomainRecordsById(
    result.entities,
    "Extraction result entity",
  );
  for (const fact of result.facts) {
    if (fact.subject.fileId === undefined) fail();
    if (fact.kind !== "relation") continue;
    const declared = entitiesById.get(fact.object.id);
    if (
      (fact.object.fileId === undefined ||
        FILE_DEFINITION_PREDICATES.has(fact.predicate)) &&
      (declared === undefined || !sameDomainRecord(declared, fact.object))
    ) {
      fail();
    }
    if (fact.object.fileId !== undefined) continue;
    if (!isAllowedFilelessReferenceObject({
      entity: fact.object,
      predicate: fact.predicate,
    })) {
      fail();
    }
  }
  for (const entity of entitiesById.values()) {
    if (entity.fileId !== undefined || entity.kind === "external_dependency") continue;
    const uses = result.facts.filter(
      (fact) => fact.kind === "relation" && fact.object.id === entity.id,
    );
    if (
      uses.length === 0 ||
      uses.some(
        (fact) =>
          !REFERENCE_OBJECT_PREDICATES.has(fact.predicate) ||
          !sameDomainRecord(fact.object, entity),
      )
    ) {
      fail();
    }
  }
}

function assertLimitation(limitation: ExtractionLimitation): void {
  assertClosedRecord(
    limitation,
    LIMITATION_FIELDS,
    LIMITATION_FIELDS,
    "Extraction limitation",
  );
  assertPortableIdentifier(limitation.extractorId, "Extraction limitation extractor id");
  assertPortableIdentifier(
    limitation.extractorVersion,
    "Extraction limitation extractor version",
  );
  if (!LIMITATION_CODES.has(limitation.code)) fail();
  assertSafeText(limitation.message, "Extraction limitation message");
}

function assertBoundResult(input: {
  result: unknown;
  extractorInput: ExtractorInput;
  operation: Extract<InvestigationOperation, { type: "parse_file" | "inspect_manifest" }>;
  snapshot: RepositorySnapshot;
  negativeConstraints: InvestigationRequest["negativeConstraints"];
}): asserts input is typeof input & { result: ExtractionResult } {
  assertDescriptorSafeDomainValue(input.result);
  assertClosedRecord(
    input.result,
    EXTRACTION_RESULT_FIELDS,
    EXTRACTION_RESULT_FIELDS,
    "Extraction result",
  );
  const result = input.result as unknown as ExtractionResult;
  if (
    !Array.isArray(result.entities) ||
    !Array.isArray(result.facts) ||
    !Array.isArray(result.limitations)
  ) {
    fail();
  }
  const file = input.snapshot.files.find(
    (candidate) => candidate.id === input.extractorInput.fileId,
  );
  if (
    input.operation.path !== input.extractorInput.path ||
    input.extractorInput.snapshotId !== input.snapshot.id ||
    file === undefined ||
    file.normalizedPath !== input.extractorInput.path ||
    file.contentFingerprint !== input.extractorInput.contentFingerprint ||
    !file.readable ||
    file.secretRisk === "known" ||
    pathMatchesNegativeConstraints(
      input.extractorInput.path,
      input.negativeConstraints,
    )
  ) {
    fail();
  }
  result.entities.forEach((entity) => assertEntityBoundToInput({
    entity,
    extractorInput: input.extractorInput,
    snapshot: input.snapshot,
  }));
  result.facts.forEach((fact) => assertFactBoundToInput({
    fact,
    extractorInput: input.extractorInput,
    snapshot: input.snapshot,
  }));
  result.limitations.forEach(assertLimitation);
  assertFilelessReferenceConsistency(result);
}

export function assertExtractionResultBoundToInput(input: {
  result: unknown;
  extractorInput: ExtractorInput;
  operation: Extract<InvestigationOperation, { type: "parse_file" | "inspect_manifest" }>;
  snapshot: RepositorySnapshot;
  negativeConstraints: InvestigationRequest["negativeConstraints"];
}): ExtractionResult {
  try {
    assertBoundResult(input);
    const cloned = cloneDomainValue(input.result);
    const clonedInput = { ...input, result: cloned };
    assertBoundResult(clonedInput);
    return cloned;
  } catch {
    fail();
  }
}
