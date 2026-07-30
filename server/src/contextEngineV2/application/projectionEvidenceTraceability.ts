import type {
  EvidenceRecord,
  ExplicitTargetConstraint,
  FactRecord,
  Finding,
  RepositoryEntity,
  RepositorySnapshot,
} from "../contracts/index.js";
import { stableCompare } from "../domain/investigationDomainSupport.js";
import { buildStrictBoundedRelationshipChains } from "./strictRelationshipChain.js";
const DIRECT_FILE_FINDINGS = new Set<Finding["type"]>([
  "behavior_summary",
  "constraint",
  "risk",
  "supporting_context",
]);

export interface ProjectionEvidenceTraceability {
  evidence: EvidenceRecord[];
  definitionFactIds: FactRecord["id"][];
  explicitEntityTarget: boolean;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function factEntities(fact: FactRecord): RepositoryEntity[] {
  return fact.kind === "relation" ? [fact.subject, fact.object] : [fact.subject];
}

function isDefinitionForEntity(
  fact: FactRecord,
  entity: RepositoryEntity,
  snapshot: RepositorySnapshot,
): boolean {
  if (
    fact.kind !== "relation" ||
    fact.status !== "active" ||
    fact.snapshotId !== snapshot.id ||
    fact.predicate !== "contains" ||
    fact.object.id !== entity.id ||
    entity.fileId === undefined ||
    fact.object.fileId !== entity.fileId ||
    fact.source.kind !== "source_span" ||
    fact.source.fileId !== entity.fileId
  ) {
    return false;
  }
  const file = snapshot.files.find((entry) => entry.id === entity.fileId);
  return Boolean(
    file &&
    fact.source.path === file.normalizedPath &&
    fact.source.contentFingerprint === file.contentFingerprint,
  );
}

function hasStrictPathToDefinition(
  starts: readonly FactRecord[],
  definitions: readonly FactRecord[],
  allFacts: readonly FactRecord[],
): boolean {
  return definitions.some((definition) =>
    definition.kind === "relation" && starts.some((start) =>
      buildStrictBoundedRelationshipChains({
        origins: [start],
        facts: allFacts,
        candidateFact: definition,
      }).some((chain) => chain.length > 1)));
}

function isFileBackedDefinition(
  fact: FactRecord,
  snapshot: RepositorySnapshot,
): fact is Extract<FactRecord, { kind: "relation" }> {
  if (
    fact.kind !== "relation" ||
    fact.status !== "active" ||
    fact.snapshotId !== snapshot.id ||
    fact.predicate !== "contains" ||
    fact.object.fileId === undefined ||
    fact.source.kind !== "source_span" ||
    fact.source.fileId !== fact.object.fileId
  ) {
    return false;
  }
  const file = snapshot.files.find((entry) => entry.id === fact.object.fileId);
  return Boolean(
    file &&
    fact.source.path === file.normalizedPath &&
    fact.source.contentFingerprint === file.contentFingerprint,
  );
}

function explicitTargetMatchesEntity(input: {
  entity: RepositoryEntity;
  snapshot: RepositorySnapshot;
  explicitTargets: readonly ExplicitTargetConstraint[];
  factsById: ReadonlyMap<FactRecord["id"], FactRecord>;
}): boolean {
  const entityFileId = input.entity.fileId ??
    (input.entity.kind === "file" ? input.entity.id : undefined);
  const file = entityFileId === undefined
    ? undefined
    : input.snapshot.files.find((entry) => entry.id === entityFileId);
  return input.explicitTargets.some((target) => {
    if (target.kind === "path") {
      return file !== undefined && normalizePath(target.path) === normalizePath(file.normalizedPath);
    }
    if (target.symbol !== input.entity.displayName && target.symbol !== input.entity.canonicalName) {
      return false;
    }
    const definitions = [...input.factsById.values()].flatMap((fact) =>
      isFileBackedDefinition(fact, input.snapshot) && fact.kind === "relation" &&
        (fact.object.displayName === target.symbol || fact.object.canonicalName === target.symbol)
        ? [fact.object]
        : []);
    const distinctDefinitions = new Map(definitions.map((entity) => [entity.id, entity]));
    return distinctDefinitions.size === 1 && distinctDefinitions.has(input.entity.id);
  });
}

function spanMatchesEntityFile(
  record: EvidenceRecord,
  entity: RepositoryEntity,
  snapshot: RepositorySnapshot,
): boolean {
  const entityFileId = entity.fileId ?? (entity.kind === "file" ? entity.id : undefined);
  if (entityFileId === undefined) return false;
  const file = snapshot.files.find((entry) => entry.id === entityFileId);
  return Boolean(file && record.sourceSpans.some((span) =>
    span.snapshotId === snapshot.id &&
    span.fileId === file.id &&
    span.path === file.normalizedPath &&
    span.contentFingerprint === file.contentFingerprint));
}

export function evaluateProjectionEvidenceForEntity(input: {
  finding: Finding;
  entity: RepositoryEntity;
  evidence: readonly EvidenceRecord[];
  factsById: ReadonlyMap<FactRecord["id"], FactRecord>;
  snapshot: RepositorySnapshot;
  explicitTargets: readonly ExplicitTargetConstraint[];
}): ProjectionEvidenceTraceability {
  const evidenceById = new Map(input.evidence.map((record) => [record.id, record]));
  const referencedEvidence = input.finding.evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((record): record is EvidenceRecord => record !== undefined);
  const proofFacts = [...new Map(referencedEvidence
    .flatMap((record) => record.factIds)
    .map((id) => [id, input.factsById.get(id)] as const)
    .filter((entry): entry is readonly [FactRecord["id"], FactRecord] => entry[1] !== undefined))
    .values()]
    .filter((fact) => fact.status === "active" && fact.snapshotId === input.snapshot.id)
    .sort((left, right) => stableCompare(left.id, right.id));
  const definitionFacts = proofFacts.filter((fact) =>
    isDefinitionForEntity(fact, input.entity, input.snapshot));
  const explicitEntityTarget = explicitTargetMatchesEntity({
    entity: input.entity,
    snapshot: input.snapshot,
    explicitTargets: input.explicitTargets,
    factsById: input.factsById,
  });
  const requiresDefinition =
    input.finding.type === "implementation_target" || input.finding.type === "test_target";
  const connectedDefinitionIds = new Set(definitionFacts
    .filter((definition) => proofFacts.some((fact) =>
      fact.id !== definition.id &&
      hasStrictPathToDefinition([fact], [definition], proofFacts)))
    .map((definition) => definition.id));
  const traceable = referencedEvidence.filter((record) => {
    const recordFacts = record.factIds
      .map((id) => input.factsById.get(id))
      .filter((fact): fact is FactRecord =>
        fact !== undefined && fact.status === "active" && fact.snapshotId === input.snapshot.id);
    if (recordFacts.length > 0) {
      const directlyReferencesEntity = recordFacts.some((fact) =>
        factEntities(fact).some((factEntity) => factEntity.id === input.entity.id));
      if (requiresDefinition) {
        const directDefinition = recordFacts.some((fact) =>
          definitionFacts.some((definition) => definition.id === fact.id) &&
          (explicitEntityTarget || connectedDefinitionIds.has(fact.id)));
        return definitionFacts.length > 0 &&
          (directDefinition || hasStrictPathToDefinition(recordFacts, definitionFacts, proofFacts));
      }
      return directlyReferencesEntity ||
        (definitionFacts.length > 0 && hasStrictPathToDefinition(recordFacts, definitionFacts, proofFacts));
    }
    if (!spanMatchesEntityFile(record, input.entity, input.snapshot)) return false;
    if (requiresDefinition) return explicitEntityTarget;
    return DIRECT_FILE_FINDINGS.has(input.finding.type);
  });
  const traceableSupport = traceable.some((record) =>
    record.role === "supports" && record.strength !== "lead");
  const rejectedSupport = referencedEvidence.some((record) =>
    record.role === "supports" &&
    record.strength !== "lead" &&
    !traceable.some((candidate) => candidate.id === record.id));
  return {
    evidence: requiresDefinition && rejectedSupport && !traceableSupport
      ? []
      : traceable.sort((left, right) => stableCompare(left.id, right.id)),
    definitionFactIds: definitionFacts.map((fact) => fact.id),
    explicitEntityTarget,
  };
}
