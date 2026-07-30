import type {
  FactRecord,
  RepositoryEntity,
  RepositorySnapshot,
} from "../contracts/index.js";

export const REFERENCE_OBJECT_PREDICATES: ReadonlySet<string> = new Set([
  "calls",
  "exports",
  "imports",
  "re_exports",
  "renders",
  "tests",
]);

export const FILE_DEFINITION_PREDICATES: ReadonlySet<string> = new Set([
  "contains",
  "defines_endpoint",
  "defines_route",
]);

const REFERENCE_ONLY_ATTRIBUTE_KEYS = [
  "bindingKind",
  "importedName",
  "localName",
  "moduleSpecifier",
  "referenceKind",
  "typeOnly",
] as const;

export function hasReferenceOnlyEntitySemantics(
  entity: RepositoryEntity,
): boolean {
  const attributes = entity.attributes;
  return attributes !== undefined && REFERENCE_ONLY_ATTRIBUTE_KEYS.some(
    (key) => Object.hasOwn(attributes, key),
  );
}

export function isAllowedFilelessReferenceObject(input: {
  entity: RepositoryEntity;
  predicate: string;
}): boolean {
  if (input.entity.fileId !== undefined) return false;
  if (input.entity.kind === "external_dependency") {
    return input.predicate === "configures";
  }
  return REFERENCE_OBJECT_PREDICATES.has(input.predicate) &&
    hasReferenceOnlyEntitySemantics(input.entity);
}

export function isFileBackedDefinitionFact(input: {
  fact: FactRecord;
  snapshot: RepositorySnapshot;
  predicate: string;
}): input is typeof input & {
  fact: Extract<FactRecord, { kind: "relation" }>;
} {
  const { fact, snapshot, predicate } = input;
  if (
    fact.kind !== "relation" ||
    fact.predicate !== predicate ||
    !FILE_DEFINITION_PREDICATES.has(predicate) ||
    fact.source.kind !== "source_span" ||
    fact.subject.fileId !== fact.source.fileId ||
    fact.object.fileId === undefined ||
    fact.object.fileId !== fact.source.fileId ||
    fact.object.snapshotId !== snapshot.id ||
    hasReferenceOnlyEntitySemantics(fact.object)
  ) {
    return false;
  }
  const file = snapshot.files.find((candidate) => candidate.id === fact.object.fileId);
  return file !== undefined &&
    file.id === fact.source.fileId &&
    file.normalizedPath === fact.source.path;
}
