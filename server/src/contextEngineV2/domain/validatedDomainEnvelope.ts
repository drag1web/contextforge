import type {
  ClaimRecord,
  EvidenceRecord,
  EvidenceRequirement,
  FactRecord,
  KnowledgeGap,
  SnapshotId,
} from "../contracts/index.js";
import {
  InvestigationDomainError,
  cloneDomainValue,
} from "./investigationDomainSupport.js";
import {
  assertValidatedDomainContext,
  type ValidatedDomainContext,
} from "./validatedDomainContext.js";

export interface ValidatedDomainEnvelopeDiagnostics {
  mutableEnvelopeClones: number;
  canonicalFactReferencesReused: number;
  canonicalEvidenceReferencesReused: number;
}

type DescriptorValues = ReadonlyMap<string, unknown>;

function invalidEnvelope(label: string): InvestigationDomainError {
  return new InvestigationDomainError(
    "invalid_record",
    `${label} failed descriptor-safe envelope validation.`,
  );
}

function inspectClosedEnvelope(
  value: unknown,
  allowedFields: readonly string[],
  requiredFields: readonly string[],
  label: string,
): DescriptorValues {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw invalidEnvelope(label);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidEnvelope(label);
    }
    const allowed = new Set(allowedFields);
    const values = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowed.has(key)) {
        throw invalidEnvelope(label);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        throw invalidEnvelope(label);
      }
      values.set(key, descriptor.value);
    }
    if (requiredFields.some((field) => !values.has(field))) {
      throw invalidEnvelope(label);
    }
    return values;
  } catch (error) {
    if (error instanceof InvestigationDomainError) throw error;
    throw invalidEnvelope(label);
  }
}

function inspectDenseArrayMembers<T>(value: unknown, label: string): readonly T[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      throw invalidEnvelope(label);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      throw invalidEnvelope(label);
    }
    const length = lengthDescriptor.value;
    const expectedKeys = new Set([
      "length",
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    if (
      Reflect.ownKeys(value).some(
        (key) => typeof key !== "string" || !expectedKeys.has(key),
      )
    ) {
      throw invalidEnvelope(label);
    }
    const members: T[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        throw invalidEnvelope(label);
      }
      members.push(descriptor.value as T);
    }
    return Object.freeze(members);
  } catch (error) {
    if (error instanceof InvestigationDomainError) throw error;
    throw invalidEnvelope(label);
  }
}

function cloneMutableFields<T>(
  values: DescriptorValues,
  fields: readonly string[],
  diagnostics?: ValidatedDomainEnvelopeDiagnostics,
): T {
  const mutableEnvelope: Record<string, unknown> = {};
  for (const field of fields) {
    if (values.has(field)) mutableEnvelope[field] = values.get(field);
  }
  if (diagnostics) diagnostics.mutableEnvelopeClones += 1;
  return cloneDomainValue(mutableEnvelope) as T;
}

function recordCanonicalReuse(
  diagnostics: ValidatedDomainEnvelopeDiagnostics | undefined,
  facts: number,
  evidence: number,
): void {
  if (!diagnostics) return;
  diagnostics.canonicalFactReferencesReused += facts;
  diagnostics.canonicalEvidenceReferencesReused += evidence;
}

export function createValidatedDomainEnvelopeDiagnostics(): ValidatedDomainEnvelopeDiagnostics {
  return {
    mutableEnvelopeClones: 0,
    canonicalFactReferencesReused: 0,
    canonicalEvidenceReferencesReused: 0,
  };
}

export function cloneValidatedClaimEvaluationEnvelope(
  rawInput: unknown,
  context: ValidatedDomainContext,
  diagnostics?: ValidatedDomainEnvelopeDiagnostics,
): {
  claim: ClaimRecord;
  evidence: readonly EvidenceRecord[];
  facts: readonly FactRecord[];
  requirements: readonly EvidenceRequirement[];
  boundedAbsenceEvidenceIds?: readonly EvidenceRecord["id"][];
} {
  assertValidatedDomainContext(context);
  const values = inspectClosedEnvelope(
    rawInput,
    ["claim", "evidence", "facts", "requirements", "boundedAbsenceEvidenceIds"],
    ["claim", "evidence", "facts", "requirements"],
    "Claim evaluation input",
  );
  const facts = values.get("facts") as readonly FactRecord[];
  const evidence = values.get("evidence") as readonly EvidenceRecord[];
  context.assertCanonical({ facts, evidence });
  const mutable = cloneMutableFields<{
    claim: ClaimRecord;
    requirements: readonly EvidenceRequirement[];
    boundedAbsenceEvidenceIds?: readonly EvidenceRecord["id"][];
  }>(values, ["claim", "requirements", "boundedAbsenceEvidenceIds"], diagnostics);
  recordCanonicalReuse(diagnostics, context.facts.length, context.evidence.length);
  return { ...mutable, facts: context.facts, evidence: context.evidence };
}

export function cloneValidatedEvidenceRequirementEnvelope(
  rawInput: unknown,
  context: ValidatedDomainContext,
  diagnostics?: ValidatedDomainEnvelopeDiagnostics,
): {
  requirement: EvidenceRequirement;
  evidence: readonly EvidenceRecord[];
  facts: readonly FactRecord[];
  snapshotId?: SnapshotId;
  role?: "supports" | "contradicts";
} {
  assertValidatedDomainContext(context);
  const values = inspectClosedEnvelope(
    rawInput,
    ["requirement", "evidence", "facts", "snapshotId", "role"],
    ["requirement", "evidence", "facts"],
    "Evidence requirement evaluation input",
  );
  const facts = values.get("facts") as readonly FactRecord[];
  context.assertCanonical({ facts });
  const evidence = inspectDenseArrayMembers<EvidenceRecord>(
    values.get("evidence"),
    "Evidence requirement canonical evidence subset",
  );
  context.assertCanonicalEvidenceMembers(evidence);
  const mutable = cloneMutableFields<{
    requirement: EvidenceRequirement;
    snapshotId?: SnapshotId;
    role?: "supports" | "contradicts";
  }>(values, ["requirement", "snapshotId", "role"], diagnostics);
  recordCanonicalReuse(diagnostics, context.facts.length, evidence.length);
  return { ...mutable, facts: context.facts, evidence };
}

export function cloneValidatedClaimLedgerEnvelope(
  rawInput: unknown,
  context: ValidatedDomainContext,
  diagnostics?: ValidatedDomainEnvelopeDiagnostics,
): {
  claim: ClaimRecord;
  evidence: readonly EvidenceRecord[];
  snapshotId: SnapshotId;
} {
  assertValidatedDomainContext(context);
  const values = inspectClosedEnvelope(
    rawInput,
    ["claim", "evidence", "snapshotId"],
    ["claim", "evidence", "snapshotId"],
    "Claim ledger consistency input",
  );
  const evidence = values.get("evidence") as readonly EvidenceRecord[];
  context.assertCanonical({ evidence });
  const mutable = cloneMutableFields<{
    claim: ClaimRecord;
    snapshotId: SnapshotId;
  }>(values, ["claim", "snapshotId"], diagnostics);
  recordCanonicalReuse(diagnostics, 0, context.evidence.length);
  return { ...mutable, evidence: context.evidence };
}

export function cloneValidatedContradictionDetectionEnvelope(
  rawInput: unknown,
  context: ValidatedDomainContext,
  diagnostics?: ValidatedDomainEnvelopeDiagnostics,
): {
  claim: ClaimRecord;
  evidence: readonly EvidenceRecord[];
  facts: readonly FactRecord[];
  claimRequiresSingleValue?: boolean;
  acceptedFactPredicates?: readonly FactRecord["predicate"][];
} {
  assertValidatedDomainContext(context);
  const values = inspectClosedEnvelope(
    rawInput,
    ["claim", "evidence", "facts", "claimRequiresSingleValue", "acceptedFactPredicates"],
    ["claim", "evidence", "facts"],
    "Contradiction detection input",
  );
  const facts = values.get("facts") as readonly FactRecord[];
  const evidence = values.get("evidence") as readonly EvidenceRecord[];
  context.assertCanonical({ facts, evidence });
  const mutable = cloneMutableFields<{
    claim: ClaimRecord;
    claimRequiresSingleValue?: boolean;
    acceptedFactPredicates?: readonly FactRecord["predicate"][];
  }>(values, ["claim", "claimRequiresSingleValue", "acceptedFactPredicates"], diagnostics);
  recordCanonicalReuse(diagnostics, context.facts.length, context.evidence.length);
  return { ...mutable, facts: context.facts, evidence: context.evidence };
}

export function cloneValidatedContradictionRegistryEnvelope(
  rawInput: unknown,
  context: ValidatedDomainContext,
  diagnostics?: ValidatedDomainEnvelopeDiagnostics,
): {
  snapshotId: SnapshotId;
  claims: readonly ClaimRecord[];
  evidence: readonly EvidenceRecord[];
} {
  assertValidatedDomainContext(context);
  const values = inspectClosedEnvelope(
    rawInput,
    ["snapshotId", "claims", "evidence"],
    ["snapshotId", "claims", "evidence"],
    "Contradiction registry input",
  );
  const evidence = values.get("evidence") as readonly EvidenceRecord[];
  context.assertCanonical({ evidence });
  const mutable = cloneMutableFields<{
    snapshotId: SnapshotId;
    claims: readonly ClaimRecord[];
  }>(values, ["snapshotId", "claims"], diagnostics);
  recordCanonicalReuse(diagnostics, 0, context.evidence.length);
  return { ...mutable, evidence: context.evidence };
}

export function cloneValidatedHypothesisLedgerEnvelope(
  rawInput: unknown,
  context: ValidatedDomainContext,
  diagnostics?: ValidatedDomainEnvelopeDiagnostics,
): {
  snapshotId: SnapshotId;
  claims: readonly ClaimRecord[];
  evidence: readonly EvidenceRecord[];
  knowledgeGaps?: readonly KnowledgeGap[];
} {
  assertValidatedDomainContext(context);
  const values = inspectClosedEnvelope(
    rawInput,
    ["snapshotId", "claims", "evidence", "knowledgeGaps"],
    ["snapshotId", "claims", "evidence"],
    "Hypothesis ledger input",
  );
  const evidence = values.get("evidence") as readonly EvidenceRecord[];
  context.assertCanonical({ evidence });
  const mutable = cloneMutableFields<{
    snapshotId: SnapshotId;
    claims: readonly ClaimRecord[];
    knowledgeGaps?: readonly KnowledgeGap[];
  }>(values, ["snapshotId", "claims", "knowledgeGaps"], diagnostics);
  recordCanonicalReuse(diagnostics, 0, context.evidence.length);
  return { ...mutable, evidence: context.evidence };
}
