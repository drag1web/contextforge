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
const MAX_OWNER_PROOF_FACTS = 16;
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

function pathWithoutSupportedExtension(path: string): string {
  return path.replace(/\.(?:[cm]?[jt]sx?|json)$/u, "");
}

function resolveRelativeModuleTarget(fact: FactRecord): string | undefined {
  if (fact.kind !== "relation") return undefined;
  const moduleSpecifier = fact.object.attributes?.moduleSpecifier;
  if (
    typeof moduleSpecifier !== "string" ||
    (!moduleSpecifier.startsWith("./") && !moduleSpecifier.startsWith("../")) ||
    fact.source.kind !== "source_span"
  ) {
    return undefined;
  }
  const segments = fact.source.path.split("/").slice(0, -1);
  for (const segment of moduleSpecifier.replaceAll("\\", "/").split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return pathWithoutSupportedExtension(segments.join("/"));
}

function exactImportedSymbol(fact: FactRecord): string | undefined {
  if (fact.kind !== "relation") return undefined;
  const importedName = fact.object.attributes?.importedName;
  if (
    typeof importedName !== "string" ||
    importedName === "*" ||
    importedName === "default" ||
    importedName === "<module>"
  ) {
    return undefined;
  }
  return importedName;
}

function factDefinesSymbol(fact: FactRecord, symbol: string): boolean {
  if (fact.kind !== "relation") return false;
  if (fact.predicate === "contains") {
    return namesFor(fact.object).has(symbol);
  }
  if (fact.predicate === "imports" || fact.predicate === "re_exports") {
    const attributes = fact.object.attributes ?? {};
    return new Set(
      [
        fact.object.displayName,
        fact.object.canonicalName?.split("#").at(-1),
        attributes.localName,
      ].filter((value): value is string => typeof value === "string"),
    ).has(symbol);
  }
  return false;
}

function sourcePathMatchesModuleTarget(
  target: string,
  fact: FactRecord,
): boolean {
  if (fact.source.kind !== "source_span") return false;
  const sourcePath = pathWithoutSupportedExtension(fact.source.path);
  return sourcePath === target || sourcePath === `${target}/index`;
}

function factEntityIds(fact: FactRecord): Set<string> {
  return new Set(
    fact.kind === "relation"
      ? [fact.subject.id, fact.object.id]
      : [fact.subject.id],
  );
}

function areOwnerProofFactsAdjacent(
  left: FactRecord,
  right: FactRecord,
): boolean {
  if (
    left.kind !== "relation" ||
    right.kind !== "relation" ||
    left.status !== "active" ||
    right.status !== "active" ||
    left.snapshotId !== right.snapshotId
  ) {
    return false;
  }
  const leftIds = factEntityIds(left);
  const rightIds = factEntityIds(right);
  const sharedIds = [...leftIds].filter((id) => rightIds.has(id));
  if (sharedIds.length > 0) {
    if (
      left.object.id === right.subject.id ||
      left.object.id === right.object.id ||
      (left.subject.id === right.subject.id &&
        new Set(["defines_endpoint", "defines_route"]).has(left.predicate))
    ) {
      return true;
    }
  }
  if (left.predicate !== "imports" && left.predicate !== "re_exports") {
    return false;
  }
  const target = resolveRelativeModuleTarget(left);
  const symbol = exactImportedSymbol(left);
  return target !== undefined &&
    symbol !== undefined &&
    sourcePathMatchesModuleTarget(target, right) &&
    factDefinesSymbol(right, symbol);
}

function buildBoundedOwnerRelationshipChains(input: {
  origins: readonly FactRecord[];
  facts: readonly FactRecord[];
  candidateFact: Extract<FactRecord, { kind: "relation" }>;
}): FactRecord[][] {
  const orderedFacts = [...input.facts].sort((left, right) =>
    stableCompare(left.id, right.id),
  );
  const chains: FactRecord[][] = [];
  const visit = (path: FactRecord[]): void => {
    const tail = path.at(-1)!;
    if (tail.id === input.candidateFact.id) {
      chains.push(path);
      return;
    }
    if (path.length >= MAX_OWNER_PROOF_FACTS) return;
    const seen = new Set(path.map((fact) => fact.id));
    for (const next of orderedFacts) {
      if (seen.has(next.id) || !areOwnerProofFactsAdjacent(tail, next)) continue;
      visit([...path, next]);
    }
  };
  [...input.origins]
    .sort((left, right) => stableCompare(left.id, right.id))
    .filter((origin) => {
      const firstLinks = orderedFacts.filter(
        (fact) => fact.id !== origin.id && areOwnerProofFactsAdjacent(origin, fact),
      );
      return firstLinks.length === 1;
    })
    .forEach((origin) => visit([origin]));
  const unique = new Map<string, FactRecord[]>();
  for (const chain of chains) {
    unique.set(chain.map((fact) => fact.id).join("\0"), chain);
  }
  return [...unique.values()].sort((left, right) =>
    stableCompare(
      left.map((fact) => fact.id).join("\0"),
      right.map((fact) => fact.id).join("\0"),
    ),
  );
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
}): ImplementationOwnerProof[] {
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
    const chains = buildBoundedOwnerRelationshipChains({
      origins,
      facts: relationshipFacts,
      candidateFact,
    });
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
}): FactClaimEligibilityDecision {
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
    const proof = deriveImplementationOwnerProofs(input).find((candidate) =>
      candidate.factIds.includes(input.fact.id),
    );
    return proof
      ? { eligible: true, reason: "eligible", supportingFactIds: proof.factIds }
      : { eligible: false, reason: "owner_proof_missing", supportingFactIds: [] };
  }
  return { eligible: true, reason: "eligible", supportingFactIds: [input.fact.id] };
}
