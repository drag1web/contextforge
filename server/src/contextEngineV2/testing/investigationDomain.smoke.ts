import assert from "node:assert/strict";

import type {
  ClaimId,
  ClaimRecord,
  ContradictionId,
  ContradictionRecord,
  EntityId,
  EvidenceId,
  EvidenceRecord,
  EvidenceRequirement,
  FactId,
  FactRecord,
  Finding,
  FindingId,
  HypothesisId,
  InvestigationBudget,
  InvestigationHypothesis,
  InvestigationQuestion,
  KnowledgeGap,
  KnowledgeGapId,
  QuestionId,
  RepositoryEntity,
  RepositorySnapshot,
  SnapshotId,
} from "../contracts/index.js";
import {
  InvestigationDomainError,
  applyOperationCost,
  calculateInvestigationCoverage,
  canFitOperationCost,
  createContradictionRegistry,
  createEvidenceLedger,
  createHypothesisLedger,
  createInvestigationBudgetState,
  createKnowledgeGapRegistry,
  createStopPolicy,
  detectDeterministicContradictions,
  evaluateClaim,
  evaluateEvidenceRequirement,
  evaluateFindingEligibility,
} from "../domain/index.js";
import { createValidatedDomainContext } from "../domain/validatedDomainContext.js";
import { cloneDomainValue } from "../domain/investigationDomainSupport.js";
import {
  cloneValidatedClaimEvaluationEnvelope,
  cloneValidatedEvidenceRequirementEnvelope,
  createValidatedDomainEnvelopeDiagnostics,
} from "../domain/validatedDomainEnvelope.js";
import type {
  ClaimEvaluation,
  FindingEligibilityEvaluation,
  StopPolicyState,
} from "../domain/index.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const scenarios: Array<{ name: string; run: () => void }> = [];

function scenario(name: string, run: () => void): void {
  scenarios.push({ name, run });
}

function id<T extends string>(value: string): T {
  return value as T;
}

function snapshot(suffix = "a"): RepositorySnapshot {
  const snapshotId = id<SnapshotId>(`snapshot-${suffix}`);
  return {
    id: snapshotId,
    projectId: `project-${suffix}`,
    rootUri: `repository://${suffix}`,
    rootFingerprint: `root-${suffix}`,
    createdAt: timestamp,
    source: "test_fixture",
    files: [
      {
        id: id<EntityId>(`file-${suffix}`),
        snapshotId,
        path: "src/module.ts",
        normalizedPath: "src/module.ts",
        extension: ".ts",
        language: "typescript",
        kind: "source",
        sizeBytes: 32,
        contentFingerprint: `content-${suffix}`,
        readable: true,
        generated: false,
        secretRisk: "none",
        attributes: {},
      },
    ],
    limits: { excludedPatterns: [] },
    truncation: { truncated: false, reasons: [] },
    metadata: {},
  };
}

function entity(
  source: RepositorySnapshot,
  suffix = "owner",
  kind: RepositoryEntity["kind"] = "function",
): RepositoryEntity {
  return {
    id: id<EntityId>(`entity-${suffix}`),
    snapshotId: source.id,
    kind,
    displayName: `Entity ${suffix}`,
    canonicalName: `src/module.ts#${suffix}`,
    fileId: source.files[0]!.id,
    attributes: {},
  };
}

function fact(
  source: RepositorySnapshot,
  suffix = "a",
  value = "value-a",
  predicate = "configures",
): FactRecord {
  return {
    kind: "fact",
    id: id<FactId>(`fact-${suffix}`),
    snapshotId: source.id,
    subject: entity(source),
    predicate,
    object: { type: "string", value },
    source: {
      kind: "repository_metadata",
      snapshotId: source.id,
      reference: `metadata-${suffix}`,
      fingerprint: `fingerprint-${suffix}`,
    },
    provenance: {
      extractorId: "fixture.extractor",
      extractorVersion: "1.0.0",
      method: "repository_metadata",
      observedAt: timestamp,
    },
    strength: "exact",
    status: "active",
    attributes: {},
  };
}

function evidence(
  source: RepositorySnapshot,
  suffix = "a",
  options: {
    claimId?: ClaimId;
    role?: EvidenceRecord["role"];
    strength?: EvidenceRecord["strength"];
    current?: boolean;
    group?: string;
    factIds?: FactId[];
  } = {},
): EvidenceRecord {
  const current = options.current ?? true;
  return {
    id: id<EvidenceId>(`evidence-${suffix}`),
    snapshotId: source.id,
    ...(options.claimId === undefined ? {} : { claimId: options.claimId }),
    role: options.role ?? "supports",
    factIds: [...(options.factIds ?? [id<FactId>("fact-a")])].sort(),
    sourceSpans: [],
    summary: `Observed evidence ${suffix}`,
    strength: options.strength ?? "substantial",
    independenceGroup: options.group ?? `group-${suffix}`,
    freshness: {
      snapshotId: source.id,
      current,
      reason: current ? "snapshot_match" : "stale",
    },
    limitations: [],
  };
}

function sourceSpan(
  source: RepositorySnapshot,
): EvidenceRecord["sourceSpans"][number] {
  return {
    kind: "source_span",
    snapshotId: source.id,
    fileId: source.files[0]!.id,
    path: source.files[0]!.normalizedPath,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 8,
    contentFingerprint: source.files[0]!.contentFingerprint,
  };
}

function requirement(
  suffix = "owner",
  options: Partial<EvidenceRequirement> = {},
): EvidenceRequirement {
  return {
    id: `requirement-${suffix}`,
    description: `Verify requirement ${suffix}`,
    acceptedFactPredicates: ["configures"],
    acceptedEntityKinds: ["function"],
    minimumStrength: "substantial",
    minimumIndependentGroups: 1,
    required: true,
    ...options,
  };
}

function claim(
  source: RepositorySnapshot,
  supportingEvidenceIds: EvidenceId[] = [],
  contradictingEvidenceIds: EvidenceId[] = [],
  options: Partial<ClaimRecord> = {},
): ClaimRecord {
  return {
    id: id<ClaimId>("claim-owner"),
    snapshotId: source.id,
    type: "implementation_owner",
    statement: "The observed entity owns the implementation.",
    subject: entity(source),
    supportingEvidenceIds: [...supportingEvidenceIds].sort(),
    contradictingEvidenceIds: [...contradictingEvidenceIds].sort(),
    status: "proposed",
    derivation: {
      ruleId: "rule.owner",
      ruleVersion: "1.0.0",
      inputFactIds: [id<FactId>("fact-a")],
    },
    ...options,
  };
}

function hypothesis(
  sourceClaim: ClaimRecord,
  options: Partial<InvestigationHypothesis> = {},
): InvestigationHypothesis {
  return {
    id: id<HypothesisId>("hypothesis-owner"),
    claimId: sourceClaim.id,
    priority: "critical",
    status: "open",
    requiredEvidence: [requirement()],
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    openQuestionIds: [],
    revision: 0,
    history: [],
    ...options,
  };
}

function gap(
  source: RepositorySnapshot,
  suffix = "owner",
  options: Partial<KnowledgeGap> = {},
): KnowledgeGap {
  return {
    id: id<KnowledgeGapId>(`gap-${suffix}`),
    snapshotId: source.id,
    category: "missing_owner",
    question: `Which repository entity resolves ${suffix}?`,
    blocks: ["authorization"],
    relatedEntityIds: [],
    relatedHypothesisIds: [],
    suggestedOperations: [],
    status: "open",
    ...options,
  };
}

function contradiction(
  source: RepositorySnapshot,
  claimId: ClaimId,
  evidenceIds: EvidenceId[],
  suffix = "owner",
  options: Partial<ContradictionRecord> = {},
): ContradictionRecord {
  return {
    id: id<ContradictionId>(`contradiction-${suffix}`),
    snapshotId: source.id,
    claimId,
    evidenceIds: [...evidenceIds].sort(),
    type: "mutually_exclusive_claims",
    severity: "blocking",
    status: "open",
    ...options,
  };
}

function finding(
  source: RepositorySnapshot,
  evidenceIds: EvidenceId[],
  options: Partial<Finding> = {},
): Finding {
  return {
    id: id<FindingId>("finding-owner"),
    snapshotId: source.id,
    type: "implementation_target",
    statement: "The observed entity is an implementation target.",
    entityIds: [entity(source).id],
    evidenceIds: [...evidenceIds].sort(),
    status: "confirmed",
    limitations: [],
    authorizationHint: "eligible",
    ...options,
  };
}

function budget(overrides: Partial<InvestigationBudget> = {}): InvestigationBudget {
  return {
    maxOperations: 2,
    maxFileReads: 2,
    maxFileBytes: 20,
    maxParsedFiles: 2,
    maxRelationshipHops: 2,
    maxWallTimeMs: 20,
    maxPlannerRounds: 2,
    maxConcurrentOperations: 1,
    ...overrides,
  };
}

function cost(overrides: Partial<ReturnType<typeof zeroCost>> = {}) {
  return { ...zeroCost(), ...overrides };
}

function zeroCost() {
  return {
    operations: 0,
    fileReads: 0,
    fileBytes: 0,
    parsedFiles: 0,
    relationshipHops: 0,
    plannerRounds: 0,
    wallTimeMs: 0,
  };
}

function question(
  suffix: string,
  status: InvestigationQuestion["status"] = "open",
  priority: InvestigationQuestion["priority"] = "critical",
): InvestigationQuestion {
  return {
    id: id<QuestionId>(`question-${suffix}`),
    text: `Question ${suffix}`,
    category: "owner",
    priority,
    status,
    answerFindingIds: [],
  };
}

function supportedEvaluation(
  source: RepositorySnapshot,
  allEvidence: EvidenceRecord[],
  sourceClaim: ClaimRecord,
): ClaimEvaluation {
  return evaluateClaim({
    claim: sourceClaim,
    evidence: allEvidence,
    facts: [fact(source)],
    requirements: [requirement()],
  });
}

function findingEvaluation(
  source: RepositorySnapshot,
  records: EvidenceRecord[],
  sourceFinding = finding(source, records.map((record) => record.id)),
  facts: FactRecord[] = [fact(source)],
): FindingEligibilityEvaluation {
  return evaluateFindingEligibility({
    finding: sourceFinding,
    snapshotId: source.id,
    evidence: records,
    facts,
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  });
}

function baseStopState(): StopPolicyState {
  const source = snapshot();
  const support = evidence(source, "a", {
    claimId: id<ClaimId>("claim-owner"),
  });
  return {
    snapshotId: source.id,
    purpose: "implementation_context",
    coverage: {
      criticalQuestionsTotal: 1,
      criticalQuestionsAnswered: 1,
      questionsTotal: 1,
      questionsAnswered: 1,
      hypothesesTotal: 1,
      hypothesesSupported: 1,
      hypothesesRejected: 0,
      hypothesesUnresolved: 0,
      filesConsidered: 1,
      filesRead: 1,
      filesParsed: 1,
      relationshipHops: 1,
      evidenceIndependentGroups: 1,
      snapshotTruncated: false,
      blockedScopes: [],
    },
    budgetState: createInvestigationBudgetState(budget()),
    evidence: [support],
    facts: [fact(source)],
    findingEvaluations: [findingEvaluation(source, [support])],
    contradictions: [],
    knowledgeGaps: [],
    criticalQuestionsNonApplicable: 0,
    allRequiredEvidenceSatisfied: true,
    internalInvariantFailure: false,
    repositoryChanged: false,
    safetyBlocked: false,
    deterministicResolutionAvailable: false,
    snapshotTruncationBlocksCritical: false,
    searchExhausted: false,
    openDeterministicOperationCount: 0,
    repositoryResolvableGapIds: [],
  };
}

// Evidence and claim evaluation: scenarios 1-20.
scenario("identical evidence insertion is idempotent", () => {
  const source = snapshot();
  const ledger = createEvidenceLedger({ snapshot: source, facts: [fact(source)] });
  const record = evidence(source);
  assert.deepEqual(ledger.add(record), ledger.add(record));
  assert.equal(ledger.snapshot().length, 1);
});

scenario("conflicting evidence id is rejected", () => {
  const source = snapshot();
  const ledger = createEvidenceLedger({ snapshot: source, facts: [fact(source)] });
  ledger.add(evidence(source));
  assert.throws(
    () => ledger.add({ ...evidence(source), summary: "Different safe summary" }),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "record_conflict",
  );
});

scenario("cross-snapshot evidence is rejected", () => {
  const source = snapshot();
  const other = snapshot("b");
  const ledger = createEvidenceLedger({ snapshot: source, facts: [fact(source)] });
  assert.throws(() => ledger.add(evidence(other)));
});

scenario("unknown fact id is rejected", () => {
  const source = snapshot();
  const ledger = createEvidenceLedger({ snapshot: source, facts: [fact(source)] });
  assert.throws(() =>
    ledger.add(evidence(source, "unknown", { factIds: [id<FactId>("fact-missing")] })),
  );
});

scenario("stale evidence does not satisfy a requirement", () => {
  const source = snapshot();
  const result = evaluateEvidenceRequirement({
    requirement: requirement(),
    evidence: [evidence(source, "stale", { current: false })],
    facts: [fact(source)],
  });
  assert.equal(result.satisfied, false);
});

scenario("context-only evidence does not satisfy a requirement", () => {
  const source = snapshot();
  const result = evaluateEvidenceRequirement({
    requirement: requirement(),
    evidence: [evidence(source, "context", { role: "context_only" })],
    facts: [fact(source)],
  });
  assert.equal(result.satisfied, false);
});

scenario("lead alone does not support a claim", () => {
  const source = snapshot();
  const lead = evidence(source, "lead", {
    claimId: id<ClaimId>("claim-owner"),
    strength: "lead",
  });
  const result = evaluateClaim({
    claim: claim(source, [lead.id]),
    evidence: [lead],
    facts: [fact(source)],
    requirements: [requirement("lead", { minimumStrength: "lead" })],
  });
  assert.notEqual(result.claim.status, "supported");
});

scenario("substantial evidence satisfies a matching requirement", () => {
  const source = snapshot();
  assert.equal(
    evaluateEvidenceRequirement({
      requirement: requirement(),
      evidence: [evidence(source)],
      facts: [fact(source)],
    }).satisfied,
    true,
  );
});

scenario("conclusive evidence satisfies a requirement", () => {
  const source = snapshot();
  assert.equal(
    evaluateEvidenceRequirement({
      requirement: requirement("conclusive", { minimumStrength: "conclusive" }),
      evidence: [evidence(source, "conclusive", { strength: "conclusive" })],
      facts: [fact(source)],
    }).satisfied,
    true,
  );
});

scenario("predicate filter is enforced", () => {
  const source = snapshot();
  assert.equal(
    evaluateEvidenceRequirement({
      requirement: requirement("predicate", { acceptedFactPredicates: ["calls"] }),
      evidence: [evidence(source)],
      facts: [fact(source)],
    }).satisfied,
    false,
  );
});

scenario("entity-kind filter is enforced", () => {
  const source = snapshot();
  assert.equal(
    evaluateEvidenceRequirement({
      requirement: requirement("kind", { acceptedEntityKinds: ["route"] }),
      evidence: [evidence(source)],
      facts: [fact(source)],
    }).satisfied,
    false,
  );
});

scenario("insufficient independent groups fail a requirement", () => {
  const source = snapshot();
  const result = evaluateEvidenceRequirement({
    requirement: requirement("groups", { minimumIndependentGroups: 2 }),
    evidence: [evidence(source)],
    facts: [fact(source)],
  });
  assert.equal(result.missingIndependentGroups, 1);
});

scenario("duplicate independence group is counted once", () => {
  const source = snapshot();
  const secondFact = fact(source, "b", "value-b");
  const result = evaluateEvidenceRequirement({
    requirement: requirement("groups", { minimumIndependentGroups: 2 }),
    evidence: [
      evidence(source, "a", { group: "same-group" }),
      evidence(source, "b", {
        group: "same-group",
        factIds: [secondFact.id],
      }),
    ],
    facts: [fact(source), secondFact],
  });
  assert.equal(result.independentGroups.length, 1);
});

scenario("all required requirements are mandatory", () => {
  const source = snapshot();
  const support = evidence(source, "a", { claimId: id<ClaimId>("claim-owner") });
  const result = evaluateClaim({
    claim: claim(source, [support.id]),
    evidence: [support],
    facts: [fact(source)],
    requirements: [
      requirement(),
      requirement("missing", { acceptedFactPredicates: ["calls"] }),
    ],
  });
  assert.notEqual(result.claim.status, "supported");
});

scenario("missing optional requirement does not block support", () => {
  const source = snapshot();
  const support = evidence(source, "a", { claimId: id<ClaimId>("claim-owner") });
  const result = evaluateClaim({
    claim: claim(source, [support.id]),
    evidence: [support],
    facts: [fact(source)],
    requirements: [
      requirement(),
      requirement("optional", {
        acceptedFactPredicates: ["calls"],
        required: false,
      }),
    ],
  });
  assert.equal(result.claim.status, "supported");
});

scenario("contradicting evidence affects claim status", () => {
  const source = snapshot();
  const support = evidence(source, "a", { claimId: id<ClaimId>("claim-owner") });
  const against = evidence(source, "against", {
    claimId: id<ClaimId>("claim-owner"),
    role: "contradicts",
    strength: "substantial",
  });
  const result = evaluateClaim({
    claim: claim(source, [support.id], [against.id]),
    evidence: [support, against],
    facts: [fact(source)],
    requirements: [requirement()],
  });
  assert.equal(result.claim.status, "contradicted");
});

scenario("absence claim needs bounded absence evidence", () => {
  const source = snapshot();
  const support = evidence(source, "a", { claimId: id<ClaimId>("claim-owner") });
  const result = evaluateClaim({
    claim: claim(source, [support.id], [], { type: "absence" }),
    evidence: [support],
    facts: [fact(source)],
    requirements: [requirement()],
  });
  assert.notEqual(result.claim.status, "supported");
});

scenario("claim derivation with unknown fact is rejected", () => {
  const source = snapshot();
  const support = evidence(source, "a", { claimId: id<ClaimId>("claim-owner") });
  const sourceClaim = claim(source, [support.id]);
  sourceClaim.derivation.inputFactIds = [id<FactId>("fact-missing")];
  assert.throws(() =>
    evaluateClaim({
      claim: sourceClaim,
      evidence: [support],
      facts: [fact(source)],
      requirements: [requirement()],
    }),
  );
});

scenario("evidence permutation produces deterministic claim evaluation", () => {
  const source = snapshot();
  const first = evidence(source, "a", { claimId: id<ClaimId>("claim-owner") });
  const secondFact = fact(source, "b", "value-b");
  const second = evidence(source, "b", {
    claimId: id<ClaimId>("claim-owner"),
    factIds: [secondFact.id],
  });
  const sourceClaim = claim(source, [first.id, second.id]);
  const evaluate = (records: EvidenceRecord[]) =>
    evaluateClaim({
      claim: sourceClaim,
      evidence: records,
      facts: [fact(source), secondFact],
      requirements: [requirement()],
    });
  assert.deepEqual(evaluate([first, second]), evaluate([second, first]));
});

scenario("secret-like evidence text is rejected without diagnostic leakage", () => {
  const source = snapshot();
  const ledger = createEvidenceLedger({ snapshot: source, facts: [fact(source)] });
  const unsafe = evidence(source);
  unsafe.summary = "Bearer abcdefghijklmnop";
  assert.throws(
    () => ledger.add(unsafe),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      !error.message.includes("abcdefghijklmnop"),
  );
});

// Hypothesis ledger: scenarios 21-38.
function hypothesisFixture(options: {
  contradictStrength?: EvidenceRecord["strength"];
} = {}) {
  const source = snapshot();
  const support = evidence(source, "support", {
    claimId: id<ClaimId>("claim-owner"),
    factIds: [id<FactId>("fact-a")],
  });
  const against = evidence(source, "against", {
    claimId: id<ClaimId>("claim-owner"),
    role: "contradicts",
    strength: options.contradictStrength ?? "substantial",
    factIds: [id<FactId>("fact-a")],
  });
  const sourceClaim = claim(source, [support.id], []);
  const ledger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: [support, against],
  });
  ledger.add(hypothesis(sourceClaim));
  return { source, support, against, sourceClaim, ledger };
}

scenario("hypothesis transitions open to supported", () => {
  const fixture = hypothesisFixture();
  const result = fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: supportedEvaluation(fixture.source, [fixture.support], fixture.sourceClaim),
    reason: "Required evidence was satisfied.",
    occurredAt: timestamp,
  });
  assert.equal(result.status, "supported");
});

scenario("hypothesis transitions open to rejected", () => {
  const fixture = hypothesisFixture({ contradictStrength: "conclusive" });
  const rejected = evaluateClaim({
    claim: claim(fixture.source, [], [fixture.against.id]),
    evidence: [fixture.against],
    facts: [fact(fixture.source)],
    requirements: [requirement()],
  });
  assert.equal(
    fixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation: rejected,
      reason: "Conclusive contradiction rejected the claim.",
      occurredAt: timestamp,
    }).status,
    "rejected",
  );
});

scenario("hypothesis transitions open to unresolved", () => {
  const fixture = hypothesisFixture();
  assert.equal(
    fixture.ledger.markUnresolved({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      reason: "Required evidence remains incomplete.",
      occurredAt: timestamp,
    }).status,
    "unresolved",
  );
});

scenario("supported hypothesis reopens on material contradiction", () => {
  const fixture = hypothesisFixture();
  fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: supportedEvaluation(fixture.source, [fixture.support], fixture.sourceClaim),
    reason: "Support established the claim.",
    occurredAt: timestamp,
  });
  const contradicted = evaluateClaim({
    claim: claim(fixture.source, [fixture.support.id], [fixture.against.id]),
    evidence: [fixture.support, fixture.against],
    facts: [fact(fixture.source)],
    requirements: [requirement()],
  });
  assert.equal(
    fixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation: contradicted,
      reason: "Material contradiction requires renewed investigation.",
      occurredAt: timestamp,
    }).status,
    "open",
  );
});

scenario("supported hypothesis can become rejected", () => {
  const fixture = hypothesisFixture({ contradictStrength: "conclusive" });
  fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: supportedEvaluation(fixture.source, [fixture.support], fixture.sourceClaim),
    reason: "Support established the claim.",
    occurredAt: timestamp,
  });
  const rejected = evaluateClaim({
    claim: claim(fixture.source, [fixture.support.id], [fixture.against.id]),
    evidence: [fixture.support, fixture.against],
    facts: [fact(fixture.source)],
    requirements: [requirement()],
  });
  assert.equal(
    fixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation: rejected,
      reason: "Conclusive contradiction invalidated the support.",
      occurredAt: timestamp,
    }).status,
    "rejected",
  );
});

scenario("unresolved hypothesis reopens with new evidence", () => {
  const fixture = hypothesisFixture();
  fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    reason: "Evidence was incomplete.",
    occurredAt: timestamp,
  });
  assert.equal(
    fixture.ledger.reopen({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evidenceIds: [fixture.support.id],
      reason: "New evidence is available.",
      occurredAt: timestamp,
    }).status,
    "open",
  );
});

scenario("rejected hypothesis requires new evidence to reopen", () => {
  const fixture = hypothesisFixture({ contradictStrength: "conclusive" });
  const rejected = evaluateClaim({
    claim: claim(fixture.source, [], [fixture.against.id]),
    evidence: [fixture.against],
    facts: [fact(fixture.source)],
    requirements: [requirement()],
  });
  fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: rejected,
    reason: "Conclusive contradiction rejected the claim.",
    occurredAt: timestamp,
  });
  assert.throws(() =>
    fixture.ledger.reopen({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evidenceIds: [fixture.against.id],
      reason: "Old evidence cannot reopen the claim.",
      occurredAt: timestamp,
    }),
  );
});

scenario("no-op hypothesis evaluation preserves revision", () => {
  const fixture = hypothesisFixture();
  const evaluation = supportedEvaluation(fixture.source, [fixture.support], fixture.sourceClaim);
  const first = fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation,
    reason: "Support established the claim.",
    occurredAt: timestamp,
  });
  const second = fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation,
    reason: "Repeated evaluation is a no-op.",
    occurredAt: timestamp,
  });
  assert.equal(second.revision, first.revision);
});

scenario("real hypothesis transition increments revision once", () => {
  const fixture = hypothesisFixture();
  const result = fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    reason: "Evidence was incomplete.",
    occurredAt: timestamp,
  });
  assert.equal(result.revision, 1);
});

scenario("hypothesis history is append-only", () => {
  const fixture = hypothesisFixture();
  fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    reason: "Evidence was incomplete.",
    occurredAt: timestamp,
  });
  fixture.ledger.reopen({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evidenceIds: [fixture.support.id],
    reason: "New evidence is available.",
    occurredAt: timestamp,
  });
  assert.deepEqual(
    fixture.ledger.get(id<HypothesisId>("hypothesis-owner"))!.history.map((item) => item.to),
    ["unresolved", "open"],
  );
});

scenario("hypothesis transition timestamp must be canonical", () => {
  const fixture = hypothesisFixture();
  assert.throws(() =>
    fixture.ledger.markUnresolved({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      reason: "Evidence was incomplete.",
      occurredAt: "2026",
    }),
  );
});

scenario("transition evidence ids are sorted and unique", () => {
  const fixture = hypothesisFixture();
  const result = fixture.ledger.reopen.bind(fixture.ledger);
  fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    reason: "Evidence was incomplete.",
    occurredAt: timestamp,
  });
  const reopened = result({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evidenceIds: [fixture.support.id, fixture.support.id],
    reason: "New evidence is available.",
    occurredAt: timestamp,
  });
  assert.deepEqual(reopened.history.at(-1)!.evidenceIds, [fixture.support.id]);
});

scenario("supported hypothesis requires supported claim", () => {
  const source = snapshot();
  const proposed = claim(source);
  const ledger = createHypothesisLedger({ snapshotId: source.id, claims: [proposed], evidence: [] });
  assert.throws(() =>
    ledger.add(hypothesis(proposed, { status: "supported" })),
  );
});

scenario("blocking contradiction prevents supported hypothesis", () => {
  const fixture = hypothesisFixture();
  const result = fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: supportedEvaluation(fixture.source, [fixture.support], fixture.sourceClaim),
    reason: "Support exists but a contradiction remains.",
    occurredAt: timestamp,
    blockingContradictionIds: ["contradiction-owner"],
  });
  assert.equal(result.status, "open");
});

scenario("competing owner hypotheses remain separate", () => {
  const source = snapshot();
  const firstClaim = claim(source, [], [], { id: id<ClaimId>("claim-a") });
  const secondClaim = claim(source, [], [], { id: id<ClaimId>("claim-b") });
  const ledger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [firstClaim, secondClaim],
    evidence: [],
  });
  ledger.add(hypothesis(firstClaim, { id: id<HypothesisId>("hypothesis-a") }));
  ledger.add(hypothesis(secondClaim, { id: id<HypothesisId>("hypothesis-b") }));
  assert.equal(ledger.snapshot().length, 2);
});

scenario("rejected hypothesis remains in ledger", () => {
  const fixture = hypothesisFixture({ contradictStrength: "conclusive" });
  const rejected = evaluateClaim({
    claim: claim(fixture.source, [], [fixture.against.id]),
    evidence: [fixture.against],
    facts: [fact(fixture.source)],
    requirements: [requirement()],
  });
  fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: rejected,
    reason: "Conclusive contradiction rejected the claim.",
    occurredAt: timestamp,
  });
  assert.equal(fixture.ledger.snapshot()[0]!.status, "rejected");
});

scenario("hypothesis ledger returns defensive clones", () => {
  const fixture = hypothesisFixture();
  const read = fixture.ledger.get(id<HypothesisId>("hypothesis-owner"))!;
  read.openQuestionIds.push(id<KnowledgeGapId>("gap-mutated"));
  assert.deepEqual(
    fixture.ledger.get(id<HypothesisId>("hypothesis-owner"))!.openQuestionIds,
    [],
  );
});

scenario("hypothesis insertion order does not affect snapshot", () => {
  const source = snapshot();
  const firstClaim = claim(source, [], [], { id: id<ClaimId>("claim-a") });
  const secondClaim = claim(source, [], [], { id: id<ClaimId>("claim-b") });
  const create = (reverse: boolean) => {
    const ledger = createHypothesisLedger({
      snapshotId: source.id,
      claims: [firstClaim, secondClaim],
      evidence: [],
    });
    const entries = [
      hypothesis(firstClaim, { id: id<HypothesisId>("hypothesis-a") }),
      hypothesis(secondClaim, { id: id<HypothesisId>("hypothesis-b") }),
    ];
    (reverse ? entries.reverse() : entries).forEach((entry) => ledger.add(entry));
    return ledger.snapshot();
  };
  assert.deepEqual(create(false), create(true));
});

// Contradiction and gap registries: scenarios 39-54.
function contradictionFixture() {
  const source = snapshot();
  const sourceClaim = claim(source);
  const support = evidence(source, "support", { claimId: sourceClaim.id });
  const against = evidence(source, "against", {
    claimId: sourceClaim.id,
    role: "contradicts",
  });
  const registry = createContradictionRegistry({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: [support, against],
  });
  return { source, sourceClaim, support, against, registry };
}

scenario("contradiction insertion is idempotent", () => {
  const fixture = contradictionFixture();
  const record = contradiction(
    fixture.source,
    fixture.sourceClaim.id,
    [fixture.support.id, fixture.against.id],
  );
  assert.deepEqual(fixture.registry.add(record), fixture.registry.add(record));
});

scenario("conflicting contradiction id is rejected", () => {
  const fixture = contradictionFixture();
  const record = contradiction(
    fixture.source,
    fixture.sourceClaim.id,
    [fixture.against.id, fixture.support.id],
  );
  fixture.registry.add(record);
  assert.throws(() => fixture.registry.add({ ...record, severity: "material" }));
});

scenario("blocking open contradiction is listed", () => {
  const fixture = contradictionFixture();
  fixture.registry.add(
    contradiction(fixture.source, fixture.sourceClaim.id, [
      fixture.support.id,
      fixture.against.id,
    ]),
  );
  assert.equal(fixture.registry.listBlocking().length, 1);
});

scenario("resolved contradiction stops blocking", () => {
  const fixture = contradictionFixture();
  const record = fixture.registry.add(
    contradiction(fixture.source, fixture.sourceClaim.id, [
      fixture.support.id,
      fixture.against.id,
    ]),
  );
  fixture.registry.resolve({
    id: record.id,
    summary: "Current evidence resolved the contradiction.",
    evidenceIds: [fixture.support.id],
    resolvedAt: timestamp,
  });
  assert.equal(fixture.registry.listBlocking().length, 0);
});

scenario("accepted ambiguity is preserved distinctly", () => {
  const fixture = contradictionFixture();
  const record = fixture.registry.add(
    contradiction(fixture.source, fixture.sourceClaim.id, [
      fixture.support.id,
      fixture.against.id,
    ]),
  );
  assert.equal(
    fixture.registry.acceptAmbiguity({
      id: record.id,
      summary: "Both repository variants are legitimate.",
      evidenceIds: [fixture.support.id],
      resolvedAt: timestamp,
    }).status,
    "accepted_ambiguity",
  );
});

scenario("legitimate multiple owners do not create contradiction automatically", () => {
  const fixture = contradictionFixture();
  const second = evidence(fixture.source, "second", {
    claimId: fixture.sourceClaim.id,
    factIds: [id<FactId>("fact-b")],
  });
  assert.equal(
    detectDeterministicContradictions({
      claim: {
        ...fixture.sourceClaim,
        derivation: {
          ...fixture.sourceClaim.derivation,
          inputFactIds: [id<FactId>("fact-a"), id<FactId>("fact-b")],
        },
      },
      evidence: [fixture.support, second],
      facts: [fact(fixture.source), fact(fixture.source, "b", "value-b")],
      claimRequiresSingleValue: false,
    }).length,
    0,
  );
});

scenario("mutually exclusive single values create contradiction", () => {
  const fixture = contradictionFixture();
  const second = evidence(fixture.source, "second", {
    claimId: fixture.sourceClaim.id,
    factIds: [id<FactId>("fact-b")],
  });
  assert.equal(
    detectDeterministicContradictions({
      claim: {
        ...fixture.sourceClaim,
        derivation: {
          ...fixture.sourceClaim.derivation,
          inputFactIds: [id<FactId>("fact-a"), id<FactId>("fact-b")],
        },
      },
      evidence: [fixture.support, second],
      facts: [fact(fixture.source), fact(fixture.source, "b", "value-b")],
      claimRequiresSingleValue: true,
    }).some((item) => item.type === "multiple_owners"),
    true,
  );
});

scenario("weak leads do not create contradiction", () => {
  const fixture = contradictionFixture();
  const weakSupport = { ...fixture.support, strength: "lead" as const };
  const weakAgainst = { ...fixture.against, strength: "lead" as const };
  assert.deepEqual(
    detectDeterministicContradictions({
      claim: fixture.sourceClaim,
      evidence: [weakSupport, weakAgainst],
      facts: [fact(fixture.source)],
    }),
    [],
  );
});

scenario("gap insertion is idempotent", () => {
  const source = snapshot();
  const registry = createKnowledgeGapRegistry({ snapshotId: source.id });
  const record = gap(source);
  assert.deepEqual(registry.add(record), registry.add(record));
});

scenario("blocking gap is listed", () => {
  const source = snapshot();
  const registry = createKnowledgeGapRegistry({ snapshotId: source.id });
  registry.add(gap(source));
  assert.equal(registry.listBlocking().length, 1);
});

scenario("resolved gap stops blocking", () => {
  const source = snapshot();
  const registry = createKnowledgeGapRegistry({ snapshotId: source.id });
  const record = registry.add(gap(source));
  registry.resolve(record.id);
  assert.equal(registry.listBlocking().length, 0);
});

scenario("ambiguous intent gap is clarification eligible", () => {
  const source = snapshot();
  const record = gap(source, "intent", { category: "ambiguous_user_intent" });
  assert.equal(record.category, "ambiguous_user_intent");
  assert.ok(record.blocks.includes("authorization"));
});

scenario("safety gap is safety eligible", () => {
  const source = snapshot();
  const record = gap(source, "safety", { category: "safety_restricted" });
  assert.equal(record.category, "safety_restricted");
});

scenario("unreadable source remains a gap rather than internal error", () => {
  const source = snapshot();
  const registry = createKnowledgeGapRegistry({ snapshotId: source.id });
  assert.equal(
    registry.add(gap(source, "unreadable", { category: "unreadable_source" })).status,
    "open",
  );
});

scenario("suggested operations remain proposals", () => {
  const source = snapshot();
  const registry = createKnowledgeGapRegistry({ snapshotId: source.id });
  const record = registry.add(
    gap(source, "proposal", {
      suggestedOperations: [
        {
          type: "search_symbols",
          reason: "Find a deterministic owner candidate.",
          questionIds: [],
          hypothesisIds: [],
        },
      ],
    }),
  );
  assert.deepEqual(record.suggestedOperations.map((item) => item.type), ["search_symbols"]);
  assert.equal("status" in record.suggestedOperations[0]!, false);
});

scenario("gap and contradiction ordering is deterministic", () => {
  const source = snapshot();
  const gaps = createKnowledgeGapRegistry({ snapshotId: source.id });
  gaps.add(gap(source, "z"));
  gaps.add(gap(source, "a"));
  assert.deepEqual(gaps.snapshot().map((item) => item.id), ["gap-a", "gap-z"]);
  const fixture = contradictionFixture();
  fixture.registry.add(
    contradiction(
      fixture.source,
      fixture.sourceClaim.id,
      [fixture.support.id, fixture.against.id],
      "z",
    ),
  );
  fixture.registry.add(
    contradiction(
      fixture.source,
      fixture.sourceClaim.id,
      [fixture.support.id, fixture.against.id],
      "a",
    ),
  );
  assert.deepEqual(
    fixture.registry.snapshot().map((item) => item.id),
    ["contradiction-a", "contradiction-z"],
  );
});

// Budget and coverage: scenarios 55-70.
scenario("budget usage aggregates operation cost", () => {
  const state = applyOperationCost(
    createInvestigationBudgetState(budget()),
    cost({ operations: 1, fileReads: 1, fileBytes: 3 }),
  );
  assert.deepEqual(
    [state.usage.operations, state.usage.fileReads, state.usage.fileBytes],
    [1, 1, 3],
  );
});

scenario("negative NaN and Infinity costs are rejected", () => {
  const state = createInvestigationBudgetState(budget());
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => applyOperationCost(state, cost({ operations: value })));
  }
});

scenario("operation budget exhaustion is recorded", () => {
  const state = applyOperationCost(
    createInvestigationBudgetState(budget({ maxOperations: 1 })),
    cost({ operations: 1 }),
  );
  assert.ok(state.exhausted.includes("operations"));
});

scenario("file-read budget exhaustion is recorded", () => {
  const state = applyOperationCost(
    createInvestigationBudgetState(budget({ maxFileReads: 1 })),
    cost({ fileReads: 1 }),
  );
  assert.ok(state.exhausted.includes("file_reads"));
});

scenario("byte budget exhaustion is recorded", () => {
  const state = applyOperationCost(
    createInvestigationBudgetState(budget({ maxFileBytes: 1 })),
    cost({ fileBytes: 1 }),
  );
  assert.ok(state.exhausted.includes("file_bytes"));
});

scenario("time budget exhaustion is recorded", () => {
  const state = applyOperationCost(
    createInvestigationBudgetState(budget({ maxWallTimeMs: 1 })),
    cost({ wallTimeMs: 1 }),
  );
  assert.ok(state.exhausted.includes("wall_time"));
});

scenario("planner-round budget exhaustion is recorded", () => {
  const state = applyOperationCost(
    createInvestigationBudgetState(budget({ maxPlannerRounds: 1 })),
    cost({ plannerRounds: 1 }),
  );
  assert.ok(state.exhausted.includes("planner_rounds"));
});

scenario("exhausted limits are stable and unique", () => {
  const state = applyOperationCost(
    createInvestigationBudgetState(budget({ maxOperations: 1, maxFileReads: 1 })),
    cost({ operations: 1, fileReads: 1 }),
  );
  assert.deepEqual(state.exhausted, ["operations", "file_reads"]);
});

scenario("budget usage never decreases", () => {
  const initial = createInvestigationBudgetState(budget());
  const next = applyOperationCost(initial, cost({ operations: 1 }));
  assert.ok(next.usage.operations >= initial.usage.operations);
  assert.equal(canFitOperationCost(next, cost({ operations: 1 })), true);
});

scenario("coverage deduplicates files", () => {
  const source = snapshot();
  const coverage = calculateInvestigationCoverage({
    snapshotId: source.id,
    questions: [],
    hypotheses: [],
    evidence: [],
    filesConsidered: ["file-a", "file-a"],
    filesRead: ["file-a", "file-a"],
    filesParsed: ["file-a", "file-a"],
    relationshipHops: 0,
    snapshotTruncated: false,
    blockedScopes: [],
  });
  assert.deepEqual(
    [coverage.filesConsidered, coverage.filesRead, coverage.filesParsed],
    [1, 1, 1],
  );
});

scenario("partially answered questions are not fully answered", () => {
  const source = snapshot();
  const coverage = calculateInvestigationCoverage({
    snapshotId: source.id,
    questions: [question("partial", "partially_answered")],
    hypotheses: [],
    evidence: [],
    filesConsidered: [],
    filesRead: [],
    filesParsed: [],
    relationshipHops: 0,
    snapshotTruncated: false,
    blockedScopes: [],
  });
  assert.equal(coverage.questionsAnswered, 0);
});

scenario("coverage counts independence groups uniquely", () => {
  const source = snapshot();
  const coverage = calculateInvestigationCoverage({
    snapshotId: source.id,
    questions: [],
    hypotheses: [],
    evidence: [
      evidence(source, "a", { group: "same-group" }),
      evidence(source, "b", { group: "same-group" }),
    ],
    filesConsidered: [],
    filesRead: [],
    filesParsed: [],
    relationshipHops: 0,
    snapshotTruncated: false,
    blockedScopes: [],
  });
  assert.equal(coverage.evidenceIndependentGroups, 1);
});

scenario("coverage hypothesis status counts are correct", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const coverage = calculateInvestigationCoverage({
    snapshotId: source.id,
    questions: [],
    hypotheses: [
      hypothesis(sourceClaim, { id: id<HypothesisId>("hypothesis-a"), status: "supported" }),
      hypothesis(sourceClaim, { id: id<HypothesisId>("hypothesis-b"), status: "rejected" }),
      hypothesis(sourceClaim, { id: id<HypothesisId>("hypothesis-c"), status: "unresolved" }),
    ],
    evidence: [],
    filesConsidered: [],
    filesRead: [],
    filesParsed: [],
    relationshipHops: 0,
    snapshotTruncated: false,
    blockedScopes: [],
  });
  assert.deepEqual(
    [coverage.hypothesesSupported, coverage.hypothesesRejected, coverage.hypothesesUnresolved],
    [1, 1, 1],
  );
});

scenario("coverage preserves snapshot truncation", () => {
  const source = snapshot();
  const coverage = calculateInvestigationCoverage({
    snapshotId: source.id,
    questions: [],
    hypotheses: [],
    evidence: [],
    filesConsidered: [],
    filesRead: [],
    filesParsed: [],
    relationshipHops: 0,
    snapshotTruncated: true,
    blockedScopes: [],
  });
  assert.equal(coverage.snapshotTruncated, true);
});

scenario("coverage blocked scopes are stable sorted", () => {
  const source = snapshot();
  const coverage = calculateInvestigationCoverage({
    snapshotId: source.id,
    questions: [],
    hypotheses: [],
    evidence: [],
    filesConsidered: [],
    filesRead: [],
    filesParsed: [],
    relationshipHops: 0,
    snapshotTruncated: false,
    blockedScopes: ["z-scope", "a-scope", "z-scope"],
  });
  assert.deepEqual(coverage.blockedScopes, ["a-scope", "z-scope"]);
});

scenario("coverage does not expose confidence", () => {
  const state = baseStopState().coverage as unknown as Record<string, unknown>;
  assert.equal(Object.hasOwn(state, "confidence"), false);
});

// Stop policy: scenarios 71-90.
function stoppedReason(state: StopPolicyState) {
  const decision = createStopPolicy().evaluate(state);
  assert.equal(decision.action, "stop");
  return decision.action === "stop" ? decision.stop : assert.fail("Expected stop");
}

scenario("internal error has highest stop priority", () => {
  const state = baseStopState();
  state.internalInvariantFailure = true;
  state.repositoryChanged = true;
  assert.equal(stoppedReason(state).reason, "internal_error");
});

scenario("repository changed beats sufficient evidence", () => {
  const state = baseStopState();
  state.repositoryChanged = true;
  assert.equal(stoppedReason(state).reason, "repository_changed");
});

scenario("safety block beats sufficient evidence", () => {
  const state = baseStopState();
  state.safetyBlocked = true;
  assert.equal(stoppedReason(state).reason, "safety_blocked");
});

scenario("sufficient evidence beats simultaneous final budget exhaustion", () => {
  const state = baseStopState();
  state.budgetState = applyOperationCost(
    createInvestigationBudgetState(budget({ maxOperations: 1 })),
    cost({ operations: 1 }),
  );
  assert.equal(stoppedReason(state).reason, "sufficient_evidence");
});

scenario("material ambiguous intent requires clarification", () => {
  const state = baseStopState();
  state.knowledgeGaps = [gap(snapshot(), "intent", { category: "ambiguous_user_intent" })];
  assert.equal(stoppedReason(state).reason, "clarification_required");
});

scenario("repository-resolvable gap does not require clarification", () => {
  const state = baseStopState();
  const intentGap = gap(snapshot(), "intent", { category: "ambiguous_user_intent" });
  state.knowledgeGaps = [intentGap];
  state.repositoryResolvableGapIds = [intentGap.id];
  const decision = createStopPolicy().evaluate(state);
  assert.notEqual(decision.action === "stop" ? decision.stop.reason : "continue", "clarification_required");
});

scenario("blocking unresolved contradiction stops investigation", () => {
  const state = baseStopState();
  state.contradictions = [
    contradiction(snapshot(), id<ClaimId>("claim-owner"), [id<EvidenceId>("evidence-a")]),
  ];
  assert.equal(stoppedReason(state).reason, "contradictory_evidence");
});

scenario("operation budget produces canonical stop", () => {
  const state = baseStopState();
  state.allRequiredEvidenceSatisfied = false;
  state.budgetState = applyOperationCost(
    createInvestigationBudgetState(budget({ maxOperations: 1 })),
    cost({ operations: 1 }),
  );
  assert.equal(stoppedReason(state).reason, "operation_budget_exhausted");
});

scenario("file budget produces canonical stop", () => {
  const state = baseStopState();
  state.allRequiredEvidenceSatisfied = false;
  state.budgetState = applyOperationCost(
    createInvestigationBudgetState(budget({ maxFileReads: 1 })),
    cost({ fileReads: 1 }),
  );
  assert.equal(stoppedReason(state).reason, "file_budget_exhausted");
});

scenario("byte budget produces canonical stop", () => {
  const state = baseStopState();
  state.allRequiredEvidenceSatisfied = false;
  state.budgetState = applyOperationCost(
    createInvestigationBudgetState(budget({ maxFileBytes: 1 })),
    cost({ fileBytes: 1 }),
  );
  assert.equal(stoppedReason(state).reason, "byte_budget_exhausted");
});

scenario("time budget produces canonical stop", () => {
  const state = baseStopState();
  state.allRequiredEvidenceSatisfied = false;
  state.budgetState = applyOperationCost(
    createInvestigationBudgetState(budget({ maxWallTimeMs: 1 })),
    cost({ wallTimeMs: 1 }),
  );
  assert.equal(stoppedReason(state).reason, "time_budget_exhausted");
});

scenario("planner round budget produces canonical stop", () => {
  const state = baseStopState();
  state.allRequiredEvidenceSatisfied = false;
  state.budgetState = applyOperationCost(
    createInvestigationBudgetState(budget({ maxPlannerRounds: 1 })),
    cost({ plannerRounds: 1 }),
  );
  assert.equal(stoppedReason(state).reason, "planner_round_budget_exhausted");
});

scenario("truncated snapshot stops only when critical scope is blocked", () => {
  const blocked = baseStopState();
  blocked.allRequiredEvidenceSatisfied = false;
  blocked.coverage.snapshotTruncated = true;
  blocked.snapshotTruncationBlocksCritical = true;
  assert.equal(stoppedReason(blocked).reason, "repository_snapshot_truncated");
  const notBlocked = baseStopState();
  notBlocked.allRequiredEvidenceSatisfied = false;
  notBlocked.coverage.snapshotTruncated = true;
  const decision = createStopPolicy().evaluate(notBlocked);
  assert.notEqual(
    decision.action === "stop" ? decision.stop.reason : "continue",
    "repository_snapshot_truncated",
  );
});

scenario("no grounded lead requires exhausted deterministic leads", () => {
  const state = baseStopState();
  state.allRequiredEvidenceSatisfied = false;
  state.evidence = [];
  state.findingEvaluations = [];
  state.searchExhausted = true;
  assert.equal(stoppedReason(state).reason, "no_grounded_lead");
});

scenario("ordinary unreadable gap does not cause internal error", () => {
  const state = baseStopState();
  state.allRequiredEvidenceSatisfied = false;
  state.knowledgeGaps = [
    gap(snapshot(), "unreadable", {
      category: "unreadable_source",
      blocks: [],
    }),
  ];
  const decision = createStopPolicy().evaluate(state);
  assert.notEqual(decision.action === "stop" ? decision.stop.reason : "continue", "internal_error");
});

scenario("unresolved finding is not safe to project", () => {
  const source = snapshot();
  const support = evidence(source);
  const evaluation = findingEvaluation(
    source,
    [support],
    finding(source, [support.id], { status: "unresolved" }),
  );
  assert.equal(evaluation.safeToProject, false);
});

scenario("probable finding is at most review required", () => {
  const source = snapshot();
  const support = evidence(source);
  const evaluation = findingEvaluation(
    source,
    [support],
    finding(source, [support.id], { status: "probable" }),
  );
  assert.equal(evaluation.finding.authorizationHint, "review_required");
});

scenario("confirmed eligible finding enables sufficient evidence", () => {
  assert.equal(stoppedReason(baseStopState()).reason, "sufficient_evidence");
});

scenario("unknown numeric-like confidence field is rejected", () => {
  const withConfidence = {
    ...baseStopState(),
    confidence: 0.99,
  } as StopPolicyState;
  assert.throws(
    () => createStopPolicy().evaluate(withConfidence),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "invalid_record",
  );
});

scenario("domain input permutation preserves semantic stop decision", () => {
  const state = baseStopState();
  const first = gap(snapshot(), "a", { category: "unreadable_source", blocks: [] });
  const second = gap(snapshot(), "z", { category: "unreadable_source", blocks: [] });
  state.allRequiredEvidenceSatisfied = false;
  state.knowledgeGaps = [first, second];
  const reverse = { ...state, knowledgeGaps: [second, first] };
  assert.deepEqual(
    createStopPolicy().evaluate(state),
    createStopPolicy().evaluate(reverse),
  );
});

// Runtime-boundary and invariant regressions: scenarios 91-101.
scenario("evidence accessors are rejected without invocation", () => {
  const source = snapshot();
  const ledger = createEvidenceLedger({ snapshot: source, facts: [fact(source)] });
  const raw = evidence(source) as EvidenceRecord;
  let getterCalls = 0;
  Object.defineProperty(raw, "summary", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "Unsafe accessor output";
    },
  });
  assert.throws(() => ledger.add(raw));
  assert.equal(getterCalls, 0);
});

scenario("unknown evidence fields are rejected before storage", () => {
  const source = snapshot();
  const ledger = createEvidenceLedger({ snapshot: source, facts: [fact(source)] });
  const raw = { ...evidence(source), unexpected: "safe-but-unknown" } as EvidenceRecord;
  assert.throws(() => ledger.add(raw));
  assert.equal(ledger.snapshot().length, 0);
});

scenario("contradictory evidence freshness flags are rejected", () => {
  const source = snapshot();
  const ledger = createEvidenceLedger({ snapshot: source, facts: [fact(source)] });
  const raw = evidence(source);
  raw.freshness.reason = "stale";
  assert.throws(() => ledger.add(raw));
});

scenario("contradiction resolution rejects unknown evidence", () => {
  const fixture = contradictionFixture();
  const record = fixture.registry.add(
    contradiction(fixture.source, fixture.sourceClaim.id, [
      fixture.support.id,
      fixture.against.id,
    ]),
  );
  assert.throws(() =>
    fixture.registry.resolve({
      id: record.id,
      summary: "Unknown evidence cannot resolve a contradiction.",
      evidenceIds: [id<EvidenceId>("evidence-missing")],
      resolvedAt: timestamp,
    }),
  );
});

scenario("cross-snapshot knowledge gap is rejected", () => {
  const source = snapshot();
  const registry = createKnowledgeGapRegistry({ snapshotId: source.id });
  assert.throws(() => registry.add(gap(snapshot("b"))));
});

scenario("unknown suggested operation type is rejected", () => {
  const source = snapshot();
  const registry = createKnowledgeGapRegistry({ snapshotId: source.id });
  const raw = gap(source, "operation", {
    suggestedOperations: [
      {
        type: "execute_repository" as never,
        reason: "This unsupported proposal must remain rejected.",
        questionIds: [],
        hypothesisIds: [],
      },
    ],
  });
  assert.throws(() => registry.add(raw));
});

scenario("estimated budget overflow is rejected", () => {
  const state = applyOperationCost(
    createInvestigationBudgetState(budget({ maxOperations: Number.MAX_SAFE_INTEGER })),
    cost({ operations: 1 }),
  );
  assert.throws(
    () => canFitOperationCost(state, cost({ operations: Number.MAX_SAFE_INTEGER })),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "numeric_overflow",
  );
});

scenario("coverage rejects cross-snapshot evidence", () => {
  const source = snapshot();
  assert.throws(() =>
    calculateInvestigationCoverage({
      snapshotId: source.id,
      questions: [],
      hypotheses: [],
      evidence: [evidence(snapshot("b"))],
      filesConsidered: [],
      filesRead: [],
      filesParsed: [],
      relationshipHops: 0,
      snapshotTruncated: false,
      blockedScopes: [],
    }),
  );
});

scenario("stop decision budget state is a defensive clone", () => {
  const state = baseStopState();
  const result = stoppedReason(state);
  result.budgetState.usage.operations = 99;
  assert.equal(state.budgetState.usage.operations, 0);
});

scenario("secret-like knowledge gap text is rejected safely", () => {
  const source = snapshot();
  const registry = createKnowledgeGapRegistry({ snapshotId: source.id });
  const raw = gap(source);
  raw.question = "Bearer abcdefghijklmnop";
  assert.throws(
    () => registry.add(raw),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      !error.message.includes("abcdefghijklmnop"),
  );
});

scenario("stale support reopens a supported hypothesis", () => {
  const source = snapshot();
  const current = evidence(source, "current", {
    claimId: id<ClaimId>("claim-owner"),
  });
  const stale = evidence(source, "stale", {
    claimId: id<ClaimId>("claim-owner"),
    current: false,
  });
  const sourceClaim = claim(source, [current.id]);
  const ledger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: [current, stale],
  });
  ledger.add(hypothesis(sourceClaim));
  ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: supportedEvaluation(source, [current], sourceClaim),
    reason: "Current evidence supported the claim.",
    occurredAt: timestamp,
  });
  const staleEvaluation = evaluateClaim({
    claim: claim(source, [stale.id]),
    evidence: [stale],
    facts: [fact(source)],
    requirements: [requirement()],
  });
  assert.equal(
    ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation: staleEvaluation,
      reason: "The previous supporting evidence is no longer current.",
      occurredAt: timestamp,
    }).status,
    "open",
  );
});

scenario("same source chain cannot manufacture independent groups", () => {
  const source = snapshot();
  const result = evaluateEvidenceRequirement({
    requirement: requirement("independence", { minimumIndependentGroups: 2 }),
    evidence: [
      evidence(source, "a", { group: "group-a" }),
      evidence(source, "b", { group: "group-b" }),
    ],
    facts: [fact(source)],
  });
  assert.equal(result.independentGroups.length, 1);
});

scenario("evidence without facts or source spans is rejected", () => {
  const source = snapshot();
  const ledger = createEvidenceLedger({ snapshot: source, facts: [fact(source)] });
  const raw = evidence(source);
  raw.factIds = [];
  assert.throws(() => ledger.add(raw));
});

scenario("blocking contradiction makes finding ineligible", () => {
  const source = snapshot();
  const support = evidence(source, "a", { claimId: id<ClaimId>("claim-owner") });
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [contradiction(source, id<ClaimId>("claim-owner"), [support.id])],
    knowledgeGaps: [],
  });
  assert.equal(result.eligible, false);
});

scenario("blocking authorization gap makes finding ineligible", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [gap(source)],
  });
  assert.equal(result.finding.authorizationHint, "not_eligible");
});

// CE2-03A evaluator boundary: scenarios 106-113.
scenario("requirement evaluator rejects evidence from another snapshot", () => {
  const source = snapshot();
  assert.throws(
    () =>
      evaluateEvidenceRequirement({
        requirement: requirement(),
        evidence: [evidence(snapshot("b"))],
        facts: [fact(source)],
        snapshotId: source.id,
      }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "snapshot_mismatch",
  );
});

scenario("current evidence cannot use stale freshness reason", () => {
  const source = snapshot();
  const malformed = evidence(source);
  malformed.freshness.reason = "stale";
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(),
      evidence: [malformed],
      facts: [fact(source)],
      snapshotId: source.id,
    }),
  );
});

scenario("non-current evidence cannot use snapshot-match freshness", () => {
  const source = snapshot();
  const malformed = evidence(source, "stale", { current: false });
  malformed.freshness.reason = "snapshot_match";
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(),
      evidence: [malformed],
      facts: [fact(source)],
      snapshotId: source.id,
    }),
  );
});

scenario("requirement evaluator rejects unknown fact ids", () => {
  const source = snapshot();
  assert.throws(
    () =>
      evaluateEvidenceRequirement({
        requirement: requirement(),
        evidence: [
          evidence(source, "unknown", {
            factIds: [id<FactId>("fact-missing")],
          }),
        ],
        facts: [fact(source)],
        snapshotId: source.id,
      }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "unknown_reference",
  );
});

scenario("inactive facts do not satisfy evidence requirements", () => {
  const source = snapshot();
  const inactive = { ...fact(source), status: "invalidated" as const };
  const result = evaluateEvidenceRequirement({
    requirement: requirement(),
    evidence: [evidence(source)],
    facts: [inactive],
    snapshotId: source.id,
  });
  assert.equal(result.satisfied, false);
});

scenario("malformed evidence role and strength are rejected", () => {
  const source = snapshot();
  const malformedRole = {
    ...evidence(source),
    role: "maybe" as EvidenceRecord["role"],
  };
  const malformedStrength = {
    ...evidence(source),
    strength: "absolute" as EvidenceRecord["strength"],
  };
  for (const record of [malformedRole, malformedStrength]) {
    assert.throws(() =>
      evaluateEvidenceRequirement({
        requirement: requirement(),
        evidence: [record],
        facts: [fact(source)],
        snapshotId: source.id,
      }),
    );
  }
});

scenario("validated evidence still satisfies its requirement", () => {
  const source = snapshot();
  assert.equal(
    evaluateEvidenceRequirement({
      requirement: requirement(),
      evidence: [evidence(source)],
      facts: [fact(source)],
      snapshotId: source.id,
    }).satisfied,
    true,
  );
});

scenario("requirement evaluator does not invoke evidence accessors", () => {
  const source = snapshot();
  const raw = evidence(source);
  let getterCalls = 0;
  Object.defineProperty(raw, "role", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "supports";
    },
  });
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(),
      evidence: [raw],
      facts: [fact(source)],
      snapshotId: source.id,
    }),
  );
  assert.equal(getterCalls, 0);
});

// CE2-03A deterministic contradiction semantics: scenarios 114-120.
scenario("stale and current evidence for the same value do not conflict", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const current = evidence(source, "current", { claimId: sourceClaim.id });
  const stale = evidence(source, "stale", {
    claimId: sourceClaim.id,
    current: false,
  });
  const result = detectDeterministicContradictions({
    claim: sourceClaim,
    evidence: [stale, current],
    facts: [fact(source)],
  });
  assert.equal(result.some((item) => item.type === "stale_vs_current"), false);
});

scenario("stale and current different values create a contradiction", () => {
  const source = snapshot();
  const sourceClaim = claim(source, [], [], {
    derivation: {
      ruleId: "rule.owner",
      ruleVersion: "1.0.0",
      inputFactIds: [id<FactId>("fact-a"), id<FactId>("fact-b")],
    },
  });
  const current = evidence(source, "current", {
    claimId: sourceClaim.id,
    factIds: [id<FactId>("fact-b")],
  });
  const stale = evidence(source, "stale", {
    claimId: sourceClaim.id,
    current: false,
    factIds: [id<FactId>("fact-a")],
  });
  const result = detectDeterministicContradictions({
    claim: sourceClaim,
    evidence: [current, stale],
    facts: [
      fact(source, "a", "owner-old"),
      fact(source, "b", "owner-current"),
    ],
  });
  assert.equal(result.some((item) => item.type === "stale_vs_current"), true);
});

scenario("unrelated fact objects do not create multiple owners", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const primary = evidence(source, "primary", { claimId: sourceClaim.id });
  const context = evidence(source, "context", {
    claimId: sourceClaim.id,
    factIds: [id<FactId>("fact-context")],
  });
  const result = detectDeterministicContradictions({
    claim: sourceClaim,
    evidence: [primary, context],
    facts: [
      fact(source),
      fact(source, "context", "other-value", "imports"),
    ],
    claimRequiresSingleValue: true,
  });
  assert.equal(result.some((item) => item.type === "multiple_owners"), false);
});

scenario("two relevant owner facts create multiple owners", () => {
  const source = snapshot();
  const sourceClaim = claim(source, [], [], {
    derivation: {
      ruleId: "rule.owner",
      ruleVersion: "1.0.0",
      inputFactIds: [id<FactId>("fact-a"), id<FactId>("fact-b")],
    },
  });
  const first = evidence(source, "first", { claimId: sourceClaim.id });
  const second = evidence(source, "second", {
    claimId: sourceClaim.id,
    factIds: [id<FactId>("fact-b")],
  });
  assert.equal(
    detectDeterministicContradictions({
      claim: sourceClaim,
      evidence: [first, second],
      facts: [fact(source), fact(source, "b", "owner-b")],
      claimRequiresSingleValue: true,
    }).some((item) => item.type === "multiple_owners"),
    true,
  );
});

scenario("contradiction registry rejects evidence for another claim", () => {
  const source = snapshot();
  const claimA = claim(source, [], [], { id: id<ClaimId>("claim-a") });
  const claimB = claim(source, [], [], { id: id<ClaimId>("claim-b") });
  const evidenceB = evidence(source, "claim-b", { claimId: claimB.id });
  const registry = createContradictionRegistry({
    snapshotId: source.id,
    claims: [claimA, claimB],
    evidence: [evidenceB],
  });
  assert.throws(() =>
    registry.add(
      contradiction(source, claimA.id, [evidenceB.id], "cross-claim", {
        type: "custom",
      }),
    ),
  );
});

scenario("multiple owners remain legitimate when single value is false", () => {
  const source = snapshot();
  const sourceClaim = claim(source, [], [], {
    derivation: {
      ruleId: "rule.owner",
      ruleVersion: "1.0.0",
      inputFactIds: [id<FactId>("fact-a"), id<FactId>("fact-b")],
    },
  });
  const records = [
    evidence(source, "a", { claimId: sourceClaim.id }),
    evidence(source, "b", {
      claimId: sourceClaim.id,
      factIds: [id<FactId>("fact-b")],
    }),
  ];
  assert.equal(
    detectDeterministicContradictions({
      claim: sourceClaim,
      evidence: records,
      facts: [fact(source), fact(source, "b", "owner-b")],
      claimRequiresSingleValue: false,
    }).some((item) => item.type === "multiple_owners"),
    false,
  );
});

scenario("contradiction detection is independent of input ordering", () => {
  const source = snapshot();
  const sourceClaim = claim(source, [], [], {
    derivation: {
      ruleId: "rule.owner",
      ruleVersion: "1.0.0",
      inputFactIds: [id<FactId>("fact-a"), id<FactId>("fact-b")],
    },
  });
  const records = [
    evidence(source, "a", { claimId: sourceClaim.id }),
    evidence(source, "b", {
      claimId: sourceClaim.id,
      factIds: [id<FactId>("fact-b")],
    }),
  ];
  const facts = [fact(source), fact(source, "b", "owner-b")];
  const evaluate = (reverse: boolean) =>
    detectDeterministicContradictions({
      claim: sourceClaim,
      evidence: reverse ? [...records].reverse() : records,
      facts: reverse ? [...facts].reverse() : facts,
      claimRequiresSingleValue: true,
    });
  assert.deepEqual(evaluate(false), evaluate(true));
});

// CE2-03A hypothesis transaction atomicity: scenarios 121-127.
scenario("invalid transition timestamp preserves hypothesis state", () => {
  const fixture = hypothesisFixture();
  const before = fixture.ledger.snapshot();
  assert.throws(() =>
    fixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation: supportedEvaluation(
        fixture.source,
        [fixture.support],
        fixture.sourceClaim,
      ),
      reason: "Support was observed.",
      occurredAt: "2026",
    }),
  );
  assert.deepEqual(fixture.ledger.snapshot(), before);
});

scenario("failed evaluation cannot poison the internal claim", () => {
  const fixture = hypothesisFixture();
  assert.throws(() =>
    fixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation: supportedEvaluation(
        fixture.source,
        [fixture.support],
        fixture.sourceClaim,
      ),
      reason: "Support was observed.",
      occurredAt: "invalid",
    }),
  );
  assert.throws(() =>
    fixture.ledger.add(
      hypothesis(fixture.sourceClaim, {
        id: id<HypothesisId>("hypothesis-poison-check"),
        status: "supported",
        supportingEvidenceIds: [fixture.support.id],
      }),
    ),
  );
});

scenario("unknown transition evidence leaves claims and hypotheses unchanged", () => {
  const fixture = hypothesisFixture();
  const evaluation = supportedEvaluation(
    fixture.source,
    [fixture.support],
    fixture.sourceClaim,
  );
  evaluation.currentSupportingEvidenceIds = [id<EvidenceId>("evidence-missing")];
  const before = fixture.ledger.snapshot();
  assert.throws(() =>
    fixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation,
      reason: "Unknown evidence must be rejected.",
      occurredAt: timestamp,
    }),
  );
  assert.deepEqual(fixture.ledger.snapshot(), before);
});

scenario("invalid reason and operation id preserve ledger state", () => {
  const fixture = hypothesisFixture();
  const evaluation = supportedEvaluation(
    fixture.source,
    [fixture.support],
    fixture.sourceClaim,
  );
  const before = fixture.ledger.snapshot();
  assert.throws(() =>
    fixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation,
      reason: "Bearer abcdefghijklmnop",
      occurredAt: timestamp,
    }),
  );
  assert.throws(() =>
    fixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation,
      reason: "A safe transition reason.",
      operationId: "operation with spaces" as never,
      occurredAt: timestamp,
    }),
  );
  assert.deepEqual(fixture.ledger.snapshot(), before);
});

scenario("successful claim transition commits claim and hypothesis together", () => {
  const fixture = hypothesisFixture();
  const transitioned = fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: supportedEvaluation(
      fixture.source,
      [fixture.support],
      fixture.sourceClaim,
    ),
    reason: "Support established the claim.",
    occurredAt: timestamp,
  });
  assert.equal(transitioned.status, "supported");
  assert.doesNotThrow(() =>
    fixture.ledger.add(
      hypothesis(fixture.sourceClaim, {
        id: id<HypothesisId>("hypothesis-atomic-check"),
        status: "supported",
        supportingEvidenceIds: [fixture.support.id],
      }),
    ),
  );
});

scenario("failed hypothesis operation has an identical before and after snapshot", () => {
  const fixture = hypothesisFixture();
  const before = fixture.ledger.snapshot();
  assert.throws(() =>
    fixture.ledger.markUnresolved({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      reason: "Invalid timestamp must not mutate state.",
      occurredAt: "2026-01-01",
    }),
  );
  assert.deepEqual(fixture.ledger.snapshot(), before);
});

scenario("no-op claim evaluation leaves ledger snapshot unchanged", () => {
  const fixture = hypothesisFixture();
  const evaluation = supportedEvaluation(
    fixture.source,
    [fixture.support],
    fixture.sourceClaim,
  );
  fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation,
    reason: "Support established the claim.",
    occurredAt: timestamp,
  });
  const before = fixture.ledger.snapshot();
  fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation,
    reason: "Repeated support is a no-op.",
    occurredAt: timestamp,
  });
  assert.deepEqual(fixture.ledger.snapshot(), before);
});

// CE2-03A zero-budget semantics: scenarios 128-132.
scenario("zero operation budget starts exhausted", () => {
  assert.deepEqual(
    createInvestigationBudgetState(budget({ maxOperations: 0 })).exhausted,
    ["operations"],
  );
});

scenario("multiple zero budgets use canonical exhausted ordering", () => {
  const state = createInvestigationBudgetState(
    budget({
      maxOperations: 0,
      maxFileReads: 0,
      maxParsedFiles: 0,
      maxWallTimeMs: 0,
    }),
  );
  assert.deepEqual(state.exhausted, [
    "operations",
    "file_reads",
    "parsed_files",
    "wall_time",
  ]);
});

scenario("zero concurrent operation budget remains invalid", () => {
  assert.throws(() =>
    createInvestigationBudgetState(budget({ maxConcurrentOperations: 0 })),
  );
});

scenario("zero operation cost fits zero numeric limits without overflow", () => {
  const state = createInvestigationBudgetState(
    budget({
      maxOperations: 0,
      maxFileReads: 0,
      maxFileBytes: 0,
      maxParsedFiles: 0,
      maxRelationshipHops: 0,
      maxWallTimeMs: 0,
      maxPlannerRounds: 0,
    }),
  );
  assert.equal(canFitOperationCost(state, zeroCost()), true);
});

scenario("positive investigation budgets retain normal capacity", () => {
  const state = createInvestigationBudgetState(budget());
  assert.equal(canFitOperationCost(state, cost({ operations: 1 })), true);
  assert.deepEqual(state.exhausted, []);
});

// CE2-03A coverage and stop-policy consistency: scenarios 133-142.
scenario("stop policy rejects answered questions above total", () => {
  const state = baseStopState();
  state.coverage.questionsAnswered = 2;
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("stop policy rejects critical answers above critical total", () => {
  const state = baseStopState();
  state.coverage.criticalQuestionsAnswered = 2;
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("stop policy rejects hypothesis status sums above total", () => {
  const state = baseStopState();
  state.coverage.hypothesesRejected = 1;
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("stop policy rejects parsed files above files read", () => {
  const state = baseStopState();
  state.coverage.filesParsed = 2;
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("stop policy rejects files read above files considered", () => {
  const state = baseStopState();
  state.coverage.filesRead = 2;
  state.coverage.filesParsed = 0;
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("critical truncation block requires snapshot truncation", () => {
  const state = baseStopState();
  state.snapshotTruncationBlocksCritical = true;
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("stop policy rejects unknown repository-resolvable gap ids", () => {
  const state = baseStopState();
  state.repositoryResolvableGapIds = [id<KnowledgeGapId>("gap-missing")];
  assert.throws(
    () => createStopPolicy().evaluate(state),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "unknown_reference",
  );
});

scenario("stop policy rejects forged finding eligibility", () => {
  const state = baseStopState();
  state.findingEvaluations = [
    {
      ...state.findingEvaluations[0]!,
      eligible: false,
    },
  ];
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("valid aggregate state still reaches sufficient evidence", () => {
  assert.equal(stoppedReason(baseStopState()).reason, "sufficient_evidence");
});

scenario("canonical budget stop priority remains stable with zero limits", () => {
  const state = baseStopState();
  state.allRequiredEvidenceSatisfied = false;
  state.budgetState = createInvestigationBudgetState(
    budget({ maxOperations: 0, maxFileReads: 0, maxWallTimeMs: 0 }),
  );
  assert.equal(stoppedReason(state).reason, "operation_budget_exhausted");
});

// CE2-03A finding blocking-gap semantics: scenarios 143-149.
scenario("authorization-blocking gap prevents finding eligibility", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [gap(source, "authorization", { blocks: ["authorization"] })],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.finding.authorizationHint, "not_eligible");
});

scenario("projection-blocking gap prevents safe projection", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [gap(source, "projection", { blocks: ["projection"] })],
  });
  assert.equal(result.safeToProject, false);
  assert.equal(result.eligible, false);
});

scenario("finding-blocking gap prevents eligibility", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [gap(source, "finding", { blocks: ["finding"] })],
  });
  assert.equal(result.eligible, false);
});

scenario("resolved projection gap no longer blocks a finding", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [
      gap(source, "projection", {
        blocks: ["projection"],
        status: "resolved",
      }),
    ],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.safeToProject, true);
});

scenario("non-blocking unreadable gap does not affect a finding", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [
      gap(source, "unreadable", {
        category: "unreadable_source",
        blocks: [],
      }),
    ],
  });
  assert.equal(result.eligible, true);
});

scenario("probable finding is not projectable through a projection gap", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id], { status: "probable" }),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [gap(source, "projection", { blocks: ["projection"] })],
  });
  assert.equal(result.safeToProject, false);
  assert.equal(result.finding.authorizationHint, "not_eligible");
});

scenario("blocking-gap limitations are deterministically ordered", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [
      gap(source, "multi", {
        blocks: ["authorization", "finding", "projection"],
      }),
    ],
  });
  assert.deepEqual(result.limitations, [
    "blocking_authorization_gap",
    "blocking_finding_gap",
    "blocking_projection_gap",
  ]);
});

// CE2-03B duplicate-id context validation.
scenario("claim evaluator rejects conflicting evidence ids", () => {
  const source = snapshot();
  const first = evidence(source, "duplicate");
  const conflicting = { ...first, summary: "Different observed evidence." };
  assert.throws(
    () =>
      evaluateClaim({
        claim: claim(source, [first.id]),
        evidence: [first, conflicting],
        facts: [fact(source)],
        requirements: [requirement()],
      }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "record_conflict",
  );
});

scenario("conflicting evidence permutation cannot change claim status", () => {
  const source = snapshot();
  const first = evidence(source, "duplicate");
  const conflicting = {
    ...first,
    role: "contradicts" as const,
  };
  const evaluate = (records: EvidenceRecord[]) => {
    try {
      evaluateClaim({
        claim: claim(source, [first.id]),
        evidence: records,
        facts: [fact(source)],
        requirements: [requirement()],
      });
      return "accepted";
    } catch (error) {
      return error instanceof InvestigationDomainError ? error.code : "raw";
    }
  };
  assert.equal(evaluate([first, conflicting]), "record_conflict");
  assert.equal(evaluate([conflicting, first]), "record_conflict");
});

scenario("identical duplicate evidence is evaluator-idempotent", () => {
  const source = snapshot();
  const support = evidence(source);
  const evaluate = (records: EvidenceRecord[]) =>
    evaluateClaim({
      claim: claim(source, [support.id]),
      evidence: records,
      facts: [fact(source)],
      requirements: [requirement()],
    });
  assert.deepEqual(evaluate([support, structuredClone(support)]), evaluate([support]));
});

scenario("finding evaluator rejects conflicting evidence ids", () => {
  const source = snapshot();
  const support = evidence(source);
  const conflicting = { ...support, strength: "lead" as const };
  assert.throws(
    () =>
      evaluateFindingEligibility({
        finding: finding(source, [support.id]),
        snapshotId: source.id,
        evidence: [support, conflicting],
        facts: [fact(source)],
        entities: [entity(source)],
        contradictions: [],
        knowledgeGaps: [],
      }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "record_conflict",
  );
});

scenario("finding evaluator rejects conflicting entity ids", () => {
  const source = snapshot();
  const support = evidence(source);
  const owner = entity(source);
  const conflicting = { ...owner, displayName: "Different owner" };
  assert.throws(() =>
    evaluateFindingEligibility({
      finding: finding(source, [support.id]),
      snapshotId: source.id,
      evidence: [support],
      facts: [fact(source)],
      entities: [owner, conflicting],
      contradictions: [],
      knowledgeGaps: [],
    }),
  );
});

scenario("ledgers reject conflicting claim and evidence contexts", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const conflictingClaim = {
    ...sourceClaim,
    statement: "A conflicting claim statement.",
  };
  assert.throws(() =>
    createHypothesisLedger({
      snapshotId: source.id,
      claims: [sourceClaim, conflictingClaim],
      evidence: [],
    }),
  );
  const support = evidence(source, "duplicate", { claimId: sourceClaim.id });
  const conflictingEvidence = { ...support, summary: "Different evidence." };
  assert.throws(() =>
    createContradictionRegistry({
      snapshotId: source.id,
      claims: [sourceClaim],
      evidence: [support, conflictingEvidence],
    }),
  );
});

scenario("duplicate questions and hypotheses do not inflate coverage", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const sourceQuestion = question("duplicate", "answered");
  const sourceHypothesis = hypothesis(sourceClaim);
  const coverage = calculateInvestigationCoverage({
    snapshotId: source.id,
    questions: [sourceQuestion, structuredClone(sourceQuestion)],
    hypotheses: [sourceHypothesis, structuredClone(sourceHypothesis)],
    evidence: [],
    filesConsidered: [],
    filesRead: [],
    filesParsed: [],
    relationshipHops: 0,
    snapshotTruncated: false,
    blockedScopes: [],
  });
  assert.equal(coverage.questionsTotal, 1);
  assert.equal(coverage.hypothesesTotal, 1);
});

scenario("deduplicated context evaluation is input-order independent", () => {
  const source = snapshot();
  const first = evidence(source, "a", { group: "group-a" });
  const second = evidence(source, "b", { group: "group-b" });
  const evaluate = (records: EvidenceRecord[]) =>
    evaluateEvidenceRequirement({
      requirement: requirement("ordered", { minimumIndependentGroups: 2 }),
      evidence: records,
      facts: [fact(source)],
      snapshotId: source.id,
    });
  assert.deepEqual(
    evaluate([first, second, structuredClone(first)]),
    evaluate([second, first, structuredClone(second)]),
  );
});

scenario("stop policy rejects conflicting duplicate evidence", () => {
  const state = baseStopState();
  state.evidence = [
    state.evidence[0]!,
    { ...state.evidence[0]!, summary: "Conflicting stop evidence." },
  ];
  assert.throws(
    () => createStopPolicy().evaluate(state),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "record_conflict",
  );
});

scenario("unsafe conflicting ids do not leak through domain errors", () => {
  const source = snapshot();
  const unsafeValue = "Bearer abcdefghijklmnop";
  const raw = {
    ...evidence(source),
    id: unsafeValue as EvidenceId,
  };
  assert.throws(
    () =>
      evaluateClaim({
        claim: claim(source),
        evidence: [raw, { ...raw, summary: "Different safe summary." }],
        facts: [fact(source)],
        requirements: [requirement()],
      }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      !error.message.includes("abcdefghijklmnop") &&
      error.recordId === undefined,
  );
});

// CE2-03B evidence-requirement role boundary.
scenario("context-only requirement input role is rejected", () => {
  const source = snapshot();
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(),
      evidence: [evidence(source)],
      facts: [fact(source)],
      snapshotId: source.id,
      role: "context_only" as never,
    }),
  );
});

scenario("unknown and non-string requirement roles are rejected", () => {
  const source = snapshot();
  for (const role of ["unknown", 42]) {
    assert.throws(() =>
      evaluateEvidenceRequirement({
        requirement: requirement(),
        evidence: [evidence(source)],
        facts: [fact(source)],
        snapshotId: source.id,
        role: role as never,
      }),
    );
  }
});

scenario("context-only evidence cannot satisfy supporting requirements", () => {
  const source = snapshot();
  assert.equal(
    evaluateEvidenceRequirement({
      requirement: requirement(),
      evidence: [evidence(source, "context", { role: "context_only" })],
      facts: [fact(source)],
      snapshotId: source.id,
      role: "supports",
    }).satisfied,
    false,
  );
});

scenario("context-only evidence cannot satisfy contradicting requirements", () => {
  const source = snapshot();
  assert.equal(
    evaluateEvidenceRequirement({
      requirement: requirement(),
      evidence: [evidence(source, "context", { role: "context_only" })],
      facts: [fact(source)],
      snapshotId: source.id,
      role: "contradicts",
    }).satisfied,
    false,
  );
});

scenario("supporting and contradicting requirement roles remain valid", () => {
  const source = snapshot();
  for (const role of ["supports", "contradicts"] as const) {
    const record = evidence(source, role, { role });
    assert.equal(
      evaluateEvidenceRequirement({
        requirement: requirement(),
        evidence: [record],
        facts: [fact(source)],
        snapshotId: source.id,
        role,
      }).satisfied,
      true,
    );
  }
});

// CE2-03B same-status hypothesis updates.
function contradictedHypothesisFixture() {
  const fixture = hypothesisFixture();
  const evaluation = evaluateClaim({
    claim: claim(
      fixture.source,
      [fixture.support.id],
      [fixture.against.id],
    ),
    evidence: [fixture.support, fixture.against],
    facts: [fact(fixture.source)],
    requirements: [requirement()],
  });
  return { ...fixture, evaluation };
}

scenario("open hypothesis remains open for a contradicted claim", () => {
  const fixture = contradictedHypothesisFixture();
  const result = fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: fixture.evaluation,
    reason: "Current contradiction keeps the hypothesis open.",
    occurredAt: timestamp,
  });
  assert.equal(result.status, "open");
});

scenario("same-status update stores the contradicted claim", () => {
  const fixture = contradictedHypothesisFixture();
  fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: fixture.evaluation,
    reason: "Current contradiction updates the claim.",
    occurredAt: timestamp,
  });
  assert.equal(fixture.ledger.getClaim(fixture.sourceClaim.id)!.status, "contradicted");
});

scenario("same-status update stores contradicting evidence basis", () => {
  const fixture = contradictedHypothesisFixture();
  const result = fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: fixture.evaluation,
    reason: "Current contradiction updates the evidence basis.",
    occurredAt: timestamp,
  });
  assert.deepEqual(result.contradictingEvidenceIds, [fixture.against.id]);
});

scenario("same-status material update does not append history", () => {
  const fixture = contradictedHypothesisFixture();
  const result = fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: fixture.evaluation,
    reason: "No status transition is required.",
    occurredAt: timestamp,
  });
  assert.equal(result.revision, 0);
  assert.deepEqual(result.history, []);
});

scenario("identical repeated same-status evaluation is a true no-op", () => {
  const fixture = contradictedHypothesisFixture();
  const input = {
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: fixture.evaluation,
    reason: "The same evaluated state was observed.",
    occurredAt: timestamp,
  };
  fixture.ledger.applyClaimEvaluation(input);
  const hypothesisBefore = fixture.ledger.snapshot();
  const claimBefore = fixture.ledger.getClaim(fixture.sourceClaim.id);
  fixture.ledger.applyClaimEvaluation(input);
  assert.deepEqual(fixture.ledger.snapshot(), hypothesisBefore);
  assert.deepEqual(fixture.ledger.getClaim(fixture.sourceClaim.id), claimBefore);
});

scenario("supported hypothesis accepts a new compatible evidence basis", () => {
  const source = snapshot();
  const first = evidence(source, "first", {
    claimId: id<ClaimId>("claim-owner"),
  });
  const secondFact = fact(source, "b", "value-b");
  const second = evidence(source, "second", {
    claimId: id<ClaimId>("claim-owner"),
    factIds: [secondFact.id],
  });
  const sourceClaim = claim(source, [first.id]);
  const ledger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: [first, second],
  });
  ledger.add(hypothesis(sourceClaim));
  ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: evaluateClaim({
      claim: sourceClaim,
      evidence: [first],
      facts: [fact(source)],
      requirements: [requirement()],
    }),
    reason: "Initial support established the hypothesis.",
    occurredAt: timestamp,
  });
  const revisionBefore = ledger.get(id<HypothesisId>("hypothesis-owner"))!.revision;
  const expandedClaim = claim(source, [first.id, second.id]);
  const result = ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: evaluateClaim({
      claim: expandedClaim,
      evidence: [second, first],
      facts: [secondFact, fact(source)],
      requirements: [requirement()],
    }),
    reason: "Additional compatible support expanded the basis.",
    occurredAt: timestamp,
  });
  assert.deepEqual(result.supportingEvidenceIds, [first.id, second.id].sort());
  assert.equal(result.revision, revisionBefore);
  assert.equal(result.history.length, 1);
});

scenario("invalid same-status update is fully atomic", () => {
  const fixture = contradictedHypothesisFixture();
  const invalid = structuredClone(fixture.evaluation);
  invalid.currentContradictingEvidenceIds = [fixture.support.id];
  const hypothesisBefore = fixture.ledger.snapshot();
  const claimBefore = fixture.ledger.getClaim(fixture.sourceClaim.id);
  assert.throws(() =>
    fixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation: invalid,
      reason: "Incompatible evidence must not be committed.",
      occurredAt: timestamp,
    }),
  );
  assert.deepEqual(fixture.ledger.snapshot(), hypothesisBefore);
  assert.deepEqual(fixture.ledger.getClaim(fixture.sourceClaim.id), claimBefore);
});

// CE2-03B transition evidence consistency.
scenario("initial history rejects evidence for another claim", () => {
  const source = snapshot();
  const claimA = claim(source, [], [], { id: id<ClaimId>("claim-a") });
  const claimB = claim(source, [], [], { id: id<ClaimId>("claim-b") });
  const evidenceB = evidence(source, "claim-b", { claimId: claimB.id });
  const ledger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [claimA, claimB],
    evidence: [evidenceB],
  });
  assert.throws(() =>
    ledger.add(
      hypothesis(claimA, {
        id: id<HypothesisId>("hypothesis-a"),
        status: "unresolved",
        revision: 1,
        history: [
          {
            from: "open",
            to: "unresolved",
            reason: "The evidence is not claim-compatible.",
            evidenceIds: [evidenceB.id],
            occurredAt: timestamp,
          },
        ],
      }),
    ),
  );
});

scenario("markUnresolved rejects evidence for another claim", () => {
  const source = snapshot();
  const claimA = claim(source, [], [], { id: id<ClaimId>("claim-a") });
  const claimB = claim(source, [], [], { id: id<ClaimId>("claim-b") });
  const evidenceB = evidence(source, "claim-b", { claimId: claimB.id });
  const ledger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [claimA, claimB],
    evidence: [evidenceB],
  });
  ledger.add(hypothesis(claimA, { id: id<HypothesisId>("hypothesis-a") }));
  assert.throws(() =>
    ledger.markUnresolved({
      hypothesisId: id<HypothesisId>("hypothesis-a"),
      evidenceIds: [evidenceB.id],
      reason: "Cross-claim evidence cannot transition the hypothesis.",
      occurredAt: timestamp,
    }),
  );
});

scenario("reopen rejects evidence from another snapshot", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const crossSnapshot = evidence(snapshot("b"), "cross");
  const ledger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: [crossSnapshot],
  });
  ledger.add(hypothesis(sourceClaim));
  ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    reason: "Evidence remains incomplete.",
    occurredAt: timestamp,
  });
  assert.throws(() =>
    ledger.reopen({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evidenceIds: [crossSnapshot.id],
      reason: "Cross-snapshot evidence cannot reopen the hypothesis.",
      occurredAt: timestamp,
    }),
  );
});

scenario("claim-neutral context evidence can mark a hypothesis unresolved", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const context = evidence(source, "context", { role: "context_only" });
  const ledger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: [context],
  });
  ledger.add(hypothesis(sourceClaim));
  const result = ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evidenceIds: [context.id],
    reason: "Context evidence explains the unresolved state.",
    occurredAt: timestamp,
  });
  assert.deepEqual(result.history[0]!.evidenceIds, [context.id]);
});

scenario("supported and rejected transition evidence remains compatible", () => {
  const supportedFixture = hypothesisFixture();
  assert.equal(
    supportedFixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation: supportedEvaluation(
        supportedFixture.source,
        [supportedFixture.support],
        supportedFixture.sourceClaim,
      ),
      reason: "Supporting evidence is claim-compatible.",
      occurredAt: timestamp,
    }).status,
    "supported",
  );
  const rejectedFixture = hypothesisFixture({ contradictStrength: "conclusive" });
  const rejected = evaluateClaim({
    claim: claim(rejectedFixture.source, [], [rejectedFixture.against.id]),
    evidence: [rejectedFixture.against],
    facts: [fact(rejectedFixture.source)],
    requirements: [requirement()],
  });
  assert.equal(
    rejectedFixture.ledger.applyClaimEvaluation({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evaluation: rejected,
      reason: "Contradicting evidence is claim-compatible.",
      occurredAt: timestamp,
    }).status,
    "rejected",
  );
});

// CE2-03B cross-snapshot finding safety.
scenario("probable finding with cross-snapshot evidence is not projectable", () => {
  const source = snapshot();
  const cross = snapshot("b");
  const crossEvidence = {
    ...evidence(cross, "cross", { factIds: [] }),
    sourceSpans: [sourceSpan(cross)],
  };
  const result = evaluateFindingEligibility({
    finding: finding(source, [crossEvidence.id], { status: "probable" }),
    snapshotId: source.id,
    evidence: [crossEvidence],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.equal(result.finding.authorizationHint, "not_eligible");
  assert.equal(result.safeToProject, false);
  assert.ok(result.limitations.includes("cross_snapshot_evidence"));
});

scenario("probable finding with cross-snapshot entity is not projectable", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id], { status: "probable" }),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(snapshot("b"))],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.equal(result.finding.authorizationHint, "not_eligible");
  assert.equal(result.safeToProject, false);
  assert.ok(result.limitations.includes("cross_snapshot_entity"));
});

scenario("probable finding with cross-snapshot evidence and entity is unsafe", () => {
  const source = snapshot();
  const cross = snapshot("b");
  const crossEvidence = {
    ...evidence(cross, "cross", { factIds: [] }),
    sourceSpans: [sourceSpan(cross)],
  };
  const result = evaluateFindingEligibility({
    finding: finding(source, [crossEvidence.id], { status: "probable" }),
    snapshotId: source.id,
    evidence: [crossEvidence],
    facts: [fact(source)],
    entities: [entity(cross)],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.deepEqual(
    result.limitations.filter((item) => item.startsWith("cross_snapshot")),
    ["cross_snapshot_entity", "cross_snapshot_evidence"],
  );
  assert.equal(result.safeToProject, false);
});

scenario("same-snapshot probable finding remains review-required", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id], { status: "probable" }),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.equal(result.finding.authorizationHint, "review_required");
  assert.equal(result.safeToProject, true);
});

scenario("probable finding rejects duplicate conflicting evidence", () => {
  const source = snapshot();
  const support = evidence(source);
  assert.throws(() =>
    evaluateFindingEligibility({
      finding: finding(source, [support.id], { status: "probable" }),
      snapshotId: source.id,
      evidence: [support, { ...support, summary: "Conflicting evidence." }],
      facts: [fact(source)],
      entities: [entity(source)],
      contradictions: [],
      knowledgeGaps: [],
    }),
  );
});

// CE2-03B StopPolicy finding integrity.
scenario("confirmed implementation target without entity is rejected", () => {
  const state = baseStopState();
  state.findingEvaluations[0]!.finding.entityIds = [];
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("confirmed implementation target without evidence is rejected", () => {
  const state = baseStopState();
  state.findingEvaluations[0]!.finding.evidenceIds = [];
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("stop policy rejects unknown finding evidence id", () => {
  const state = baseStopState();
  state.findingEvaluations[0]!.finding.evidenceIds = [
    id<EvidenceId>("evidence-missing"),
  ];
  assert.throws(
    () => createStopPolicy().evaluate(state),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "unknown_reference",
  );
});

scenario("stale evidence cannot authorize sufficient evidence", () => {
  const state = baseStopState();
  state.evidence = state.evidence.map((record) => ({
    ...record,
    freshness: {
      ...record.freshness,
      current: false,
      reason: "stale" as const,
    },
  }));
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("contradicting and context-only evidence cannot authorize implementation", () => {
  for (const role of ["contradicts", "context_only"] as const) {
    const state = baseStopState();
    state.evidence = state.evidence.map((record) => ({ ...record, role }));
    assert.throws(() => createStopPolicy().evaluate(state));
  }
});

scenario("lead-only evidence cannot authorize implementation", () => {
  const state = baseStopState();
  state.evidence = state.evidence.map((record) => ({
    ...record,
    strength: "lead" as const,
  }));
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("forged finding eligibility booleans remain rejected", () => {
  const state = baseStopState();
  state.findingEvaluations = [
    { ...state.findingEvaluations[0]!, safeToProject: false },
  ];
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("valid implementation target still provides sufficient evidence", () => {
  assert.equal(stoppedReason(baseStopState()).reason, "sufficient_evidence");
});

scenario("repository safety and budget stop priorities remain canonical", () => {
  const repositoryChanged = baseStopState();
  repositoryChanged.repositoryChanged = true;
  assert.equal(stoppedReason(repositoryChanged).reason, "repository_changed");

  const safetyBlocked = baseStopState();
  safetyBlocked.safetyBlocked = true;
  assert.equal(stoppedReason(safetyBlocked).reason, "safety_blocked");

  const budgetBlocked = baseStopState();
  budgetBlocked.allRequiredEvidenceSatisfied = false;
  budgetBlocked.budgetState = createInvestigationBudgetState(
    budget({ maxOperations: 0 }),
  );
  assert.equal(stoppedReason(budgetBlocked).reason, "operation_budget_exhausted");
});

// CE2-03B single-value contradiction naming.
scenario("two implementation owners produce multiple-owners contradiction", () => {
  const source = snapshot();
  const sourceClaim = claim(source, [], [], {
    derivation: {
      ruleId: "rule.owner",
      ruleVersion: "1.0.0",
      inputFactIds: [id<FactId>("fact-a"), id<FactId>("fact-b")],
    },
  });
  const records = [
    evidence(source, "a", { claimId: sourceClaim.id }),
    evidence(source, "b", {
      claimId: sourceClaim.id,
      factIds: [id<FactId>("fact-b")],
    }),
  ];
  assert.equal(
    detectDeterministicContradictions({
      claim: sourceClaim,
      evidence: records,
      facts: [fact(source), fact(source, "b", "owner-b")],
      claimRequiresSingleValue: true,
    }).some((item) => item.type === "multiple_owners"),
    true,
  );
});

scenario("two configuration values produce mutually-exclusive contradiction", () => {
  const source = snapshot();
  const sourceClaim = claim(source, [], [], {
    type: "configuration",
    derivation: {
      ruleId: "rule.configuration",
      ruleVersion: "1.0.0",
      inputFactIds: [id<FactId>("fact-a"), id<FactId>("fact-b")],
    },
  });
  const records = [
    evidence(source, "a", { claimId: sourceClaim.id }),
    evidence(source, "b", {
      claimId: sourceClaim.id,
      factIds: [id<FactId>("fact-b")],
    }),
  ];
  const detections = detectDeterministicContradictions({
    claim: sourceClaim,
    evidence: records,
    facts: [fact(source), fact(source, "b", "value-b")],
    claimRequiresSingleValue: true,
  });
  assert.equal(
    detections.some((item) => item.type === "mutually_exclusive_claims"),
    true,
  );
  assert.equal(detections.some((item) => item.type === "multiple_owners"), false);
});

scenario("unrelated predicates remain outside single-value conflicts", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const records = [
    evidence(source, "a", { claimId: sourceClaim.id }),
    evidence(source, "b", {
      claimId: sourceClaim.id,
      factIds: [id<FactId>("fact-b")],
    }),
  ];
  assert.deepEqual(
    detectDeterministicContradictions({
      claim: sourceClaim,
      evidence: records,
      facts: [fact(source), fact(source, "b", "other", "imports")],
      claimRequiresSingleValue: true,
    }),
    [],
  );
});

scenario("single-value contradiction naming is order-independent", () => {
  const source = snapshot();
  const sourceClaim = claim(source, [], [], {
    type: "configuration",
    derivation: {
      ruleId: "rule.configuration",
      ruleVersion: "1.0.0",
      inputFactIds: [id<FactId>("fact-a"), id<FactId>("fact-b")],
    },
  });
  const records = [
    evidence(source, "a", { claimId: sourceClaim.id }),
    evidence(source, "b", {
      claimId: sourceClaim.id,
      factIds: [id<FactId>("fact-b")],
    }),
  ];
  const facts = [fact(source), fact(source, "b", "value-b")];
  const evaluate = (reverse: boolean) =>
    detectDeterministicContradictions({
      claim: sourceClaim,
      evidence: reverse ? [...records].reverse() : records,
      facts: reverse ? [...facts].reverse() : facts,
      claimRequiresSingleValue: true,
    });
  assert.deepEqual(evaluate(false), evaluate(true));
});

// CE2-03C shared FactRecord evaluation boundary.
scenario("model-proposed facts are rejected by requirement evaluation", () => {
  const source = snapshot();
  const malformed = {
    ...fact(source),
    provenance: { ...fact(source).provenance, method: "model_proposed" },
  } as unknown as FactRecord;
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(),
      evidence: [evidence(source)],
      facts: [malformed],
      snapshotId: source.id,
    }),
  );
});

scenario("unknown fact strength is rejected by evaluation", () => {
  const source = snapshot();
  const malformed = { ...fact(source), strength: "certain" } as unknown as FactRecord;
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(), evidence: [evidence(source)],
      facts: [malformed], snapshotId: source.id,
    }),
  );
});

scenario("fact source schema rejects additional fields", () => {
  const source = snapshot();
  const original = fact(source);
  const malformed = {
    ...original,
    source: { ...original.source, extra: "safe-extra" },
  } as unknown as FactRecord;
  assert.throws(() =>
    detectDeterministicContradictions({
      claim: claim(source), evidence: [evidence(source)], facts: [malformed],
    }),
  );
});

scenario("fact provenance rejects non-canonical timestamp", () => {
  const source = snapshot();
  const original = fact(source);
  const malformed = {
    ...original,
    provenance: { ...original.provenance, observedAt: "2026" },
  };
  assert.throws(() =>
    evaluateClaim({
      claim: claim(source), evidence: [evidence(source)], facts: [malformed],
      requirements: [requirement()],
    }),
  );
});

scenario("fact subject from another snapshot is rejected", () => {
  const source = snapshot();
  const malformed = { ...fact(source), subject: entity(snapshot("b")) };
  assert.throws(() =>
    evaluateClaim({
      claim: claim(source), evidence: [evidence(source)], facts: [malformed],
      requirements: [requirement()],
    }),
  );
});

scenario("malformed fact literal is rejected", () => {
  const source = snapshot();
  const malformed = {
    ...fact(source),
    object: { type: "boolean", value: "true" },
  } as unknown as FactRecord;
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(), evidence: [evidence(source)],
      facts: [malformed], snapshotId: source.id,
    }),
  );
});

scenario("valid fact still satisfies an evidence requirement", () => {
  const source = snapshot();
  assert.equal(
    evaluateEvidenceRequirement({
      requirement: requirement(), evidence: [evidence(source)],
      facts: [fact(source)], snapshotId: source.id,
    }).satisfied,
    true,
  );
});

scenario("fact accessors are rejected without invocation", () => {
  const source = snapshot();
  const malformed = fact(source);
  let calls = 0;
  Object.defineProperty(malformed, "strength", {
    enumerable: true,
    get() { calls += 1; return "exact"; },
  });
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(), evidence: [evidence(source)],
      facts: [malformed], snapshotId: source.id,
    }),
  );
  assert.equal(calls, 0);
});

// CE2-03C shared EvidenceRecord semantic boundary.
scenario("evidence without a source basis is rejected by evaluators", () => {
  const source = snapshot();
  const malformed = evidence(source, "empty", { factIds: [] });
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(), evidence: [malformed], facts: [],
      snapshotId: source.id,
    }),
  );
});

scenario("numeric evidence summary is rejected", () => {
  const source = snapshot();
  const malformed = { ...evidence(source), summary: 42 } as unknown as EvidenceRecord;
  assert.throws(() =>
    evaluateFindingEligibility({
      finding: finding(source, [malformed.id]), snapshotId: source.id,
      evidence: [malformed], facts: [fact(source)], entities: [entity(source)],
      contradictions: [], knowledgeGaps: [],
    }),
  );
});

scenario("empty evidence independence group is rejected", () => {
  const source = snapshot();
  const malformed = evidence(source, "empty-group", { group: "" });
  assert.throws(() =>
    calculateInvestigationCoverage({
      snapshotId: source.id, questions: [], hypotheses: [], evidence: [malformed],
      filesConsidered: [], filesRead: [], filesParsed: [], relationshipHops: 0,
      snapshotTruncated: false, blockedScopes: [],
    }),
  );
});

scenario("malformed evidence freshness is rejected", () => {
  const source = snapshot();
  const malformed = {
    ...evidence(source),
    freshness: { snapshotId: source.id, current: true, reason: "stale" },
  } as unknown as EvidenceRecord;
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(), evidence: [malformed], facts: [fact(source)],
      snapshotId: source.id,
    }),
  );
});

scenario("unknown evidence role and strength are rejected", () => {
  const source = snapshot();
  for (const malformed of [
    { ...evidence(source), role: "observes" },
    { ...evidence(source), strength: "certain" },
  ] as unknown as EvidenceRecord[]) {
    assert.throws(() =>
      evaluateEvidenceRequirement({
        requirement: requirement(), evidence: [malformed], facts: [fact(source)],
        snapshotId: source.id,
      }),
    );
  }
});

scenario("malformed evidence source span is rejected", () => {
  const source = snapshot();
  const malformed = {
    ...evidence(source, "span", { factIds: [] }),
    sourceSpans: [{ ...sourceSpan(source), endColumn: 0 }],
  };
  assert.throws(() =>
    evaluateEvidenceRequirement({
      requirement: requirement(), evidence: [malformed], facts: [],
      snapshotId: source.id,
    }),
  );
});

scenario("valid source-span-only evidence passes semantic validation", () => {
  const source = snapshot();
  const record = {
    ...evidence(source, "span", { factIds: [] }),
    sourceSpans: [sourceSpan(source)],
  };
  assert.equal(
    evaluateEvidenceRequirement({
      requirement: requirement(), evidence: [record], facts: [],
      snapshotId: source.id,
    }).satisfied,
    false,
  );
});

scenario("malformed evidence cannot make a finding eligible", () => {
  const source = snapshot();
  const malformed = { ...evidence(source), summary: "" };
  assert.throws(() =>
    evaluateFindingEligibility({
      finding: finding(source, [malformed.id]), snapshotId: source.id,
      evidence: [malformed], facts: [fact(source)], entities: [entity(source)],
      contradictions: [], knowledgeGaps: [],
    }),
  );
});

scenario("malformed evidence cannot produce sufficient evidence stop", () => {
  const state = baseStopState();
  state.evidence = [{ ...state.evidence[0]!, independenceGroup: "" }];
  assert.throws(() => createStopPolicy().evaluate(state));
});

// CE2-03C contradiction detector/registry consistency.
function singleValueConflictFixture(type: ClaimRecord["type"]) {
  const source = snapshot();
  const firstFact = fact(source);
  const secondFact = fact(source, "b", "value-b");
  const sourceClaim = claim(source, [], [], {
    type,
    derivation: {
      ruleId: "rule.single-value",
      ruleVersion: "1.0.0",
      inputFactIds: [firstFact.id, secondFact.id].sort(),
    },
  });
  const records = [
    evidence(source, "a", { claimId: sourceClaim.id, factIds: [firstFact.id] }),
    evidence(source, "b", { claimId: sourceClaim.id, factIds: [secondFact.id] }),
  ];
  const detections = detectDeterministicContradictions({
    claim: sourceClaim,
    evidence: records,
    facts: [firstFact, secondFact],
    claimRequiresSingleValue: true,
  });
  return { source, sourceClaim, records, detections };
}

function addDetectionToRegistry(
  fixture: ReturnType<typeof singleValueConflictFixture>,
) {
  const detection = fixture.detections[0]!;
  return createContradictionRegistry({
    snapshotId: fixture.source.id,
    claims: [fixture.sourceClaim],
    evidence: fixture.records,
  }).add({
    id: id<ContradictionId>("contradiction-detected"),
    snapshotId: fixture.source.id,
    claimId: detection.claimId,
    evidenceIds: detection.evidenceIds,
    type: detection.type,
    severity: detection.severity,
    status: "open",
  });
}

scenario("configuration detector output is accepted by contradiction registry", () => {
  const added = addDetectionToRegistry(singleValueConflictFixture("configuration"));
  assert.equal(added.type, "mutually_exclusive_claims");
});

scenario("owner detector output is accepted by contradiction registry", () => {
  const added = addDetectionToRegistry(singleValueConflictFixture("implementation_owner"));
  assert.equal(added.type, "multiple_owners");
});

scenario("supporting and contradicting evidence remains a valid mutual conflict", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const records = [
    evidence(source, "support", { claimId: sourceClaim.id }),
    evidence(source, "against", { claimId: sourceClaim.id, role: "contradicts" }),
  ];
  const registry = createContradictionRegistry({
    snapshotId: source.id, claims: [sourceClaim], evidence: records,
  });
  assert.equal(
    registry.add(contradiction(source, sourceClaim.id, records.map((item) => item.id))).type,
    "mutually_exclusive_claims",
  );
});

scenario("one supporting evidence cannot establish a mutual conflict", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const support = evidence(source, "support", { claimId: sourceClaim.id });
  const registry = createContradictionRegistry({
    snapshotId: source.id, claims: [sourceClaim], evidence: [support],
  });
  assert.throws(() => registry.add(contradiction(source, sourceClaim.id, [support.id])));
});

scenario("stale evidence cannot establish a mutual conflict", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const records = [
    evidence(source, "current", { claimId: sourceClaim.id }),
    evidence(source, "stale", { claimId: sourceClaim.id, current: false }),
  ];
  const registry = createContradictionRegistry({
    snapshotId: source.id, claims: [sourceClaim], evidence: records,
  });
  assert.throws(() =>
    registry.add(contradiction(source, sourceClaim.id, records.map((item) => item.id))),
  );
});

scenario("context-only evidence cannot establish a mutual conflict", () => {
  const source = snapshot();
  const sourceClaim = claim(source);
  const records = [
    evidence(source, "support", { claimId: sourceClaim.id }),
    evidence(source, "context", { claimId: sourceClaim.id, role: "context_only" }),
  ];
  const registry = createContradictionRegistry({
    snapshotId: source.id, claims: [sourceClaim], evidence: records,
  });
  assert.throws(() =>
    registry.add(contradiction(source, sourceClaim.id, records.map((item) => item.id))),
  );
});

scenario("detector and registry results are independent of input order", () => {
  const fixture = singleValueConflictFixture("configuration");
  const reversed = detectDeterministicContradictions({
    claim: fixture.sourceClaim,
    evidence: [...fixture.records].reverse(),
    facts: [fact(fixture.source, "b", "value-b"), fact(fixture.source)],
    claimRequiresSingleValue: true,
  });
  assert.deepEqual(reversed, fixture.detections);
  assert.deepEqual(
    addDetectionToRegistry({ ...fixture, records: [...fixture.records].reverse() }),
    addDetectionToRegistry(fixture),
  );
});

// CE2-03C hypothesis operation boundary.
scenario("reopen rejects an already-open hypothesis", () => {
  const fixture = hypothesisFixture();
  assert.throws(() =>
    fixture.ledger.reopen({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evidenceIds: [fixture.support.id],
      reason: "An open hypothesis cannot be reopened.",
      occurredAt: timestamp,
    }),
  );
});

scenario("reopen rejects a supported hypothesis", () => {
  const fixture = hypothesisFixture();
  fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evaluation: supportedEvaluation(fixture.source, [fixture.support], fixture.sourceClaim),
    reason: "Support establishes the hypothesis.",
    occurredAt: timestamp,
  });
  assert.throws(() =>
    fixture.ledger.reopen({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evidenceIds: [fixture.against.id],
      reason: "Supported hypotheses use claim evaluation to reopen.",
      occurredAt: timestamp,
    }),
  );
});

scenario("reopen accepts new evidence for an unresolved hypothesis", () => {
  const fixture = hypothesisFixture();
  fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    reason: "The basis remains incomplete.",
    occurredAt: timestamp,
  });
  const reopened = fixture.ledger.reopen({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evidenceIds: [fixture.support.id],
    reason: "New support reopens investigation.",
    occurredAt: timestamp,
  });
  assert.equal(reopened.status, "open");
  assert.ok(reopened.supportingEvidenceIds.includes(fixture.support.id));
});

scenario("reopen accepts new evidence for a rejected hypothesis", () => {
  const fixture = hypothesisFixture({ contradictStrength: "conclusive" });
  const rejected = evaluateClaim({
    claim: claim(fixture.source, [], [fixture.against.id]),
    evidence: [fixture.against], facts: [fact(fixture.source)],
    requirements: [requirement()],
  });
  fixture.ledger.applyClaimEvaluation({
    hypothesisId: id<HypothesisId>("hypothesis-owner"), evaluation: rejected,
    reason: "Conclusive contradiction rejects the hypothesis.", occurredAt: timestamp,
  });
  const reopened = fixture.ledger.reopen({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evidenceIds: [fixture.support.id],
    reason: "New support reopens the rejected hypothesis.", occurredAt: timestamp,
  });
  assert.equal(reopened.status, "open");
  assert.ok(reopened.supportingEvidenceIds.includes(fixture.support.id));
});

scenario("already-unresolved mark rejects unknown evidence", () => {
  const fixture = hypothesisFixture();
  fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    reason: "Initial unresolved state.", occurredAt: timestamp,
  });
  assert.throws(() =>
    fixture.ledger.markUnresolved({
      hypothesisId: id<HypothesisId>("hypothesis-owner"),
      evidenceIds: [id<EvidenceId>("evidence-missing")],
      reason: "Unknown evidence must not be ignored.", occurredAt: timestamp,
    }),
  );
});

scenario("already-unresolved mark rejects cross-claim evidence", () => {
  const source = snapshot();
  const claimA = claim(source, [], [], { id: id<ClaimId>("claim-a") });
  const claimB = claim(source, [], [], { id: id<ClaimId>("claim-b") });
  const evidenceB = evidence(source, "claim-b", { claimId: claimB.id });
  const ledger = createHypothesisLedger({
    snapshotId: source.id, claims: [claimA, claimB], evidence: [evidenceB],
  });
  ledger.add(hypothesis(claimA, { id: id<HypothesisId>("hypothesis-a") }));
  ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-a"),
    reason: "Initial unresolved state.", occurredAt: timestamp,
  });
  assert.throws(() => ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-a"), evidenceIds: [evidenceB.id],
    reason: "Cross-claim evidence is incompatible.", occurredAt: timestamp,
  }));
});

scenario("failed same-status hypothesis operation is atomic", () => {
  const fixture = hypothesisFixture();
  fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    reason: "Initial unresolved state.", occurredAt: timestamp,
  });
  const before = fixture.ledger.snapshot();
  assert.throws(() => fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evidenceIds: [id<EvidenceId>("evidence-missing")],
    reason: "This operation must fail atomically.", occurredAt: timestamp,
  }));
  assert.deepEqual(fixture.ledger.snapshot(), before);
});

scenario("successful same-status unresolved update retains evidence basis", () => {
  const fixture = hypothesisFixture();
  const initial = fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    reason: "Initial unresolved state.", occurredAt: timestamp,
  });
  const updated = fixture.ledger.markUnresolved({
    hypothesisId: id<HypothesisId>("hypothesis-owner"),
    evidenceIds: [fixture.support.id],
    reason: "The unresolved basis gained support.", occurredAt: timestamp,
  });
  assert.deepEqual(updated.supportingEvidenceIds, [fixture.support.id]);
  assert.equal(updated.revision, initial.revision);
  assert.deepEqual(updated.history, initial.history);
});

// CE2-03C InvestigationCoverage runtime boundary.
function coverageInput(source = snapshot()) {
  return {
    snapshotId: source.id,
    questions: [question("coverage", "answered")],
    hypotheses: [hypothesis(claim(source), { status: "supported" as const })],
    evidence: [] as EvidenceRecord[],
    filesConsidered: ["src/module.ts"],
    filesRead: ["src/module.ts"],
    filesParsed: ["src/module.ts"],
    relationshipHops: 1,
    snapshotTruncated: false,
    blockedScopes: [] as string[],
  };
}

scenario("coverage rejects numeric question text", () => {
  const input = coverageInput();
  input.questions = [{ ...input.questions[0]!, text: 42 } as unknown as InvestigationQuestion];
  assert.throws(() => calculateInvestigationCoverage(input));
});

scenario("coverage rejects unknown question category", () => {
  const input = coverageInput();
  input.questions = [
    { ...input.questions[0]!, category: "unknown" } as unknown as InvestigationQuestion,
  ];
  assert.throws(() => calculateInvestigationCoverage(input));
});

scenario("coverage rejects non-array answer finding ids", () => {
  const input = coverageInput();
  input.questions = [
    { ...input.questions[0]!, answerFindingIds: "finding-a" } as unknown as InvestigationQuestion,
  ];
  assert.throws(() => calculateInvestigationCoverage(input));
});

scenario("coverage rejects object file identifiers", () => {
  const input = coverageInput();
  input.filesConsidered = [{ path: "src/module.ts" } as never];
  assert.throws(() => calculateInvestigationCoverage(input));
});

scenario("coverage rejects a parsed file outside the read set", () => {
  const input = coverageInput();
  input.filesParsed = ["src/other.ts"];
  assert.throws(() => calculateInvestigationCoverage(input));
});

scenario("coverage rejects a read file outside the considered set", () => {
  const input = coverageInput();
  input.filesRead = ["src/other.ts"];
  input.filesParsed = [];
  assert.throws(() => calculateInvestigationCoverage(input));
});

scenario("duplicate file identifiers do not inflate coverage", () => {
  const input = coverageInput();
  input.filesConsidered = ["src/module.ts", "src/module.ts"];
  input.filesRead = ["src/module.ts", "src/module.ts"];
  input.filesParsed = ["src/module.ts", "src/module.ts"];
  const result = calculateInvestigationCoverage(input);
  assert.equal(result.filesConsidered, 1);
  assert.equal(result.filesRead, 1);
  assert.equal(result.filesParsed, 1);
});

scenario("valid coverage input retains deterministic aggregate semantics", () => {
  assert.deepEqual(calculateInvestigationCoverage(coverageInput()), {
    criticalQuestionsTotal: 1,
    criticalQuestionsAnswered: 1,
    questionsTotal: 1,
    questionsAnswered: 1,
    hypothesesTotal: 1,
    hypothesesSupported: 1,
    hypothesesRejected: 0,
    hypothesesUnresolved: 0,
    filesConsidered: 1,
    filesRead: 1,
    filesParsed: 1,
    relationshipHops: 1,
    evidenceIndependentGroups: 0,
    snapshotTruncated: false,
    blockedScopes: [],
  });
});

// CE2-03C FindingEligibility runtime boundary.
scenario("confirmed finding with empty evidence basis is not eligible", () => {
  const source = snapshot();
  const result = evaluateFindingEligibility({
    finding: finding(source, []), snapshotId: source.id, evidence: [],
    facts: [fact(source)], entities: [entity(source)],
    contradictions: [], knowledgeGaps: [],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.safeToProject, false);
});

scenario("finding evaluation rejects malformed evidence summary and group", () => {
  const source = snapshot();
  for (const malformed of [
    { ...evidence(source), summary: 42 },
    { ...evidence(source), independenceGroup: "" },
  ] as unknown as EvidenceRecord[]) {
    assert.throws(() => evaluateFindingEligibility({
      finding: finding(source, [malformed.id]), snapshotId: source.id,
      evidence: [malformed], facts: [fact(source)], entities: [entity(source)],
      contradictions: [], knowledgeGaps: [],
    }));
  }
});

scenario("finding evaluation rejects malformed entity kind", () => {
  const source = snapshot();
  const support = evidence(source);
  const malformed = { ...entity(source), kind: "service_owner" } as unknown as RepositoryEntity;
  assert.throws(() => evaluateFindingEligibility({
    finding: finding(source, [support.id]), snapshotId: source.id,
    evidence: [support], facts: [fact(source)], entities: [malformed],
    contradictions: [], knowledgeGaps: [],
  }));
});

scenario("finding evaluation rejects malformed contradiction", () => {
  const source = snapshot();
  const support = evidence(source);
  const malformed = contradiction(source, id<ClaimId>("claim-owner"), [support.id], "bad", {
    type: "unknown" as ContradictionRecord["type"],
  });
  assert.throws(() => evaluateFindingEligibility({
    finding: finding(source, [support.id]), snapshotId: source.id,
    evidence: [support], facts: [fact(source)], entities: [entity(source)],
    contradictions: [malformed], knowledgeGaps: [],
  }));
});

scenario("finding evaluation rejects malformed knowledge gap", () => {
  const source = snapshot();
  const support = evidence(source);
  const malformed = gap(source, "bad", {
    category: "unknown" as KnowledgeGap["category"],
  });
  assert.throws(() => evaluateFindingEligibility({
    finding: finding(source, [support.id]), snapshotId: source.id,
    evidence: [support], facts: [fact(source)], entities: [entity(source)],
    contradictions: [], knowledgeGaps: [malformed],
  }));
});

scenario("valid confirmed and probable findings retain eligibility semantics", () => {
  const source = snapshot();
  const support = evidence(source);
  const confirmed = findingEvaluation(source, [support]);
  const probable = evaluateFindingEligibility({
    finding: finding(source, [support.id], { status: "probable" }),
    snapshotId: source.id, evidence: [support], facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [], knowledgeGaps: [],
  });
  assert.equal(confirmed.finding.authorizationHint, "eligible");
  assert.equal(confirmed.safeToProject, true);
  assert.equal(probable.finding.authorizationHint, "review_required");
  assert.equal(probable.safeToProject, true);
});

// CE2-03C StopPolicy runtime boundary.
scenario("malformed safety gap cannot create safety-blocked stop", () => {
  const state = baseStopState();
  state.safetyBlocked = true;
  state.knowledgeGaps = [
    gap(snapshot(), "safety", {
      category: "unknown" as KnowledgeGap["category"],
    }),
  ];
  assert.throws(
    () => createStopPolicy().evaluate(state),
    (error: unknown) => error instanceof InvestigationDomainError,
  );
});

scenario("unknown contradiction type cannot create contradiction stop", () => {
  const state = baseStopState();
  state.allRequiredEvidenceSatisfied = false;
  state.contradictions = [
    contradiction(
      snapshot(), id<ClaimId>("claim-owner"), [state.evidence[0]!.id], "unknown",
      { type: "unknown" as ContradictionRecord["type"] },
    ),
  ];
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("open contradiction with a resolution is rejected", () => {
  const state = baseStopState();
  state.contradictions = [
    contradiction(
      snapshot(), id<ClaimId>("claim-owner"), [state.evidence[0]!.id], "resolved-open",
      {
        resolution: {
          summary: "This resolution is invalid for an open record.",
          evidenceIds: [state.evidence[0]!.id],
          resolvedAt: timestamp,
        },
      },
    ),
  ];
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("malformed evidence cannot create sufficient-evidence stop", () => {
  const state = baseStopState();
  state.evidence = [
    { ...state.evidence[0]!, factIds: [], sourceSpans: [] },
  ];
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("finding evaluation with additional fields is rejected", () => {
  const state = baseStopState();
  state.findingEvaluations = [
    { ...state.findingEvaluations[0]!, confidence: 1 } as FindingEligibilityEvaluation,
  ];
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("valid safety contradiction and sufficient decisions remain canonical", () => {
  const safety = baseStopState();
  safety.safetyBlocked = true;
  safety.knowledgeGaps = [gap(snapshot(), "safety", { category: "safety_restricted" })];
  assert.equal(stoppedReason(safety).reason, "safety_blocked");

  const contradictory = baseStopState();
  contradictory.allRequiredEvidenceSatisfied = false;
  contradictory.contradictions = [
    contradiction(
      snapshot(), id<ClaimId>("claim-owner"), [contradictory.evidence[0]!.id],
      "valid", { type: "custom" },
    ),
  ];
  assert.equal(stoppedReason(contradictory).reason, "contradictory_evidence");
  assert.equal(stoppedReason(baseStopState()).reason, "sufficient_evidence");
});

scenario("closed StopPolicy validation preserves canonical priority ordering", () => {
  const state = baseStopState();
  state.internalInvariantFailure = true;
  state.repositoryChanged = true;
  state.safetyBlocked = true;
  state.knowledgeGaps = [gap(snapshot(), "safety", { category: "safety_restricted" })];
  state.budgetState = createInvestigationBudgetState(budget({ maxOperations: 0 }));
  assert.equal(stoppedReason(state).reason, "internal_error");
});

// CE2-03D FactRecord context and grounded-support boundary.
scenario("finding eligibility rejects the confirmed unknown-fact reproduction", () => {
  const source = snapshot();
  const unknown = evidence(source, "unknown", {
    factIds: [id<FactId>("fact-does-not-exist")],
  });
  assert.throws(
    () => evaluateFindingEligibility({
      finding: finding(source, [unknown.id]),
      snapshotId: source.id,
      evidence: [unknown],
      facts: [fact(source)],
      entities: [entity(source)],
      contradictions: [],
      knowledgeGaps: [],
    }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "unknown_reference",
  );
});

scenario("stop policy rejects the sufficient-evidence unknown-fact reproduction", () => {
  const source = snapshot();
  const state = baseStopState();
  state.evidence = [
    evidence(source, "a", {
      claimId: id<ClaimId>("claim-owner"),
      factIds: [id<FactId>("fact-does-not-exist")],
    }),
  ];
  assert.throws(
    () => createStopPolicy().evaluate(state),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "unknown_reference",
  );
});

scenario("finding fact context rejects facts from another snapshot", () => {
  const source = snapshot();
  const support = evidence(source);
  assert.throws(
    () => evaluateFindingEligibility({
      finding: finding(source, [support.id]),
      snapshotId: source.id,
      evidence: [support],
      facts: [fact(snapshot("b"))],
      entities: [entity(source)],
      contradictions: [],
      knowledgeGaps: [],
    }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "snapshot_mismatch",
  );
});

scenario("finding fact context rejects malformed FactRecord", () => {
  const source = snapshot();
  const support = evidence(source);
  const malformed = {
    ...fact(source),
    strength: "certain",
  } as unknown as FactRecord;
  assert.throws(() => evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [malformed],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  }));
});

scenario("finding fact context rejects conflicting duplicate fact ids", () => {
  const source = snapshot();
  const support = evidence(source);
  const first = fact(source);
  const conflicting = { ...first, predicate: "different_predicate" };
  assert.throws(
    () => evaluateFindingEligibility({
      finding: finding(source, [support.id]),
      snapshotId: source.id,
      evidence: [support],
      facts: [first, conflicting],
      entities: [entity(source)],
      contradictions: [],
      knowledgeGaps: [],
    }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "record_conflict",
  );
});

scenario("identical duplicate facts are idempotent in finding evaluation", () => {
  const source = snapshot();
  const support = evidence(source);
  const sourceFact = fact(source);
  const evaluate = (facts: FactRecord[]) => evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts,
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.deepEqual(
    evaluate([sourceFact, structuredClone(sourceFact)]),
    evaluate([sourceFact]),
  );
});

scenario("invalidated fact-only evidence does not make a finding eligible", () => {
  const source = snapshot();
  const support = evidence(source);
  const invalidated = { ...fact(source), status: "invalidated" as const };
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [invalidated],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.safeToProject, false);
});

scenario("superseded fact-only evidence does not make a finding eligible", () => {
  const source = snapshot();
  const support = evidence(source);
  const superseded = { ...fact(source), status: "superseded" as const };
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [superseded],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.safeToProject, false);
});

scenario("mixed evidence rejects any unresolved fact reference", () => {
  const source = snapshot();
  const mixed = evidence(source, "mixed", {
    factIds: [id<FactId>("fact-a"), id<FactId>("fact-does-not-exist")],
  });
  mixed.sourceSpans = [sourceSpan(source)];
  assert.throws(
    () => evaluateFindingEligibility({
      finding: finding(source, [mixed.id]),
      snapshotId: source.id,
      evidence: [mixed],
      facts: [fact(source)],
      entities: [entity(source)],
      contradictions: [],
      knowledgeGaps: [],
    }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "unknown_reference",
  );
});

scenario("active fact-backed support makes a confirmed finding eligible", () => {
  const source = snapshot();
  const support = evidence(source);
  const result = evaluateFindingEligibility({
    finding: finding(source, [support.id]),
    snapshotId: source.id,
    evidence: [support],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.safeToProject, true);
});

scenario("active fact-backed implementation target reaches sufficient evidence", () => {
  const state = baseStopState();
  assert.equal(stoppedReason(state).reason, "sufficient_evidence");
  assert.equal(stoppedReason(state).safeToProject, true);
});

scenario("source-span-only support remains eligible and sufficient", () => {
  const source = snapshot();
  const spanSupport = {
    ...evidence(source, "span", {
      claimId: id<ClaimId>("claim-owner"),
      factIds: [],
    }),
    sourceSpans: [sourceSpan(source)],
  };
  const evaluation = evaluateFindingEligibility({
    finding: finding(source, [spanSupport.id]),
    snapshotId: source.id,
    evidence: [spanSupport],
    facts: [],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.equal(evaluation.eligible, true);
  assert.equal(evaluation.safeToProject, true);
  const state = baseStopState();
  state.evidence = [spanSupport];
  state.facts = [];
  state.findingEvaluations = [evaluation];
  assert.equal(stoppedReason(state).reason, "sufficient_evidence");
});

scenario("context-only fact-backed evidence is not implementation support", () => {
  const source = snapshot();
  const context = evidence(source, "context-grounded", { role: "context_only" });
  const result = evaluateFindingEligibility({
    finding: finding(source, [context.id]),
    snapshotId: source.id,
    evidence: [context],
    facts: [fact(source)],
    entities: [entity(source)],
    contradictions: [],
    knowledgeGaps: [],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.safeToProject, false);
});

scenario("lead-only grounded evidence cannot produce sufficient evidence", () => {
  const state = baseStopState();
  state.evidence = state.evidence.map((record) => ({
    ...record,
    strength: "lead" as const,
  }));
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("fact getters are rejected without invocation", () => {
  const source = snapshot();
  const support = evidence(source);
  const unsafe = fact(source);
  let getterCalls = 0;
  Object.defineProperty(unsafe, "strength", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("Bearer unsafe-fact-getter-value");
    },
  });
  assert.throws(
    () => evaluateFindingEligibility({
      finding: finding(source, [support.id]),
      snapshotId: source.id,
      evidence: [support],
      facts: [unsafe],
      entities: [entity(source)],
      contradictions: [],
      knowledgeGaps: [],
    }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      !error.message.includes("unsafe-fact-getter-value"),
  );
  assert.equal(getterCalls, 0);
});

scenario("unsafe fact ids do not leak through errors or recordId", () => {
  const source = snapshot();
  const rawSecret = "sk-proj-abcdefghijklmnop";
  const unsafe = { ...fact(source), id: id<FactId>(rawSecret) };
  const support = evidence(source, "unsafe-fact", { factIds: [unsafe.id] });
  assert.throws(
    () => evaluateFindingEligibility({
      finding: finding(source, [support.id]),
      snapshotId: source.id,
      evidence: [support],
      facts: [unsafe],
      entities: [entity(source)],
      contradictions: [],
      knowledgeGaps: [],
    }),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      !error.message.includes(rawSecret) &&
      error.recordId === undefined,
  );
});

scenario("StopPolicy rejects forged eligibility backed only by invalidated facts", () => {
  const state = baseStopState();
  state.facts = state.facts.map((record) => ({
    ...record,
    status: "invalidated" as const,
  }));
  assert.throws(() => createStopPolicy().evaluate(state));
});

scenario("StopPolicy rejects conflicting duplicate fact ids", () => {
  const state = baseStopState();
  const first = state.facts[0]!;
  state.facts = [first, { ...first, predicate: "different_predicate" }];
  assert.throws(
    () => createStopPolicy().evaluate(state),
    (error: unknown) =>
      error instanceof InvestigationDomainError &&
      error.code === "record_conflict",
  );
});

scenario("StopPolicy treats identical duplicate facts idempotently", () => {
  const single = baseStopState();
  const duplicate = baseStopState();
  duplicate.facts = [duplicate.facts[0]!, structuredClone(duplicate.facts[0]!)];
  assert.deepEqual(
    createStopPolicy().evaluate(duplicate),
    createStopPolicy().evaluate(single),
  );
});

scenario("FactRecord context preserves canonical StopPolicy priority", () => {
  const state = baseStopState();
  state.internalInvariantFailure = true;
  state.repositoryChanged = true;
  state.safetyBlocked = true;
  state.knowledgeGaps = [
    gap(snapshot(), "fact-priority", { category: "safety_restricted" }),
  ];
  state.budgetState = createInvestigationBudgetState(
    budget({ maxOperations: 0 }),
  );
  assert.equal(stoppedReason(state).reason, "internal_error");
});

scenario("validated domain context reuses unchanged immutable records", () => {
  const source = snapshot();
  const rawFact = fact(source);
  const rawEvidence = evidence(source, "a", { factIds: [rawFact.id] });
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [rawFact],
    evidence: [rawEvidence],
  });
  const before = context.metrics();
  const rawFinding = finding(source, [rawEvidence.id]);
  const first = evaluateFindingEligibility({
    finding: rawFinding,
    snapshotId: source.id,
    evidence: context.evidence,
    facts: context.facts,
    entities: context.entities,
    contradictions: [],
    knowledgeGaps: [],
  }, context);
  const second = evaluateFindingEligibility({
    finding: rawFinding,
    snapshotId: source.id,
    evidence: context.evidence,
    facts: context.facts,
    entities: context.entities,
    contradictions: [],
    knowledgeGaps: [],
  }, context);
  assert.deepEqual(second, first);
  assert.deepEqual(context.metrics(), before);
  assert.equal(Object.isFrozen(context.facts[0]), true);
  assert.equal(Object.isFrozen(context.evidence[0]), true);
});

scenario("validated domain context indexes iterate in canonical id order", () => {
  const source = snapshot();
  const entities = [
    entity(source, "c"),
    entity(source, "a"),
    entity(source, "b"),
    entity(source),
  ];
  const facts = [
    fact(source, "c"),
    fact(source, "a"),
    fact(source, "b"),
  ];
  const records = [
    evidence(source, "c", { factIds: [facts[0]!.id] }),
    evidence(source, "a", { factIds: [facts[1]!.id] }),
    evidence(source, "b", { factIds: [facts[2]!.id] }),
  ];
  const first = createValidatedDomainContext({
    snapshot: source,
    entities,
    facts,
    evidence: records,
  });
  const second = createValidatedDomainContext({
    snapshot: source,
    entities: [...entities].reverse(),
    facts: [...facts].reverse(),
    evidence: [...records].reverse(),
  });
  assert.deepEqual(second.entities, first.entities);
  assert.deepEqual(second.facts, first.facts);
  assert.deepEqual(second.evidence, first.evidence);
  for (const [array, firstIndex, secondIndex] of [
    [first.entities, first.entitiesById, second.entitiesById],
    [first.facts, first.factsById, second.factsById],
    [first.evidence, first.evidenceById, second.evidenceById],
  ] as const) {
    const expectedIds = array.map((record) => record.id);
    assert.deepEqual([...firstIndex.keys()], expectedIds);
    assert.deepEqual([...secondIndex.keys()], expectedIds);
    assert.deepEqual([...firstIndex.values()].map((record) => record.id), expectedIds);
    assert.deepEqual([...secondIndex.values()].map((record) => record.id), expectedIds);
    assert.deepEqual(
      [...firstIndex.entries()].map(([key, record]) => [key, record.id]),
      expectedIds.map((recordId) => [recordId, recordId]),
    );
    assert.deepEqual(
      [...secondIndex.entries()].map(([key, record]) => [key, record.id]),
      expectedIds.map((recordId) => [recordId, recordId]),
    );
  }
});

scenario("successful context extension does not mutate parent metrics", () => {
  const source = snapshot();
  const sourceFact = fact(source);
  const parent = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
  });
  const parentMetrics = parent.metrics();
  const child = parent.extend({
    evidence: [evidence(source, "child", { factIds: [sourceFact.id] })],
  });
  assert.deepEqual(parent.metrics(), parentMetrics);
  assert.deepEqual(child.metrics(), {
    ...parentMetrics,
    evidenceValidations: parentMetrics.evidenceValidations + 1,
  });
});

scenario("failed context extension does not mutate parent metrics", () => {
  const source = snapshot();
  const original = fact(source);
  const parent = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [original],
  });
  const parentMetrics = parent.metrics();
  assert.throws(
    () => parent.extend({
      facts: [
        fact(source, "candidate"),
        { ...original, predicate: "implements" },
      ],
    }),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "record_conflict",
  );
  assert.deepEqual(parent.metrics(), parentMetrics);
});

scenario("sibling context extensions evolve metrics independently", () => {
  const source = snapshot();
  const parent = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [fact(source)],
  });
  const parentMetrics = parent.metrics();
  const leftFact = fact(source, "left");
  const rightFact = fact(source, "right");
  const left = parent.extend({ facts: [leftFact] });
  const right = parent.extend({ facts: [rightFact] });
  const leftMetrics = left.metrics();
  const rightMetrics = right.metrics();
  const leftChild = left.extend({
    evidence: [evidence(source, "left", { factIds: [leftFact.id] })],
  });
  assert.deepEqual(parent.metrics(), parentMetrics);
  assert.deepEqual(left.metrics(), leftMetrics);
  assert.deepEqual(right.metrics(), rightMetrics);
  assert.deepEqual(leftMetrics, rightMetrics);
  assert.equal(leftChild.metrics().evidenceValidations, leftMetrics.evidenceValidations + 1);
  assert.equal(right.metrics().evidenceValidations, rightMetrics.evidenceValidations);
});

scenario("validated domain context rejects a newly added fact accessor without invocation", () => {
  const source = snapshot();
  const context = createValidatedDomainContext({ snapshot: source });
  const unsafe = fact(source, "unsafe-accessor");
  let calls = 0;
  Object.defineProperty(unsafe, "predicate", {
    enumerable: true,
    get() {
      calls += 1;
      return "configures";
    },
  });
  assert.throws(
    () => context.extend({ facts: [unsafe] }),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  assert.equal(calls, 0);
});

scenario("validated domain context rejects newly added evidence with an unknown fact", () => {
  const source = snapshot();
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [fact(source)],
  });
  const malformed = evidence(source, "unknown", {
    factIds: [id<FactId>("fact-unknown")],
  });
  assert.throws(
    () => context.extend({ evidence: [malformed] }),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "unknown_reference",
  );
});

scenario("changed stale record cannot inherit validated provenance", () => {
  const source = snapshot();
  const original = fact(source);
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [original],
  });
  assert.throws(
    () => context.extend({ facts: [{ ...original, status: "superseded" }] }),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "record_conflict",
  );
});

scenario("same fact id with incompatible content cannot inherit validated provenance", () => {
  const source = snapshot();
  const original = fact(source);
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [original],
  });
  assert.throws(
    () => context.extend({ facts: [{ ...original, predicate: "implements" }] }),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "record_conflict",
  );
});

scenario("foreign snapshot records cannot reuse a validated context", () => {
  const source = snapshot();
  const foreign = snapshot("foreign");
  const context = createValidatedDomainContext({ snapshot: source });
  assert.throws(
    () => context.extend({
      entities: [entity(foreign)],
      facts: [fact(foreign)],
    }),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "snapshot_mismatch",
  );
});

scenario("foreign snapshot claims cannot reuse a validated context", () => {
  const source = snapshot();
  const foreign = snapshot("foreign");
  const sourceFact = fact(source);
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
  });
  assert.throws(
    () => evaluateClaim({
      claim: claim(foreign),
      evidence: context.evidence,
      facts: context.facts,
      requirements: [],
    }, undefined, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "snapshot_mismatch",
  );
});

scenario("structurally forged validation context cannot bypass runtime provenance", () => {
  const source = snapshot();
  const sourceFact = fact(source);
  const sourceEvidence = evidence(source, "forged", { factIds: [sourceFact.id] });
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
    evidence: [sourceEvidence],
  });
  const forged = {
    snapshotId: context.snapshotId,
    entities: context.entities,
    facts: context.facts,
    evidence: context.evidence,
    entitiesById: context.entitiesById,
    factsById: context.factsById,
    evidenceById: context.evidenceById,
    extend: context.extend.bind(context),
    assertCanonical: context.assertCanonical.bind(context),
    assertCanonicalFactMembers: context.assertCanonicalFactMembers.bind(context),
    assertCanonicalEvidenceMembers: context.assertCanonicalEvidenceMembers.bind(context),
    metrics: context.metrics.bind(context),
  };
  assert.throws(
    () => evaluateFindingEligibility({
      finding: finding(source, [sourceEvidence.id]),
      snapshotId: source.id,
      evidence: context.evidence,
      facts: context.facts,
      entities: context.entities,
      contradictions: [],
      knowledgeGaps: [],
    }, forged),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
});

scenario("validated context structurally bounds repeated fact and evidence validation", () => {
  const source = snapshot();
  const facts = Array.from({ length: 32 }, (_, index) =>
    fact(source, `bounded-${index}`),
  );
  const records = facts.map((record, index) =>
    evidence(source, `bounded-${index}`, {
      factIds: [record.id],
      group: `bounded-group-${index}`,
    }),
  );
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts,
    evidence: records,
  });
  for (let index = 0; index < 10; index += 1) {
    const result = evaluateEvidenceRequirement({
      requirement: requirement("bounded"),
      evidence: context.evidence,
      facts: context.facts,
      snapshotId: source.id,
      role: "supports",
    }, context);
    assert.equal(result.satisfied, true);
  }
  assert.deepEqual(context.metrics(), {
    entityValidations: 1,
    factValidations: 32,
    evidenceValidations: 32,
    compatibleRecordsReused: 0,
  });
});

scenario("validated context preserves grounded safe-stop and safety-restricted semantics", () => {
  const source = snapshot();
  for (const rawState of [
    baseStopState(),
    {
      ...baseStopState(),
      allRequiredEvidenceSatisfied: false,
      knowledgeGaps: [gap(source, "parity")],
    },
    {
      ...baseStopState(),
      safetyBlocked: true,
      knowledgeGaps: [
        gap(source, "protected-parity", { category: "safety_restricted" }),
      ],
    },
  ]) {
    const baseline = createStopPolicy().evaluate(rawState);
    const context = createValidatedDomainContext({
      snapshot: source,
      facts: rawState.facts,
      evidence: rawState.evidence,
    });
    const optimized = createStopPolicy().evaluate({
      ...rawState,
      facts: context.facts,
      evidence: context.evidence,
    }, context);
    assert.deepEqual(optimized, baseline);
  }
});

scenario("validated context preserves deterministic contradiction semantics", () => {
  const source = snapshot();
  const sourceFact = fact(source);
  const sourceClaim = claim(source);
  const support = evidence(source, "support", {
    claimId: sourceClaim.id,
    role: "supports",
    factIds: [sourceFact.id],
  });
  const opposed = evidence(source, "opposed", {
    claimId: sourceClaim.id,
    role: "contradicts",
    factIds: [sourceFact.id],
  });
  const input = {
    claim: sourceClaim,
    evidence: [support, opposed],
    facts: [sourceFact],
  };
  const baseline = detectDeterministicContradictions(input);
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: input.facts,
    evidence: input.evidence,
  });
  const optimized = detectDeterministicContradictions({
    ...input,
    evidence: context.evidence,
    facts: context.facts,
  }, undefined, context);
  assert.deepEqual(optimized, baseline);
});

scenario("validated mixed envelopes preserve claim and requirement semantics", () => {
  const source = snapshot();
  const sourceFact = fact(source);
  const sourceClaim = claim(source, [id<EvidenceId>("evidence-support")]);
  const support = evidence(source, "support", {
    claimId: sourceClaim.id,
    factIds: [sourceFact.id],
  });
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
    evidence: [support],
  });
  const rawClaimInput = {
    claim: sourceClaim,
    evidence: [support],
    facts: [sourceFact],
    requirements: [requirement()],
  };
  const rawClaim = evaluateClaim(rawClaimInput);
  const optimizedClaim = evaluateClaim({
    ...rawClaimInput,
    facts: context.facts,
    evidence: context.evidence,
  }, undefined, context);
  assert.deepEqual(optimizedClaim, rawClaim);

  const opposed = evidence(source, "claim-opposed", {
    claimId: sourceClaim.id,
    role: "contradicts",
    strength: "conclusive",
    factIds: [sourceFact.id],
  });
  const contradictedClaim = claim(
    source,
    [support.id],
    [opposed.id],
  );
  const contradictedContext = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
    evidence: [support, opposed],
  });
  assert.deepEqual(
    evaluateClaim({
      claim: contradictedClaim,
      evidence: contradictedContext.evidence,
      facts: contradictedContext.facts,
      requirements: [requirement()],
    }, undefined, contradictedContext),
    evaluateClaim({
      claim: contradictedClaim,
      evidence: [support, opposed],
      facts: [sourceFact],
      requirements: [requirement()],
    }),
  );

  const unresolvedClaim = claim(source, [], []);
  const unresolvedContext = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
  });
  assert.deepEqual(
    evaluateClaim({
      claim: unresolvedClaim,
      evidence: unresolvedContext.evidence,
      facts: unresolvedContext.facts,
      requirements: [requirement()],
    }, undefined, unresolvedContext),
    evaluateClaim({
      claim: unresolvedClaim,
      evidence: [],
      facts: [sourceFact],
      requirements: [requirement()],
    }),
  );

  for (const sourceEvidence of [[support], []] as const) {
    const rawRequirement = evaluateEvidenceRequirement({
      requirement: requirement("parity"),
      evidence: sourceEvidence,
      facts: [sourceFact],
      snapshotId: source.id,
      role: "supports",
    });
    const optimizedRequirement = evaluateEvidenceRequirement({
      requirement: requirement("parity"),
      evidence: sourceEvidence.length === 0 ? [] : context.evidence,
      facts: context.facts,
      snapshotId: source.id,
      role: "supports",
    }, context);
    assert.deepEqual(optimizedRequirement, rawRequirement);
  }
});

scenario("validated mixed envelopes preserve contradiction registry and detection semantics", () => {
  const source = snapshot();
  const sourceFact = fact(source);
  const sourceClaim = claim(
    source,
    [id<EvidenceId>("evidence-support")],
    [id<EvidenceId>("evidence-opposed")],
  );
  const support = evidence(source, "support", {
    claimId: sourceClaim.id,
    role: "supports",
    factIds: [sourceFact.id],
  });
  const opposed = evidence(source, "opposed", {
    claimId: sourceClaim.id,
    role: "contradicts",
    factIds: [sourceFact.id],
  });
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
    evidence: [support, opposed],
  });
  const rawDetections = detectDeterministicContradictions({
    claim: sourceClaim,
    evidence: [support, opposed],
    facts: [sourceFact],
  });
  const optimizedDetections = detectDeterministicContradictions({
    claim: sourceClaim,
    evidence: context.evidence,
    facts: context.facts,
  }, undefined, context);
  assert.deepEqual(optimizedDetections, rawDetections);
  const supportOnlyContext = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
    evidence: [support],
  });
  const supportOnlyClaim = claim(source, [support.id]);
  assert.deepEqual(
    detectDeterministicContradictions({
      claim: supportOnlyClaim,
      evidence: supportOnlyContext.evidence,
      facts: supportOnlyContext.facts,
    }, undefined, supportOnlyContext),
    detectDeterministicContradictions({
      claim: supportOnlyClaim,
      evidence: [support],
      facts: [sourceFact],
    }),
  );

  const rawRegistry = createContradictionRegistry({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: [support, opposed],
  });
  const optimizedRegistry = createContradictionRegistry({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: context.evidence,
  }, undefined, context);
  const record = contradiction(source, sourceClaim.id, [support.id, opposed.id]);
  rawRegistry.add(record);
  optimizedRegistry.add(record);
  assert.deepEqual(optimizedRegistry.snapshot(), rawRegistry.snapshot());
});

scenario("validated mixed envelopes preserve supported and unresolved hypothesis semantics", () => {
  const source = snapshot();
  const sourceFact = fact(source);
  const sourceClaim = claim(source, [id<EvidenceId>("evidence-support")]);
  const support = evidence(source, "support", {
    claimId: sourceClaim.id,
    factIds: [sourceFact.id],
  });
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
    evidence: [support],
  });
  const rawEvaluation = evaluateClaim({
    claim: sourceClaim,
    evidence: [support],
    facts: [sourceFact],
    requirements: [requirement()],
  });
  const optimizedEvaluation = evaluateClaim({
    claim: sourceClaim,
    evidence: context.evidence,
    facts: context.facts,
    requirements: [requirement()],
  }, undefined, context);
  const rawLedger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: [support],
  });
  const optimizedLedger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [sourceClaim],
    evidence: context.evidence,
  }, context);
  const sourceHypothesis = hypothesis(sourceClaim);
  rawLedger.add(sourceHypothesis);
  optimizedLedger.add(sourceHypothesis);
  const transition = {
    hypothesisId: sourceHypothesis.id,
    reason: "Equivalent authenticated evaluation.",
    occurredAt: timestamp,
  };
  rawLedger.applyClaimEvaluation({ ...transition, evaluation: rawEvaluation });
  optimizedLedger.applyClaimEvaluation({
    ...transition,
    evaluation: optimizedEvaluation,
  });
  assert.deepEqual(optimizedLedger.snapshot(), rawLedger.snapshot());

  const unresolvedClaim = claim(source, [], [], { id: id<ClaimId>("claim-unresolved") });
  const rawUnresolved = createHypothesisLedger({
    snapshotId: source.id,
    claims: [unresolvedClaim],
    evidence: [],
  });
  const emptyContext = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
  });
  const optimizedUnresolved = createHypothesisLedger({
    snapshotId: source.id,
    claims: [unresolvedClaim],
    evidence: emptyContext.evidence,
  }, emptyContext);
  const openHypothesis = hypothesis(unresolvedClaim, {
    id: id<HypothesisId>("hypothesis-unresolved"),
    requiredEvidence: [],
  });
  rawUnresolved.add(openHypothesis);
  optimizedUnresolved.add(openHypothesis);
  const unresolvedTransition = {
    hypothesisId: openHypothesis.id,
    reason: "Equivalent unresolved evaluation.",
    occurredAt: timestamp,
  };
  rawUnresolved.markUnresolved(unresolvedTransition);
  optimizedUnresolved.markUnresolved(unresolvedTransition);
  assert.deepEqual(optimizedUnresolved.snapshot(), rawUnresolved.snapshot());
});

scenario("validated mixed envelopes reject hostile outer and mutable accessors", () => {
  const source = snapshot();
  const sourceFact = fact(source);
  const sourceEvidence = evidence(source, "accessor", { factIds: [sourceFact.id] });
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
    evidence: [sourceEvidence],
  });
  let calls = 0;
  const outer = {
    evidence: context.evidence,
    facts: context.facts,
    requirements: [],
  } as Record<string, unknown>;
  Object.defineProperty(outer, "claim", {
    enumerable: true,
    get() {
      calls += 1;
      return claim(source);
    },
  });
  assert.throws(
    () => evaluateClaim(outer as never, undefined, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  const requirementsOuter = {
    claim: claim(source),
    evidence: context.evidence,
    facts: context.facts,
  } as Record<string, unknown>;
  Object.defineProperty(requirementsOuter, "requirements", {
    enumerable: true,
    get() {
      calls += 1;
      return [];
    },
  });
  assert.throws(
    () => evaluateClaim(requirementsOuter as never, undefined, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  const nestedClaim = claim(source);
  Object.defineProperty(nestedClaim, "status", {
    enumerable: true,
    get() {
      calls += 1;
      return "proposed";
    },
  });
  assert.throws(
    () => evaluateClaim({
      claim: nestedClaim,
      evidence: context.evidence,
      facts: context.facts,
      requirements: [],
    }, undefined, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  const requirementInput = {
    requirement: requirement("accessor"),
    evidence: context.evidence,
    facts: context.facts,
    snapshotId: source.id,
  } as Record<string, unknown>;
  Object.defineProperty(requirementInput, "role", {
    enumerable: true,
    get() {
      calls += 1;
      return "supports";
    },
  });
  assert.throws(
    () => evaluateEvidenceRequirement(requirementInput as never, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  const registryInput = {
    claims: [claim(source)],
    evidence: context.evidence,
  } as Record<string, unknown>;
  Object.defineProperty(registryInput, "snapshotId", {
    enumerable: true,
    get() {
      calls += 1;
      return source.id;
    },
  });
  assert.throws(
    () => createContradictionRegistry(registryInput as never, undefined, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  assert.equal(calls, 0);
});

scenario("validated mixed envelopes reject copied canonical provenance", () => {
  const source = snapshot();
  const sourceFact = fact(source);
  const sourceEvidence = evidence(source, "copied", { factIds: [sourceFact.id] });
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
    evidence: [sourceEvidence],
  });
  assert.throws(
    () => evaluateClaim({
      claim: claim(source),
      evidence: context.evidence,
      facts: [...context.facts],
      requirements: [],
    }, undefined, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  assert.throws(
    () => detectDeterministicContradictions({
      claim: claim(source),
      evidence: [...context.evidence],
      facts: context.facts,
    }, undefined, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  const copiedEvidence = structuredClone(context.evidence[0]!);
  assert.throws(
    () => evaluateEvidenceRequirement({
      requirement: requirement("copied"),
      evidence: [copiedEvidence],
      facts: context.facts,
      snapshotId: source.id,
    }, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  assert.throws(
    () => evaluateEvidenceRequirement({
      requirement: requirement("changed"),
      evidence: [{ ...copiedEvidence, summary: "Changed same-id evidence" }],
      facts: context.facts,
      snapshotId: source.id,
    }, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  const foreign = snapshot("mixed-foreign");
  const foreignFact = fact(foreign);
  const foreignContext = createValidatedDomainContext({
    snapshot: foreign,
    entities: [entity(foreign)],
    facts: [foreignFact],
  });
  assert.throws(
    () => evaluateClaim({
      claim: claim(source),
      evidence: context.evidence,
      facts: foreignContext.facts,
      requirements: [],
    }, undefined, context),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
  const forged = {
    snapshotId: context.snapshotId,
    entities: context.entities,
    facts: context.facts,
    evidence: context.evidence,
    entitiesById: context.entitiesById,
    factsById: context.factsById,
    evidenceById: context.evidenceById,
    extend: context.extend.bind(context),
    assertCanonical: context.assertCanonical.bind(context),
    assertCanonicalFactMembers: context.assertCanonicalFactMembers.bind(context),
    assertCanonicalEvidenceMembers: context.assertCanonicalEvidenceMembers.bind(context),
    metrics: context.metrics.bind(context),
  };
  assert.throws(
    () => evaluateClaim({
      claim: claim(source),
      evidence: context.evidence,
      facts: context.facts,
      requirements: [],
    }, undefined, forged),
    (error: unknown) =>
      error instanceof InvestigationDomainError && error.code === "invalid_record",
  );
});

scenario("validated mixed envelope outputs preserve mutation isolation", () => {
  const source = snapshot();
  const sourceFact = fact(source);
  const sourceClaim = claim(source, [id<EvidenceId>("evidence-isolation")]);
  const sourceEvidence = evidence(source, "isolation", {
    claimId: sourceClaim.id,
    factIds: [sourceFact.id],
  });
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts: [sourceFact],
    evidence: [sourceEvidence],
  });
  assert.throws(() => {
    (context.facts[0] as { status: string }).status = "superseded";
  });
  const mutableRequirement = requirement();
  const first = evaluateClaim({
    claim: sourceClaim,
    evidence: context.evidence,
    facts: context.facts,
    requirements: [mutableRequirement],
  }, undefined, context);
  first.claim.status = "rejected";
  sourceClaim.statement = "Caller-owned claim changed after evaluation.";
  mutableRequirement.minimumIndependentGroups = 99;
  assert.equal(first.requirements[0]!.satisfied, true);
  const second = evaluateClaim({
    claim: claim(source, [sourceEvidence.id]),
    evidence: context.evidence,
    facts: context.facts,
    requirements: [requirement()],
  }, undefined, context);
  assert.equal(second.claim.status, "supported");
  assert.notEqual(second.claim.statement, sourceClaim.statement);

  const registry = createContradictionRegistry({
    snapshotId: source.id,
    claims: [claim(source, [sourceEvidence.id])],
    evidence: context.evidence,
  }, undefined, context);
  registry.add(contradiction(
    source,
    id<ClaimId>("claim-owner"),
    [sourceEvidence.id],
    "isolation",
    { type: "custom" },
  ));
  const registrySnapshot = registry.snapshot();
  registrySnapshot[0]!.severity = "informational";
  assert.equal(registry.snapshot()[0]!.severity, "blocking");

  const ledgerClaim = claim(source, [sourceEvidence.id]);
  const ledger = createHypothesisLedger({
    snapshotId: source.id,
    claims: [ledgerClaim],
    evidence: context.evidence,
  }, context);
  const callerHypothesis = hypothesis(ledgerClaim);
  ledger.add(callerHypothesis);
  callerHypothesis.status = "rejected";
  assert.equal(ledger.snapshot()[0]!.status, "open");
  const ledgerSnapshot = ledger.snapshot();
  ledgerSnapshot[0]!.status = "rejected";
  assert.equal(ledger.snapshot()[0]!.status, "open");
});

scenario("validated mixed envelope work scales with mutable envelope rather than canonical state", () => {
  const source = snapshot();
  const facts = Array.from({ length: 200 }, (_, index) =>
    fact(source, `mixed-${index}`),
  );
  const sourceClaim = claim(source, [], [], {
    derivation: {
      ruleId: "rule.owner",
      ruleVersion: "1.0.0",
      inputFactIds: [facts[0]!.id],
    },
  });
  const records = Array.from({ length: 100 }, (_, index) =>
    evidence(source, `mixed-${index}`, {
      claimId: sourceClaim.id,
      factIds: [facts[index]!.id],
      group: `mixed-group-${index}`,
    }),
  );
  sourceClaim.supportingEvidenceIds = records
    .map((record) => record.id)
    .sort();
  const context = createValidatedDomainContext({
    snapshot: source,
    entities: [entity(source)],
    facts,
    evidence: records,
  });
  const diagnostics = createValidatedDomainEnvelopeDiagnostics();
  const canonicalFacts = new Set<object>(context.facts);
  const canonicalEvidence = new Set<object>(context.evidence);
  let canonicalFactInspections = 0;
  let canonicalEvidenceInspections = 0;
  const observeCanonicalTarget = (target: unknown): void => {
    if (typeof target !== "object" || target === null) return;
    if (canonicalFacts.has(target)) canonicalFactInspections += 1;
    if (canonicalEvidence.has(target)) canonicalEvidenceInspections += 1;
  };
  const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const originalGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  const originalGetPrototypeOf = Object.getPrototypeOf;
  const originalOwnKeys = Reflect.ownKeys;
  Object.defineProperty(Object, "getOwnPropertyDescriptor", {
    configurable: true,
    writable: true,
    value: ((target: object, key: PropertyKey) => {
      observeCanonicalTarget(target);
      return originalGetOwnPropertyDescriptor(target, key);
    }) as typeof Object.getOwnPropertyDescriptor,
  });
  Object.defineProperty(Object, "getOwnPropertyDescriptors", {
    configurable: true,
    writable: true,
    value: ((target: object) => {
      observeCanonicalTarget(target);
      return originalGetOwnPropertyDescriptors(target);
    }) as typeof Object.getOwnPropertyDescriptors,
  });
  Object.defineProperty(Object, "getPrototypeOf", {
    configurable: true,
    writable: true,
    value: ((target: object) => {
      observeCanonicalTarget(target);
      return originalGetPrototypeOf(target);
    }) as typeof Object.getPrototypeOf,
  });
  Object.defineProperty(Reflect, "ownKeys", {
    configurable: true,
    writable: true,
    value: ((target: object) => {
      observeCanonicalTarget(target);
      return originalOwnKeys(target);
    }) as typeof Reflect.ownKeys,
  });
  try {
    cloneDomainValue(context.facts[0]);
    cloneDomainValue(context.evidence[0]);
    assert.ok(canonicalFactInspections > 0);
    assert.ok(canonicalEvidenceInspections > 0);
    canonicalFactInspections = 0;
    canonicalEvidenceInspections = 0;

    for (let round = 0; round < 10; round += 1) {
      const evaluation = evaluateClaim({
        claim: sourceClaim,
        facts: context.facts,
        evidence: context.evidence,
        requirements: [requirement(`mixed-${round}`)],
      }, undefined, context);
      assert.equal(evaluation.claim.status, "supported");
      const claimEnvelope = cloneValidatedClaimEvaluationEnvelope({
        claim: sourceClaim,
        facts: context.facts,
        evidence: context.evidence,
        requirements: [requirement(`mixed-${round}`)],
      }, context, diagnostics);
      assert.equal(claimEnvelope.facts, context.facts);
      assert.equal(claimEnvelope.evidence, context.evidence);
      const requirementEnvelope = cloneValidatedEvidenceRequirementEnvelope({
        requirement: requirement(`mixed-${round}`),
        facts: context.facts,
        evidence: context.evidence,
        snapshotId: source.id,
        role: "supports",
      }, context, diagnostics);
      assert.equal(requirementEnvelope.facts, context.facts);
      assert.equal(requirementEnvelope.evidence[0], context.evidence[0]);
    }
    assert.equal(canonicalFactInspections, 0);
    assert.equal(canonicalEvidenceInspections, 0);
  } finally {
    Object.defineProperty(Object, "getOwnPropertyDescriptor", {
      configurable: true,
      writable: true,
      value: originalGetOwnPropertyDescriptor,
    });
    Object.defineProperty(Object, "getOwnPropertyDescriptors", {
      configurable: true,
      writable: true,
      value: originalGetOwnPropertyDescriptors,
    });
    Object.defineProperty(Object, "getPrototypeOf", {
      configurable: true,
      writable: true,
      value: originalGetPrototypeOf,
    });
    Object.defineProperty(Reflect, "ownKeys", {
      configurable: true,
      writable: true,
      value: originalOwnKeys,
    });
  }
  assert.deepEqual(diagnostics, {
    mutableEnvelopeClones: 20,
    canonicalFactReferencesReused: 4_000,
    canonicalEvidenceReferencesReused: 2_000,
  });
  assert.deepEqual(context.metrics(), {
    entityValidations: 1,
    factValidations: 200,
    evidenceValidations: 100,
    compatibleRecordsReused: 0,
  });
});

for (const entry of scenarios) {
  try {
    entry.run();
  } catch (error) {
    throw new Error(`Scenario failed: ${entry.name}`, { cause: error });
  }
}

assert.equal(scenarios.length, 289);
console.log(`Context Engine v2 investigation domain smoke passed: ${scenarios.length} scenarios.`);
