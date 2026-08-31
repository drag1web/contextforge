import type {
  EntityKind,
  EvidenceRecord,
  EvidenceRequirement,
  EvidenceStrength,
  FactRecord,
  SnapshotId,
} from "../contracts/index.js";
import {
  assertEvidenceEvaluationConsistency,
  assertFactEvaluationConsistency,
} from "./evaluationInvariants.js";
import {
  InvestigationDomainError,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeInteger,
  assertSafeText,
  cloneDomainValue,
  indexDomainRecordsById,
  sortedUnique,
  stableCompare,
  stableSerialize,
} from "./investigationDomainSupport.js";
import {
  assertValidatedDomainContext,
  type ValidatedDomainContext,
} from "./validatedDomainContext.js";

const STRENGTH_ORDER: Readonly<Record<EvidenceStrength, number>> = {
  lead: 0,
  corroborating: 1,
  substantial: 2,
  conclusive: 3,
};
const REQUIREMENT_FIELDS = [
  "id",
  "description",
  "acceptedFactPredicates",
  "acceptedEntityKinds",
  "minimumStrength",
  "minimumIndependentGroups",
  "required",
] as const;
const ENTITY_KINDS = new Set<EntityKind>([
  "repository",
  "file",
  "directory",
  "module",
  "symbol",
  "function",
  "class",
  "interface",
  "type",
  "component",
  "route",
  "endpoint",
  "configuration_key",
  "database_entity",
  "state_store",
  "event",
  "test_case",
  "external_dependency",
  "literal",
  "unknown",
]);

export interface EvidenceRequirementEvaluation {
  requirementId: string;
  satisfied: boolean;
  matchedEvidenceIds: EvidenceRecord["id"][];
  independentGroups: string[];
  missingIndependentGroups: number;
  limitations: string[];
}

export interface EvidenceRequirementEvaluationInput {
  requirement: EvidenceRequirement;
  evidence: readonly EvidenceRecord[];
  facts: readonly FactRecord[];
  snapshotId?: SnapshotId;
  role?: "supports" | "contradicts";
}

function validateStringSet(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${field} must contain non-empty strings.`,
    );
  }
  return sortedUnique(value);
}

function validateRequirement(requirement: EvidenceRequirement): void {
  assertClosedRecord(
    requirement,
    REQUIREMENT_FIELDS,
    [
      "id",
      "description",
      "minimumStrength",
      "minimumIndependentGroups",
      "required",
    ],
    "Evidence requirement",
  );
  assertPortableIdentifier(requirement.id, "Evidence requirement id");
  assertSafeText(requirement.description, "Evidence requirement description");
  if (!(requirement.minimumStrength in STRENGTH_ORDER)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Evidence requirement strength is not supported.",
    );
  }
  assertSafeInteger(
    requirement.minimumIndependentGroups,
    "Evidence minimum independent groups",
  );
  if (typeof requirement.required !== "boolean") {
    throw new InvestigationDomainError(
      "invalid_record",
      "Evidence requirement required flag must be boolean.",
    );
  }
  validateStringSet(
    requirement.acceptedFactPredicates,
    "Accepted fact predicates",
  );
  const kinds = validateStringSet(
    requirement.acceptedEntityKinds,
    "Accepted entity kinds",
  );
  if (kinds?.some((kind) => !ENTITY_KINDS.has(kind as EntityKind))) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Evidence requirement entity kind is not supported.",
    );
  }
}

function factMatches(
  fact: FactRecord,
  predicates: readonly string[] | undefined,
  entityKinds: readonly string[] | undefined,
): boolean {
  if (fact.status !== "active") return false;
  if (predicates && !predicates.includes(fact.predicate)) return false;
  if (entityKinds) {
    const kinds = [fact.subject.kind];
    if (fact.kind === "relation") kinds.push(fact.object.kind);
    if (!kinds.some((kind) => entityKinds.includes(kind))) return false;
  }
  return true;
}

export function evaluateEvidenceRequirement(
  rawInput: EvidenceRequirementEvaluationInput,
  validatedContext?: ValidatedDomainContext,
): EvidenceRequirementEvaluation {
  if (validatedContext) {
    assertValidatedDomainContext(validatedContext);
    validatedContext.assertCanonical({ facts: rawInput.facts });
    validatedContext.assertCanonicalEvidenceMembers(rawInput.evidence);
    if (
      rawInput.snapshotId !== undefined &&
      rawInput.snapshotId !== validatedContext.snapshotId
    ) {
      throw new InvestigationDomainError(
        "snapshot_mismatch",
        "Evidence requirement context belongs to another snapshot.",
      );
    }
  }
  const input = cloneDomainValue(rawInput);
  validateRequirement(input.requirement);
  const requirement = cloneDomainValue(input.requirement);
  if (
    input.role !== undefined &&
    input.role !== "supports" &&
    input.role !== "contradicts"
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Evidence requirement evaluation role is not supported.",
    );
  }
  const evidenceById = validatedContext
    ? new Map(input.evidence.map((record) => [record.id, record]))
    : indexDomainRecordsById(input.evidence, "Evidence requirement evidence");
  const factsById = validatedContext?.factsById ??
    indexDomainRecordsById(input.facts, "Evidence requirement fact");
  const evidence = [...evidenceById.values()];
  const facts = validatedContext?.facts ?? [...factsById.values()];
  if (!validatedContext) {
    facts.forEach((fact) =>
      assertFactEvaluationConsistency({
        fact,
        snapshotId: input.snapshotId ?? fact.snapshotId,
      }),
    );
  }
  const factSnapshotIds = sortedUnique(
    facts.map((fact) => fact.snapshotId),
  );
  if (factSnapshotIds.length > 1) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Evidence requirement facts cannot mix snapshots.",
    );
  }
  const snapshotId = input.snapshotId ?? factSnapshotIds[0];
  if (
    input.snapshotId !== undefined &&
    factSnapshotIds.some((candidate) => candidate !== input.snapshotId)
  ) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Evidence requirement facts belong to another snapshot.",
    );
  }
  if (evidence.length > 0 && snapshotId === undefined) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Evidence requirement evaluation requires a snapshot context.",
    );
  }
  if (snapshotId !== undefined && !validatedContext) {
    evidence.forEach((record) =>
      assertEvidenceEvaluationConsistency({
        evidence: record,
        facts,
        snapshotId,
      }),
    );
  }
  const role = input.role ?? "supports";
  const predicates = validateStringSet(
    requirement.acceptedFactPredicates,
    "Accepted fact predicates",
  );
  const kinds = validateStringSet(
    requirement.acceptedEntityKinds,
    "Accepted entity kinds",
  );

  const eligible = evidence
    .filter(
      (record) =>
        record.role === role &&
        record.freshness.current &&
        STRENGTH_ORDER[record.strength] >=
          STRENGTH_ORDER[requirement.minimumStrength] &&
        record.factIds.some((factId) => {
          const fact = factsById.get(factId);
          return fact ? factMatches(fact, predicates, kinds) : false;
        }),
    )
    .sort((left, right) => stableCompare(left.id, right.id));

  const groups = new Map<string, EvidenceRecord>();
  const sourceChains = new Set<string>();
  for (const record of eligible) {
    const sourceChain = stableSerialize({
      factIds: [...record.factIds].sort(stableCompare),
      sourceSpans: [...record.sourceSpans]
        .map(stableSerialize)
        .sort(stableCompare),
    });
    if (sourceChains.has(sourceChain) || groups.has(record.independenceGroup)) {
      continue;
    }
    sourceChains.add(sourceChain);
    groups.set(record.independenceGroup, record);
  }

  const independentGroups = [...groups.keys()].sort(stableCompare);
  const matchedEvidenceIds = [...groups.values()]
    .map((record) => record.id)
    .sort(stableCompare);
  const missingIndependentGroups = Math.max(
    0,
    requirement.minimumIndependentGroups - independentGroups.length,
  );
  return {
    requirementId: requirement.id,
    satisfied: missingIndependentGroups === 0,
    matchedEvidenceIds,
    independentGroups,
    missingIndependentGroups,
    limitations:
      missingIndependentGroups === 0
        ? []
        : ["required_independent_evidence_groups_missing"],
  };
}
