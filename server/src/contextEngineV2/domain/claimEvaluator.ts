import type {
  ClaimRecord,
  EvidenceRecord,
  EvidenceRequirement,
  EvidenceStrength,
  FactRecord,
} from "../contracts/index.js";
import { isJsonSafeValue } from "./invariant.js";
import { containsSecretLikeSemanticValue } from "./semanticLiteralSafety.js";
import {
  assertEvidenceEvaluationConsistency,
  assertFactEvaluationConsistency,
} from "./evaluationInvariants.js";
import {
  evaluateEvidenceRequirement,
  type EvidenceRequirementEvaluation,
} from "./evidenceRequirementEvaluator.js";
import {
  InvestigationDomainError,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  indexDomainRecordsById,
  sortedUnique,
  stableCompare,
} from "./investigationDomainSupport.js";
import {
  assertValidatedDomainContext,
  type ValidatedDomainContext,
} from "./validatedDomainContext.js";

const CLAIM_FIELDS = [
  "id",
  "snapshotId",
  "type",
  "statement",
  "subject",
  "object",
  "supportingEvidenceIds",
  "contradictingEvidenceIds",
  "status",
  "derivation",
] as const;
const CLAIM_REQUIRED_FIELDS = CLAIM_FIELDS.filter(
  (field) => field !== "subject" && field !== "object",
);
const DERIVATION_FIELDS = ["ruleId", "ruleVersion", "inputFactIds"] as const;
const CLAIM_TYPES = new Set([
  "implementation_owner",
  "supporting_context",
  "behavior",
  "data_flow",
  "route_flow",
  "state_flow",
  "configuration",
  "test_coverage",
  "absence",
  "risk",
  "custom",
]);
const CLAIM_STATUSES = new Set([
  "proposed",
  "supported",
  "rejected",
  "contradicted",
  "unresolved",
]);
const ENTITY_FIELDS = [
  "id",
  "snapshotId",
  "kind",
  "displayName",
  "canonicalName",
  "fileId",
  "attributes",
] as const;
const ENTITY_KINDS = new Set([
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

function validateClaimEntity(value: ClaimRecord["subject"], snapshotId: string): void {
  if (!value) return;
  assertClosedRecord(
    value,
    ENTITY_FIELDS,
    ["id", "snapshotId", "kind", "displayName"],
    "Claim entity",
  );
  assertPortableIdentifier(value.id, "Claim entity id");
  assertSafeText(value.displayName, "Claim entity display name");
  if (value.snapshotId !== snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Claim entity belongs to another snapshot.",
    );
  }
  if (!ENTITY_KINDS.has(value.kind)) {
    throw new InvestigationDomainError("invalid_record", "Claim entity kind is not supported.");
  }
  if (value.canonicalName !== undefined) {
    assertSafeText(value.canonicalName, "Claim entity canonical name");
  }
  if (value.fileId !== undefined) {
    assertPortableIdentifier(value.fileId, "Claim entity file id");
  }
  if (
    value.attributes !== undefined &&
    !isJsonSafeValue(value.attributes)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Claim entity attributes must be JSON-safe.",
    );
  }
  if (containsSecretLikeSemanticValue(value)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Secret-like claim entity values cannot be evaluated.",
    );
  }
}

function validateClaimObject(value: ClaimRecord["object"], snapshotId: string): void {
  if (!value) return;
  if ("snapshotId" in value) {
    validateClaimEntity(value, snapshotId);
    return;
  }
  assertClosedRecord(value, ["type", "value"], ["type", "value"], "Claim literal");
  const valid =
    (value.type === "string" && typeof value.value === "string") ||
    (value.type === "number" &&
      typeof value.value === "number" &&
      Number.isFinite(value.value)) ||
    (value.type === "boolean" && typeof value.value === "boolean") ||
    (value.type === "null" && value.value === null) ||
    (value.type === "json" && isJsonSafeValue(value.value));
  if (!valid || containsSecretLikeSemanticValue(value)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Claim literal is malformed or contains secret-like semantic data.",
    );
  }
}
const STRENGTH_ORDER: Readonly<Record<EvidenceStrength, number>> = {
  lead: 0,
  corroborating: 1,
  substantial: 2,
  conclusive: 3,
};

export interface ClaimEvaluation {
  claim: ClaimRecord;
  requirements: EvidenceRequirementEvaluation[];
  allRequiredSatisfied: boolean;
  currentSupportingEvidenceIds: EvidenceRecord["id"][];
  currentContradictingEvidenceIds: EvidenceRecord["id"][];
  hypothesisDisposition: "supported" | "rejected" | "open" | "unresolved";
  limitations: string[];
}

export interface ClaimEvaluationInput {
  claim: ClaimRecord;
  evidence: readonly EvidenceRecord[];
  facts: readonly FactRecord[];
  requirements: readonly EvidenceRequirement[];
  boundedAbsenceEvidenceIds?: readonly EvidenceRecord["id"][];
}

function validateClaim(
  claim: ClaimRecord,
  evidence: readonly EvidenceRecord[],
  facts?: readonly FactRecord[],
  validatedContext?: ValidatedDomainContext,
): void {
  assertClosedRecord(claim, CLAIM_FIELDS, CLAIM_REQUIRED_FIELDS, "Claim record");
  assertPortableIdentifier(claim.id, "Claim id");
  assertPortableIdentifier(claim.snapshotId, "Claim snapshot id");
  assertSafeText(claim.statement, "Claim statement");
  if (!CLAIM_TYPES.has(claim.type)) {
    throw new InvestigationDomainError("invalid_record", "Claim type is not supported.");
  }
  if (!CLAIM_STATUSES.has(claim.status)) {
    throw new InvestigationDomainError("invalid_record", "Claim status is not supported.");
  }
  assertSortedUniqueStrings(
    claim.supportingEvidenceIds,
    "Claim supporting evidence ids",
  );
  assertSortedUniqueStrings(
    claim.contradictingEvidenceIds,
    "Claim contradicting evidence ids",
  );
  assertClosedRecord(
    claim.derivation,
    DERIVATION_FIELDS,
    DERIVATION_FIELDS,
    "Claim derivation",
  );
  assertPortableIdentifier(claim.derivation.ruleId, "Claim derivation rule id");
  assertPortableIdentifier(
    claim.derivation.ruleVersion,
    "Claim derivation rule version",
  );
  assertSortedUniqueStrings(
    claim.derivation.inputFactIds,
    "Claim derivation input fact ids",
  );
  if (facts !== undefined) {
    const factsById = validatedContext?.factsById ??
      indexDomainRecordsById(facts, "Claim evaluation fact");
    for (const factId of claim.derivation.inputFactIds) {
      const fact = factsById.get(factId);
      if (!fact) {
        throw new InvestigationDomainError(
          "unknown_reference",
          "Claim derivation references an unknown fact.",
        );
      }
      if (fact.snapshotId !== claim.snapshotId) {
        throw new InvestigationDomainError(
          "snapshot_mismatch",
          "Claim derivation fact belongs to another snapshot.",
        );
      }
    }
  }
  validateClaimEntity(claim.subject, claim.snapshotId);
  validateClaimObject(claim.object, claim.snapshotId);
  const evidenceById = validatedContext?.evidenceById ??
    indexDomainRecordsById(evidence, "Claim evaluation evidence");
  for (const id of [
    ...claim.supportingEvidenceIds,
    ...claim.contradictingEvidenceIds,
  ]) {
    const record = evidenceById.get(id);
    if (!record) {
      throw new InvestigationDomainError(
        "unknown_reference",
        "Claim references unknown evidence.",
      );
    }
    if (
      record.snapshotId !== claim.snapshotId ||
      (record.claimId !== undefined && record.claimId !== claim.id)
    ) {
      throw new InvestigationDomainError(
        "snapshot_mismatch",
        "Claim evidence belongs to another claim or snapshot.",
      );
    }
  }
}

export function assertClaimLedgerConsistency(input: {
  claim: ClaimRecord;
  evidence: readonly EvidenceRecord[];
  snapshotId: ClaimRecord["snapshotId"];
}): void {
  const safeInput = cloneDomainValue(input);
  if (safeInput.claim.snapshotId !== safeInput.snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Evaluated claim belongs to another snapshot.",
    );
  }
  validateClaim(safeInput.claim, safeInput.evidence);
}

export function evaluateClaim(
  rawInput: ClaimEvaluationInput,
  checkpoint?: () => void,
  validatedContext?: ValidatedDomainContext,
): ClaimEvaluation {
  checkpoint?.();
  if (validatedContext) assertValidatedDomainContext(validatedContext);
  if (
    validatedContext &&
    rawInput.claim.snapshotId !== validatedContext.snapshotId
  ) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Evaluated claim belongs to another validated snapshot.",
    );
  }
  validatedContext?.assertCanonical({
    facts: rawInput.facts,
    evidence: rawInput.evidence,
  });
  const input = cloneDomainValue(rawInput);
  const evidenceById = validatedContext?.evidenceById ??
    indexDomainRecordsById(input.evidence, "Claim evaluation evidence");
  const factsById = validatedContext?.factsById ??
    indexDomainRecordsById(input.facts, "Claim evaluation fact");
  const evidence = validatedContext?.evidence ?? [...evidenceById.values()];
  const facts = validatedContext?.facts ?? [...factsById.values()];
  if (!validatedContext) {
    facts.forEach((fact) => {
      checkpoint?.();
      assertFactEvaluationConsistency({
        fact,
        snapshotId: input.claim.snapshotId,
      });
    });
    evidence.forEach((record) => {
      checkpoint?.();
      assertEvidenceEvaluationConsistency({
        evidence: record,
        facts,
        snapshotId: input.claim.snapshotId,
      }, checkpoint);
    });
  }
  checkpoint?.();
  validateClaim(input.claim, evidence, facts, validatedContext);
  const claim = cloneDomainValue(input.claim);
  const supporting = claim.supportingEvidenceIds
    .map((id) => evidenceById.get(id))
    .filter((record): record is EvidenceRecord => Boolean(record));
  const contradicting = claim.contradictingEvidenceIds
    .map((id) => evidenceById.get(id))
    .filter((record): record is EvidenceRecord => Boolean(record));
  const requirements = [...input.requirements]
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((requirement) => {
      checkpoint?.();
      return evaluateEvidenceRequirement({
        requirement,
        evidence: supporting,
        facts,
        snapshotId: claim.snapshotId,
        role: "supports",
      }, validatedContext);
    });
  if (new Set(requirements.map((entry) => entry.requirementId)).size !== requirements.length) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Claim evidence requirement ids must be unique.",
    );
  }
  const allRequiredSatisfied = input.requirements.every((requirement) => {
    const evaluation = requirements.find(
      (candidate) => candidate.requirementId === requirement.id,
    );
    return !requirement.required || evaluation?.satisfied === true;
  });
  const currentSupporting = supporting.filter(
    (record) => record.freshness.current && record.role === "supports",
  );
  const currentContradicting = contradicting.filter(
    (record) =>
      record.freshness.current &&
      record.role === "contradicts" &&
      STRENGTH_ORDER[record.strength] >= STRENGTH_ORDER.substantial,
  );
  const hasGroundedSupport = currentSupporting.some(
    (record) => record.strength !== "lead" && record.role === "supports",
  );
  const boundedAbsenceIds = new Set(input.boundedAbsenceEvidenceIds ?? []);
  const absenceIsBounded =
    claim.type !== "absence" ||
    currentSupporting.some((record) => boundedAbsenceIds.has(record.id));
  const hasConclusiveContradiction = currentContradicting.some(
    (record) => record.strength === "conclusive",
  );

  let status: ClaimRecord["status"] = "unresolved";
  let hypothesisDisposition: ClaimEvaluation["hypothesisDisposition"] =
    "unresolved";
  if (hasConclusiveContradiction) {
    status = "rejected";
    hypothesisDisposition = "rejected";
  } else if (currentContradicting.length > 0) {
    status = "contradicted";
    hypothesisDisposition = "open";
  } else if (allRequiredSatisfied && hasGroundedSupport && absenceIsBounded) {
    status = "supported";
    hypothesisDisposition = "supported";
  }

  const limitations = sortedUnique([
    ...requirements.flatMap((evaluation) => evaluation.limitations),
    ...(!hasGroundedSupport ? ["grounded_support_missing"] : []),
    ...(!absenceIsBounded ? ["bounded_absence_evidence_missing"] : []),
    ...(currentContradicting.length > 0 ? ["current_contradicting_evidence"] : []),
  ]);
  claim.status = status;
  claim.supportingEvidenceIds = sortedUnique(claim.supportingEvidenceIds);
  claim.contradictingEvidenceIds = sortedUnique(claim.contradictingEvidenceIds);
  return {
    claim,
    requirements,
    allRequiredSatisfied,
    currentSupportingEvidenceIds: currentSupporting
      .map((record) => record.id)
      .sort(stableCompare),
    currentContradictingEvidenceIds: currentContradicting
      .map((record) => record.id)
      .sort(stableCompare),
    hypothesisDisposition,
    limitations,
  };
}
