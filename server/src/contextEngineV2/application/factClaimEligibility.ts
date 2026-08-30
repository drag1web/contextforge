import type {
  ClaimRecord,
  FactRecord,
  InvestigationHypothesis,
  InvestigationOperation,
  InvestigationOperationRecord,
  InvestigationRequest,
  RepositoryEntity,
  RepositorySnapshot,
} from "../contracts/index.js";
import { sortedUnique, stableCompare } from "../domain/investigationDomainSupport.js";
import { isFileBackedDefinitionFact } from "./entityRolePolicy.js";
import { pathMatchesNegativeConstraints } from "./negativeConstraintMatcher.js";
import { buildStrictBoundedRelationshipChains } from "./strictRelationshipChain.js";

const CLAIM_PREDICATES: Readonly<Record<ClaimRecord["type"], ReadonlySet<string>>> = {
  implementation_owner: new Set([
    "calls",
    "contains",
    "defines_endpoint",
    "defines_route",
    "imports",
    "re_exports",
  ]),
  supporting_context: new Set([
    "calls",
    "configures",
    "contains",
    "defines_endpoint",
    "defines_route",
    "exports",
    "imports",
    "re_exports",
    "renders",
    "tests",
  ]),
  behavior: new Set(["calls", "defines_endpoint", "defines_route", "renders"]),
  data_flow: new Set(["calls", "imports", "re_exports"]),
  route_flow: new Set([
    "calls",
    "defines_endpoint",
    "defines_route",
    "imports",
    "re_exports",
  ]),
  state_flow: new Set(["calls", "imports", "re_exports"]),
  configuration: new Set(["configuration", "configures"]),
  test_coverage: new Set(["tests"]),
  absence: new Set(),
  risk: new Set(["calls", "configuration", "configures", "imports", "re_exports"]),
  custom: new Set(),
};

const OWNER_LINK_PREDICATES = new Set(["calls", "imports", "re_exports"]);
const OWNER_ORIGIN_PREDICATES = new Set(["calls", "defines_endpoint", "defines_route"]);
const OWNER_ENTITY_KINDS = new Set([
  "class",
  "component",
  "function",
  "module",
  "symbol",
]);

export interface ImplementationOwnerProof {
  candidate: RepositoryEntity;
  factIds: FactRecord["id"][];
  basis: "explicit_path" | "explicit_symbol" | "relationship_chain";
}

export interface FactClaimEligibilityDecision {
  eligible: boolean;
  reason:
    | "eligible"
    | "inactive_fact"
    | "operation_purpose_mismatch"
    | "requirement_mismatch"
    | "claim_semantic_mismatch"
    | "owner_proof_missing";
  supportingFactIds: FactRecord["id"][];
}

function factEntities(fact: FactRecord): RepositoryEntity[] {
  return fact.kind === "relation" ? [fact.subject, fact.object] : [fact.subject];
}

function namesFor(entity: RepositoryEntity): Set<string> {
  const values = [entity.displayName, entity.canonicalName]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => [value, value.split("#").at(-1) ?? value]);
  return new Set(values);
}


function operationServesHypothesis(
  operation: InvestigationOperation,
  hypothesis: InvestigationHypothesis,
): boolean {
  return operation.hypothesisIds.includes(hypothesis.id);
}

function factWasGroundedForHypothesis(input: {
  fact: FactRecord;
  hypothesis: InvestigationHypothesis;
  operation: InvestigationOperation;
  operationRecords: readonly InvestigationOperationRecord[];
}): boolean {
  const operationId = input.fact.provenance.operationId;
  if (operationId === input.operation.id) {
    return operationServesHypothesis(input.operation, input.hypothesis);
  }
  const record = input.operationRecords.find(
    (candidate) => candidate.operation.id === operationId && candidate.status === "completed",
  );
  return record !== undefined && operationServesHypothesis(record.operation, input.hypothesis);
}

function requirementAllowsFact(
  fact: FactRecord,
  hypothesis: InvestigationHypothesis,
): boolean {
  return hypothesis.requiredEvidence.some((requirement) => {
    const predicateAllowed =
      requirement.acceptedFactPredicates === undefined ||
      requirement.acceptedFactPredicates.includes(fact.predicate);
    const entityKindAllowed =
      requirement.acceptedEntityKinds === undefined ||
      factEntities(fact).some((entity) => requirement.acceptedEntityKinds!.includes(entity.kind));
    return predicateAllowed && entityKindAllowed;
  });
}

function explicitPathProof(input: {
  candidateFact: Extract<FactRecord, { kind: "relation" }>;
  request?: InvestigationRequest;
  snapshot: RepositorySnapshot;
}): ImplementationOwnerProof | undefined {
  if (!input.request || input.candidateFact.source.kind !== "source_span") return undefined;
  const sourcePath = input.candidateFact.source.path;
  const target = input.request.explicitTargets.find(
    (candidate): candidate is Extract<
      InvestigationRequest["explicitTargets"][number],
      { kind: "path" }
    > =>
      candidate.kind === "path" &&
      candidate.path === sourcePath &&
      !pathMatchesNegativeConstraints(candidate.path, input.request!.negativeConstraints),
  );
  if (!target) return undefined;
  const file = input.snapshot.files.find(
    (candidate) => candidate.normalizedPath === target.path,
  );
  if (!file || input.candidateFact.object.fileId !== file.id) return undefined;
  return {
    candidate: input.candidateFact.object,
    factIds: [input.candidateFact.id],
    basis: "explicit_path",
  };
}

export function isFileBackedOwnerDefinitionFact(
  fact: FactRecord,
  snapshot: RepositorySnapshot,
): fact is Extract<FactRecord, { kind: "relation" }> {
  return isFileBackedDefinitionFact({
    fact,
    snapshot,
    predicate: "contains",
  });
}

function explicitSymbolProof(input: {
  candidateFact: Extract<FactRecord, { kind: "relation" }>;
  request?: InvestigationRequest;
  snapshot: RepositorySnapshot;
}): ImplementationOwnerProof | undefined {
  if (!input.request || input.candidateFact.source.kind !== "source_span") return undefined;
  const file = input.snapshot.files.find(
    (candidate) => candidate.id === input.candidateFact.object.fileId,
  );
  if (!file || file.normalizedPath !== input.candidateFact.source.path) return undefined;
  const names = namesFor(input.candidateFact.object);
  const exact = input.request.explicitTargets.some(
    (candidate) => candidate.kind === "symbol" && names.has(candidate.symbol),
  );
  return exact
    ? {
        candidate: input.candidateFact.object,
        factIds: [input.candidateFact.id],
        basis: "explicit_symbol",
      }
    : undefined;
}

export function deriveImplementationOwnerProofs(input: {
  claim: ClaimRecord;
  hypothesis: InvestigationHypothesis;
  operation: InvestigationOperation;
  operationRecords: readonly InvestigationOperationRecord[];
  facts: readonly FactRecord[];
  snapshot: RepositorySnapshot;
  request?: InvestigationRequest;
}, checkpoint?: () => void): ImplementationOwnerProof[] {
  checkpoint?.();
  if (
    input.claim.type !== "implementation_owner" ||
    input.hypothesis.claimId !== input.claim.id ||
    !operationServesHypothesis(input.operation, input.hypothesis)
  ) {
    return [];
  }
  const groundedFacts = input.facts.filter(
    (fact) =>
      fact.status === "active" &&
      fact.snapshotId === input.snapshot.id &&
      factWasGroundedForHypothesis({
        fact,
        hypothesis: input.hypothesis,
        operation: input.operation,
        operationRecords: input.operationRecords,
      }),
  );
  const candidates = groundedFacts.filter(
    (fact): fact is Extract<FactRecord, { kind: "relation" }> =>
      isFileBackedOwnerDefinitionFact(fact, input.snapshot) &&
      OWNER_ENTITY_KINDS.has(fact.object.kind),
  );
  const origins = groundedFacts.filter(
    (fact) => fact.kind === "relation" && OWNER_ORIGIN_PREDICATES.has(fact.predicate),
  );
  const relationshipFacts = groundedFacts.filter(
    (fact) =>
      fact.kind === "relation" &&
      (OWNER_LINK_PREDICATES.has(fact.predicate) ||
        isFileBackedOwnerDefinitionFact(fact, input.snapshot)),
  );
  const proofs: ImplementationOwnerProof[] = [];
  for (const candidateFact of candidates) {
    checkpoint?.();
    const explicitPath = explicitPathProof({
      candidateFact,
      request: input.request,
      snapshot: input.snapshot,
    });
    if (explicitPath) {
      proofs.push(explicitPath);
      continue;
    }
    const explicitSymbol = explicitSymbolProof({
      candidateFact,
      request: input.request,
      snapshot: input.snapshot,
    });
    if (explicitSymbol) {
      proofs.push(explicitSymbol);
      continue;
    }
    const chains = buildStrictBoundedRelationshipChains({
      origins,
      facts: relationshipFacts,
      candidateFact,
    }, checkpoint);
    if (chains.length !== 1) continue;
    const factIds = chains[0]!.map((fact) => fact.id);
    proofs.push({
      candidate: candidateFact.object,
      factIds,
      basis: "relationship_chain",
    });
  }
  return proofs.sort((left, right) => stableCompare(left.candidate.id, right.candidate.id));
}

export function evaluateFactClaimEligibility(input: {
  fact: FactRecord;
  claim: ClaimRecord;
  hypothesis: InvestigationHypothesis;
  operation: InvestigationOperation;
  operationRecords: readonly InvestigationOperationRecord[];
  facts: readonly FactRecord[];
  snapshot: RepositorySnapshot;
  request?: InvestigationRequest;
}, checkpoint?: () => void): FactClaimEligibilityDecision {
  checkpoint?.();
  if (input.fact.status !== "active") {
    return { eligible: false, reason: "inactive_fact", supportingFactIds: [] };
  }
  if (
    input.hypothesis.claimId !== input.claim.id ||
    !operationServesHypothesis(input.operation, input.hypothesis)
  ) {
    return { eligible: false, reason: "operation_purpose_mismatch", supportingFactIds: [] };
  }
  if (!requirementAllowsFact(input.fact, input.hypothesis)) {
    return { eligible: false, reason: "requirement_mismatch", supportingFactIds: [] };
  }
  if (!CLAIM_PREDICATES[input.claim.type].has(input.fact.predicate)) {
    return { eligible: false, reason: "claim_semantic_mismatch", supportingFactIds: [] };
  }
  if (input.claim.type === "implementation_owner") {
    const proof = deriveImplementationOwnerProofs(input, checkpoint).find((candidate) =>
      candidate.factIds.includes(input.fact.id),
    );
    return proof
      ? { eligible: true, reason: "eligible", supportingFactIds: proof.factIds }
      : { eligible: false, reason: "owner_proof_missing", supportingFactIds: [] };
  }
  return { eligible: true, reason: "eligible", supportingFactIds: [input.fact.id] };
}
