import type { LegacyProjectionResult } from "../adapters/legacySelection/index.js";
import type {
  ContextProjectionResult,
  InvestigationRunnerResult,
} from "../application/index.js";
import type { FactRecord } from "../contracts/index.js";
import type { ContextEngineShadowCanonicalInput } from "../shadow/index.js";
import { pathMatchesNegativeConstraints } from "../application/negativeConstraintMatcher.js";
import { buildStrictBoundedRelationshipChains } from "../application/strictRelationshipChain.js";
import type {
  GroundedSelectionProof,
  TaskPackPrimaryMappedFile,
  TaskPackPrimaryReasonCode,
} from "./retirementTypes.js";

const trustedGroundedSelectionProofs = new WeakSet<object>();

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function uniqueReasons(values: readonly TaskPackPrimaryReasonCode[]): TaskPackPrimaryReasonCode[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function explicitTargetKey(target: ContextEngineShadowCanonicalInput["explicitTargets"][number]): string {
  return target.kind === "path"
    ? `path:${normalizePath(target.path).toLowerCase()}`
    : `symbol:${target.symbol}`;
}

function allConfirmedFindingsAreCurrent(result: InvestigationRunnerResult): boolean {
  const evidence = new Map(result.evidence.map((entry) => [entry.id, entry]));
  const facts = new Map(result.facts.map((entry) => [entry.id, entry]));
  return result.findings
    .filter((finding) => finding.status === "confirmed")
    .every((finding) =>
      finding.snapshotId === result.snapshotId &&
      finding.evidenceIds.length > 0 &&
      finding.evidenceIds.every((id) => {
        const record = evidence.get(id);
        return Boolean(
          record &&
          record.snapshotId === result.snapshotId &&
          record.role === "supports" &&
          record.freshness.current &&
          (record.factIds.length > 0 || record.sourceSpans.length > 0) &&
          record.factIds.every((factId) => {
            const fact = facts.get(factId);
            return fact?.snapshotId === result.snapshotId && fact.status === "active";
          }),
        );
      })
    );
}

export function hasVerifiedExactRelationshipChain(input: {
  facts: readonly FactRecord[];
  candidateFact: Extract<FactRecord, { kind: "relation" }>;
  snapshotId: InvestigationRunnerResult["snapshotId"];
  targetPath: string;
}): boolean {
  if (input.candidateFact.status !== "active" || input.candidateFact.snapshotId !== input.snapshotId ||
      input.candidateFact.predicate !== "contains" || input.candidateFact.source.kind !== "source_span" ||
      normalizePath(input.candidateFact.source.path) !== normalizePath(input.targetPath)) return false;
  const currentFacts = input.facts.filter((fact) =>
    fact.status === "active" && fact.snapshotId === input.snapshotId);
  const origins = currentFacts.filter((fact) =>
    fact.kind === "relation" &&
    fact.source.kind === "source_span" &&
    normalizePath(fact.source.path) !== normalizePath(input.targetPath));
  return buildStrictBoundedRelationshipChains({ origins, facts: currentFacts, candidateFact: input.candidateFact })
    .some((chain) => chain.length >= 2 && chain.at(-1)?.id === input.candidateFact.id);
}

function proofForEditable(input: {
  path: string;
  role: "target" | "test";
  trace: LegacyProjectionResult["files"][string];
  result: InvestigationRunnerResult;
  projection: ContextProjectionResult;
  canonical: ContextEngineShadowCanonicalInput;
}): GroundedSelectionProof | null {
  const decision = input.projection.decisions.find((entry) =>
    entry.included &&
    entry.path === input.path &&
    entry.role === input.role &&
    entry.reviewRequired === false,
  );
  if (!decision || decision.findingIds.length === 0 || decision.evidenceIds.length === 0) return null;
  if (decision.reasonCodes.some((code) =>
    code === "ambiguous_entity_file" ||
    code === "probable_review_only" ||
    code === "evidence_entity_mismatch" ||
    code === "missing_evidence" ||
    code === "blocking_gap" ||
    code === "blocking_contradiction"
  )) return null;

  const findingById = new Map(input.result.findings.map((entry) => [entry.id, entry]));
  const evidenceById = new Map(input.result.evidence.map((entry) => [entry.id, entry]));
  const factById = new Map(input.result.facts.map((entry) => [entry.id, entry]));
  const compatibleType = input.role === "target" ? "implementation_target" : "test_target";
  const findings = decision.findingIds.map((id) => findingById.get(id)).filter(Boolean);
  const compatibleFindings = findings.filter((finding) =>
    finding!.snapshotId === input.result.snapshotId &&
    finding!.status === "confirmed" &&
    finding!.type === compatibleType &&
    finding!.authorizationHint === "eligible" &&
    finding!.entityIds.includes(decision.entityId) &&
    finding!.evidenceIds.some((id) => decision.evidenceIds.includes(id)),
  );
  if (compatibleFindings.length === 0) return null;

  const compatibleEvidenceIds = new Set(compatibleFindings.flatMap((finding) => finding!.evidenceIds));
  const evidence = decision.evidenceIds
    .filter((id) => compatibleEvidenceIds.has(id))
    .map((id) => evidenceById.get(id))
    .filter(Boolean);
  if (evidence.length === 0 || evidence.some((entry) =>
    entry!.snapshotId !== input.result.snapshotId ||
    entry!.role !== "supports" ||
    !entry!.freshness.current ||
    entry!.factIds.length === 0
  )) return null;
  const facts = evidence.flatMap((entry) => entry!.factIds.map((id) => factById.get(id))).filter(Boolean);
  if (facts.length === 0 || facts.some((fact) =>
    fact!.snapshotId !== input.result.snapshotId || fact!.status !== "active"
  )) return null;

  const candidateDefinitions = facts.filter((fact): fact is Extract<FactRecord, { kind: "relation" }> =>
    fact!.kind === "relation" &&
    fact!.predicate === "contains" &&
    fact!.object.id === decision.entityId &&
    fact!.source.kind === "source_span" &&
    normalizePath(fact!.source.path) === input.path,
  );
  const directDefinition = candidateDefinitions.length > 0;
  const candidateNames = new Set(candidateDefinitions.flatMap((fact) => [
    fact.object.displayName,
    fact.object.canonicalName,
    fact.object.canonicalName?.split("#").at(-1),
  ].filter((value): value is string => typeof value === "string" && value.length > 0)));
  const hasCompetingDefinition = input.result.facts.some((fact) =>
    fact.kind === "relation" &&
    fact.status === "active" &&
    fact.snapshotId === input.result.snapshotId &&
    fact.predicate === "contains" &&
    fact.source.kind === "source_span" &&
    normalizePath(fact.source.path) !== input.path &&
    fact.object.id !== decision.entityId &&
    [fact.object.displayName, fact.object.canonicalName, fact.object.canonicalName?.split("#").at(-1)]
      .some((value) => typeof value === "string" && candidateNames.has(value)),
  );
  const exactPathWasExplicit = input.canonical.explicitTargets.some((target) =>
    target.kind === "path" && normalizePath(target.path) === input.path);
  const hasInventoryCompetingDefinition = !exactPathWasExplicit && input.canonical.inventory.files.some((file) =>
    normalizePath(file.path) !== input.path &&
    [...(file.symbols ?? []), ...(file.exports ?? [])].some((symbol) => candidateNames.has(symbol)),
  );
  const exactRelationshipChain = !hasCompetingDefinition && candidateDefinitions.some((candidateFact) =>
    hasVerifiedExactRelationshipChain({
      facts: input.result.facts,
      candidateFact,
      snapshotId: input.result.snapshotId,
      targetPath: input.path,
    }),
  );
  if (!directDefinition || hasCompetingDefinition || hasInventoryCompetingDefinition) return null;
  const descriptor = input.canonical.snapshot.files.find((file) => file.normalizedPath === input.path);
  const inventory = input.canonical.inventory.files.find((file) => normalizePath(file.path) === input.path);
  if (!descriptor || !inventory || !descriptor.readable || !inventory.canReadText ||
      descriptor.secretRisk !== "none" || descriptor.generated || inventory.isLikelyGenerated ||
      pathMatchesNegativeConstraints(input.path, input.canonical.negativeConstraints)) return null;
  if (input.trace.reviewRequired || input.trace.findingIds.length === 0 || input.trace.evidenceIds.length === 0) return null;

  const proof: GroundedSelectionProof = Object.freeze({
    schemaVersion: 1,
    path: input.path,
    role: input.role,
    evidenceCurrent: true,
    findingConfirmed: true,
    targetRoleSupported: true,
    snapshotCurrent: true,
    ambiguityResolved: true,
    constraintsSatisfied: true,
    proofKind: exactRelationshipChain ? "exact_relationship_chain" : "direct_definition",
  });
  trustedGroundedSelectionProofs.add(proof);
  return proof;
}

export function isTrustedGroundedSelectionProof(value: GroundedSelectionProof): boolean {
  return typeof value === "object" && value !== null && trustedGroundedSelectionProofs.has(value);
}

export interface GroundedSelectionEvaluation {
  files: TaskPackPrimaryMappedFile[];
  proofs: GroundedSelectionProof[];
  reasons: TaskPackPrimaryReasonCode[];
}

export function evaluateGroundedPrimarySelection(input: {
  result: InvestigationRunnerResult;
  projection: ContextProjectionResult;
  mapped: LegacyProjectionResult;
  canonical: ContextEngineShadowCanonicalInput;
}): GroundedSelectionEvaluation {
  const reasons: TaskPackPrimaryReasonCode[] = [];
  if (input.result.snapshotId !== input.canonical.snapshot.id ||
      input.projection.projection.snapshotId !== input.canonical.snapshot.id) reasons.push("snapshot_mismatch");
  if (input.result.stop.reason === "repository_changed") reasons.push("repository_changed");
  if (input.result.stop.reason !== "sufficient_evidence") {
    reasons.push(input.result.stop.reason === "clarification_required"
      ? "clarification_required"
      : "stop_not_sufficient");
  }
  if (!input.result.safeToProject || !input.result.stop.safeToProject ||
      !input.projection.source.safeToProject || input.projection.source.stopReason !== "sufficient_evidence") {
    reasons.push("result_not_safe");
  }
  if (input.result.knowledgeGaps.some((gap) => gap.status === "open" && gap.blocks.length > 0)) reasons.push("blocking_gap");
  if (input.result.contradictions.some((record) => record.status === "open" && record.severity === "blocking")) reasons.push("blocking_contradiction");
  if (!allConfirmedFindingsAreCurrent(input.result)) reasons.push("unsupported_confirmed_finding", "evidence_incomplete");

  for (const target of input.canonical.explicitTargets) {
    const key = explicitTargetKey(target);
    const diagnostic = input.projection.diagnostics.find((entry) => entry.targetKey === key);
    if (!diagnostic || diagnostic.code !== "explicit_target_eligible") reasons.push("explicit_target_not_preserved");
  }

  const inventoryByPath = new Map(input.canonical.inventory.files.map((file) => [normalizePath(file.path), file]));
  const snapshotByPath = new Map(input.canonical.snapshot.files.map((file) => [file.normalizedPath, file]));
  const files: TaskPackPrimaryMappedFile[] = [];
  const proofs: GroundedSelectionProof[] = [];
  for (const selected of input.mapped.selection.selectedFiles) {
    const path = normalizePath(selected.path);
    const trace = input.mapped.files[path];
    const inventory = inventoryByPath.get(path);
    const descriptor = snapshotByPath.get(path);
    if (!trace || !inventory || !descriptor) {
      reasons.push("unknown_inventory_path");
      continue;
    }
    const editable = selected.usage === "inspect-and-edit" || selected.usage === "create-and-edit";
    if (!inventory.canReadText || !descriptor.readable || descriptor.secretRisk !== "none" ||
        (editable && (inventory.isLikelyGenerated || descriptor.generated))) reasons.push("repository_safety_violation");
    if (pathMatchesNegativeConstraints(path, input.canonical.negativeConstraints)) reasons.push("negative_constraint_violation");
    if ((trace.role === "target" || trace.role === "test") !== editable ||
        ((trace.role === "supporting" || trace.role === "reference") && editable)) reasons.push("role_usage_mismatch");
    if (trace.reviewRequired && editable) reasons.push("review_required");
    files.push({ path, kind: inventory.kind, role: trace.role, usage: selected.usage });
    if (editable && (trace.role === "target" || trace.role === "test")) {
      const proof = proofForEditable({ path, role: trace.role, trace, result: input.result, projection: input.projection, canonical: input.canonical });
      if (!proof) reasons.push("evidence_incomplete", "ambiguous_targets");
      else proofs.push(proof);
    }
  }
  const editableCount = files.filter((file) => file.role === "target" || file.role === "test").length;
  if (editableCount === 0) reasons.push("no_editable_target");
  if (proofs.length !== editableCount) reasons.push("evidence_incomplete");
  const roleOrder = { target: 0, test: 1, supporting: 2, reference: 3 } as const;
  files.sort((left, right) => roleOrder[left.role] - roleOrder[right.role] || left.path.localeCompare(right.path));
  proofs.sort((left, right) => left.role.localeCompare(right.role) || left.path.localeCompare(right.path));
  return Object.freeze({ files, proofs, reasons: uniqueReasons(reasons) });
}
