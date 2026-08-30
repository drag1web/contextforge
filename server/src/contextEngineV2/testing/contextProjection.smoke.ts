import assert from "node:assert/strict";

import {
  ContextProjectionError,
  createContextProjectionService,
  type ContextProjectionInput,
  type InvestigationRunnerResult,
} from "../application/index.js";
import {
  createLegacyTaskFileSelectionProjection,
  createManifestFactExtractor,
} from "../adapters/index.js";
import type {
  ClaimId,
  ContradictionId,
  EntityId,
  EvidenceId,
  FactId,
  FactRecord,
  FileDescriptor,
  Finding,
  FindingId,
  HypothesisId,
  InvestigationId,
  KnowledgeGap,
  KnowledgeGapId,
  RepositoryEntity,
  RepositorySnapshot,
  SnapshotId,
  SourceSpan,
} from "../contracts/index.js";

const snapshotId = "snapshot-projection" as SnapshotId;
const otherSnapshotId = "snapshot-other" as SnapshotId;
const investigationId = "investigation-projection" as InvestigationId;

function file(input: Partial<FileDescriptor> & Pick<FileDescriptor, "id" | "path">): FileDescriptor {
  const normalizedPath = input.path.replaceAll("\\", "/");
  return {
    id: input.id,
    snapshotId: input.snapshotId ?? snapshotId,
    path: normalizedPath,
    normalizedPath: input.normalizedPath ?? normalizedPath,
    extension: input.extension ?? ".ts",
    language: input.language ?? "typescript",
    kind: input.kind ?? "source",
    sizeBytes: input.sizeBytes ?? 128,
    contentFingerprint: input.contentFingerprint ?? `fingerprint:${input.id}`,
    readable: input.readable ?? true,
    generated: input.generated ?? false,
    secretRisk: input.secretRisk ?? "none",
    attributes: input.attributes ?? {},
  };
}

function snapshot(files: FileDescriptor[]): RepositorySnapshot {
  return {
    id: snapshotId,
    projectId: "projection-fixture",
    rootUri: "repository://projection-fixture",
    rootFingerprint: "root:projection-fixture",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "test_fixture",
    files: [...files].sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath)),
    limits: { excludedPatterns: [] },
    truncation: { truncated: false, reasons: [] },
    metadata: {},
  };
}

function entity(input: {
  id: string;
  fileId?: string;
  kind?: RepositoryEntity["kind"];
  snapshotId?: SnapshotId;
  displayName?: string;
}): RepositoryEntity {
  return {
    id: input.id as EntityId,
    snapshotId: input.snapshotId ?? snapshotId,
    kind: input.kind ?? "function",
    displayName: input.displayName ?? input.id,
    ...(input.fileId === undefined ? {} : { fileId: input.fileId as EntityId }),
    attributes: {},
  };
}

function span(input: {
  file: FileDescriptor;
  snapshotId?: SnapshotId;
}): SourceSpan {
  return {
    kind: "source_span",
    snapshotId: input.snapshotId ?? input.file.snapshotId,
    fileId: input.file.id,
    path: input.file.normalizedPath,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 10,
    contentFingerprint: input.file.contentFingerprint,
  };
}

function evidence(input: {
  id: string;
  file: FileDescriptor;
  role?: "supports" | "contradicts" | "context_only";
  strength?: "conclusive" | "substantial" | "corroborating" | "lead";
  current?: boolean;
  snapshotId?: SnapshotId;
  claimId?: string;
  sourceSpans?: SourceSpan[];
  factIds?: string[];
}): InvestigationRunnerResult["evidence"][number] {
  const current = input.current ?? true;
  const recordSnapshotId = input.snapshotId ?? snapshotId;
  return {
    id: input.id as EvidenceId,
    snapshotId: recordSnapshotId,
    ...(input.claimId === undefined ? {} : { claimId: input.claimId as ClaimId }),
    role: input.role ?? "supports",
    factIds: [...(input.factIds ?? [])].sort().map((id) => id as FactId),
    sourceSpans: input.sourceSpans ?? [span({ file: input.file, snapshotId: recordSnapshotId })],
    summary: "Grounded projection evidence.",
    strength: input.strength ?? "substantial",
    independenceGroup: `group-${input.id}`,
    freshness: {
      snapshotId: recordSnapshotId,
      current,
      reason: current ? "snapshot_match" : "stale",
    },
    limitations: [],
  };
}

function finding(input: {
  id: string;
  entityIds: string[];
  evidenceIds: string[];
  type?: Finding["type"];
  status?: Finding["status"];
  authorizationHint?: Finding["authorizationHint"];
  snapshotId?: SnapshotId;
  limitations?: string[];
}): Finding {
  return {
    id: input.id as FindingId,
    snapshotId: input.snapshotId ?? snapshotId,
    type: input.type ?? "implementation_target",
    statement: "Grounded projection finding.",
    entityIds: [...input.entityIds].sort().map((id) => id as EntityId),
    evidenceIds: [...input.evidenceIds].sort().map((id) => id as EvidenceId),
    status: input.status ?? "confirmed",
    limitations: [...(input.limitations ?? [])].sort(),
    authorizationHint: input.authorizationHint ?? "eligible",
  };
}

function budgetState(): InvestigationRunnerResult["budgetState"] {
  return {
    budget: {
      maxOperations: 10,
      maxFileReads: 10,
      maxFileBytes: 10_000,
      maxParsedFiles: 10,
      maxRelationshipHops: 4,
      maxWallTimeMs: 1_000,
      maxPlannerRounds: 4,
      maxConcurrentOperations: 1,
    },
    usage: {
      operations: 1,
      fileReads: 1,
      fileBytes: 128,
      parsedFiles: 1,
      relationshipHops: 0,
      wallTimeMs: 10,
      plannerRounds: 1,
    },
    exhausted: [],
  };
}

function runnerResult(input: {
  entities: RepositoryEntity[];
  evidence: InvestigationRunnerResult["evidence"];
  findings: Finding[];
  safeToProject?: boolean;
  knowledgeGaps?: KnowledgeGap[];
  contradictions?: InvestigationRunnerResult["contradictions"];
  facts?: FactRecord[];
}): InvestigationRunnerResult {
  const safe = input.safeToProject ?? true;
  return {
    investigationId,
    snapshotId,
    phase: "stopped",
    questions: [],
    claims: [],
    hypotheses: [],
    entities: input.entities,
    facts: input.facts ?? [],
    evidence: input.evidence,
    findings: input.findings,
    contradictions: input.contradictions ?? [],
    knowledgeGaps: input.knowledgeGaps ?? [],
    coverage: {
      criticalQuestionsTotal: 1,
      criticalQuestionsAnswered: safe ? 1 : 0,
      questionsTotal: 1,
      questionsAnswered: safe ? 1 : 0,
      hypothesesTotal: 1,
      hypothesesSupported: safe ? 1 : 0,
      hypothesesRejected: 0,
      hypothesesUnresolved: safe ? 0 : 1,
      filesConsidered: 1,
      filesRead: 1,
      filesParsed: 1,
      relationshipHops: 0,
      evidenceIndependentGroups: input.evidence.length,
      snapshotTruncated: false,
      blockedScopes: [],
    },
    budgetState: budgetState(),
    operationRecords: [],
    trace: [],
    stop: {
      reason: safe ? "sufficient_evidence" : "no_grounded_lead",
      message: safe ? "Evidence is sufficient." : "No grounded lead remains.",
      blockingGapIds: [],
      contradictionIds: [],
      budgetState: budgetState(),
      safeToProject: safe,
    },
    safeToProject: safe,
  };
}

function relationFact(input: {
  id: string;
  subject: RepositoryEntity;
  object: RepositoryEntity;
  predicate: string;
  file: FileDescriptor;
  status?: FactRecord["status"];
}): FactRecord {
  return {
    kind: "relation",
    id: input.id as FactId,
    snapshotId,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    source: span({ file: input.file }),
    provenance: {
      extractorId: "extractor.projection-fixture",
      extractorVersion: "1.0.0",
      method: "parser",
      observedAt: "2026-01-01T00:00:00.000Z",
    },
    strength: "exact",
    status: input.status ?? "active",
    attributes: {},
  };
}

function fixture(): ContextProjectionInput {
  const targetFile = file({ id: "file-target" as EntityId, path: "src/target.ts" });
  const targetEntity = entity({ id: "entity-target", fileId: targetFile.id });
  const targetEvidence = evidence({ id: "evidence-target", file: targetFile, claimId: "claim-owner" });
  const targetFinding = finding({
    id: "finding-target",
    entityIds: [targetEntity.id],
    evidenceIds: [targetEvidence.id],
  });
  return {
    result: runnerResult({
      entities: [targetEntity],
      evidence: [targetEvidence],
      findings: [targetFinding],
    }),
    snapshot: snapshot([targetFile]),
    purpose: "implementation",
    explicitTargets: [{ kind: "path", path: targetFile.normalizedPath }],
    negativeConstraints: [],
  };
}

function strictRelationshipFixture(input: {
  importTarget: string;
  includeReExport?: boolean;
}): ContextProjectionInput {
  const routeFile = file({ id: "file-chain-route" as EntityId, path: "src/route.ts" });
  const barrelFile = file({ id: "file-chain-barrel" as EntityId, path: "src/barrel.ts" });
  const candidateFile = file({ id: "file-chain-candidate" as EntityId, path: "src/candidate.ts" });
  const candidate = entity({
    id: "entity-chain-candidate",
    fileId: candidateFile.id,
    kind: "class",
    displayName: "CandidateService",
  });
  const routeModule = entity({ id: "entity-chain-route-module", fileId: routeFile.id, kind: "module" });
  const candidateModule = entity({ id: "entity-chain-candidate-module", fileId: candidateFile.id, kind: "module" });
  const importReference = entity({ id: "entity-chain-import-reference", kind: "symbol", displayName: "CandidateService" });
  importReference.attributes = {
    importedName: "CandidateService",
    moduleSpecifier: input.includeReExport ? "./barrel" : input.importTarget,
  };
  const importFact = relationFact({
    id: "fact-chain-import",
    subject: routeModule,
    object: importReference,
    predicate: "imports",
    file: routeFile,
  });
  const definitionFact = relationFact({
    id: "fact-chain-definition",
    subject: candidateModule,
    object: candidate,
    predicate: "contains",
    file: candidateFile,
  });
  const facts: FactRecord[] = [importFact, definitionFact];
  const evidenceRecords: InvestigationRunnerResult["evidence"] = [
    evidence({ id: "evidence-chain-import", file: routeFile, factIds: [importFact.id], sourceSpans: [] }),
    evidence({
      id: "evidence-chain-definition",
      file: candidateFile,
      factIds: [definitionFact.id],
      sourceSpans: [],
      role: "context_only",
      strength: "lead",
    }),
  ];
  if (input.includeReExport) {
    const barrelModule = entity({ id: "entity-chain-barrel-module", fileId: barrelFile.id, kind: "module" });
    const reExportReference = entity({ id: "entity-chain-reexport-reference", kind: "symbol", displayName: "CandidateService" });
    reExportReference.attributes = {
      importedName: "CandidateService",
      moduleSpecifier: "./candidate",
    };
    const reExportFact = relationFact({
      id: "fact-chain-reexport",
      subject: barrelModule,
      object: reExportReference,
      predicate: "re_exports",
      file: barrelFile,
    });
    facts.push(reExportFact);
    evidenceRecords.push(evidence({
      id: "evidence-chain-reexport",
      file: barrelFile,
      factIds: [reExportFact.id],
      sourceSpans: [],
      role: "context_only",
      strength: "lead",
    }));
  }
  const ownerFinding = finding({
    id: "finding-chain-owner",
    entityIds: [candidate.id],
    evidenceIds: evidenceRecords.map((record) => record.id),
  });
  return {
    result: runnerResult({
      entities: [candidate],
      facts,
      evidence: evidenceRecords,
      findings: [ownerFinding],
    }),
    snapshot: snapshot(input.includeReExport
      ? [routeFile, barrelFile, candidateFile]
      : [routeFile, candidateFile]),
    purpose: "implementation",
    explicitTargets: [],
    negativeConstraints: [],
  };
}

function openGap(input: {
  entityId?: EntityId;
  blocks?: KnowledgeGap["blocks"];
} = {}): KnowledgeGap {
  return {
    id: "gap-projection" as KnowledgeGapId,
    snapshotId,
    category: "missing_owner",
    question: "Which verified definition owns this behavior?",
    blocks: input.blocks ?? ["projection"],
    relatedEntityIds: input.entityId ? [input.entityId] : [],
    relatedHypothesisIds: [],
    suggestedOperations: [],
    status: "open",
  };
}

let scenarioCount = 0;
function scenario(name: string, run: () => void): void {
  run();
  scenarioCount += 1;
  assert.ok(name.length > 0);
}

const service = createContextProjectionService();
const realManifestContent = JSON.stringify({
  name: "projection-manifest-fixture",
  version: "1.0.0",
});
const realManifestFile = file({
  id: "file-real-manifest" as EntityId,
  path: "package.json",
  extension: ".json",
  language: "json",
  kind: "configuration",
  sizeBytes: Buffer.byteLength(realManifestContent, "utf8"),
  contentFingerprint: "fingerprint:real-manifest",
});
const realManifestExtraction = await createManifestFactExtractor({
  nowIso: () => "2026-01-01T00:00:00.000Z",
  monotonicMs: () => 0,
}).extract({
  snapshotId,
  fileId: realManifestFile.id,
  path: realManifestFile.normalizedPath,
  content: realManifestContent,
  contentFingerprint: realManifestFile.contentFingerprint,
  language: realManifestFile.language,
});

function assertInvalidProjectionInput(input: ContextProjectionInput): void {
  assert.throws(
    () => service.project(input),
    (error: unknown) => error instanceof ContextProjectionError && error.code === "invalid_input",
  );
}

scenario("confirmed eligible implementation target becomes primary", () => {
  const output = service.project(fixture());
  assert.equal(output.projection.primaryEntities.length, 1);
  assert.equal(output.projection.primaryEntities[0]?.role, "target");
});

scenario("probable implementation target is not primary", () => {
  const input = fixture();
  input.result.findings[0]!.status = "probable";
  input.result.findings[0]!.authorizationHint = "review_required";
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("unresolved implementation target is not primary", () => {
  const input = fixture();
  input.result.findings[0]!.status = "unresolved";
  input.result.findings[0]!.authorizationHint = "not_eligible";
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("unsafe result has no implementation primary target", () => {
  const input = fixture();
  input.result.safeToProject = false;
  input.result.stop.safeToProject = false;
  input.result.stop.reason = "safety_blocked";
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("confirmed supporting finding becomes supporting", () => {
  const input = fixture();
  input.result.findings[0]!.type = "supporting_context";
  assert.equal(service.project(input).projection.supportingEntities[0]?.role, "supporting");
});

scenario("probable supporting finding is review reference only", () => {
  const input = fixture();
  input.purpose = "review";
  input.result.findings[0]!.type = "supporting_context";
  input.result.findings[0]!.status = "probable";
  input.result.findings[0]!.authorizationHint = "review_required";
  const output = service.project(input);
  assert.equal(output.projection.referenceEntities[0]?.reviewRequired, true);
});

scenario("confirmed test target uses test role", () => {
  const input = fixture();
  input.result.findings[0]!.type = "test_target";
  assert.equal(outputRole(service.project(input), "entity-target"), "test");
});

scenario("clarification projection has no primary targets", () => {
  const input = fixture();
  input.purpose = "clarification";
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("open projection gap contradicts a safe sufficient result", () => {
  const input = fixture();
  input.result.knowledgeGaps = [openGap({ entityId: input.result.entities[0]!.id })];
  assertInvalidProjectionInput(input);
});

scenario("open blocking contradiction contradicts a safe sufficient result", () => {
  const input = fixture();
  input.result.contradictions = [{
    id: "contradiction-owner" as ContradictionId,
    snapshotId,
    claimId: "claim-owner" as ClaimId,
    evidenceIds: ["evidence-target" as EvidenceId],
    type: "custom",
    severity: "blocking",
    status: "open",
  }];
  assertInvalidProjectionInput(input);
});

scenario("stale evidence cannot authorize target", () => {
  const input = fixture();
  input.result.evidence[0]!.freshness = { snapshotId, current: false, reason: "stale" };
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("context-only lead cannot authorize target", () => {
  const input = fixture();
  input.result.evidence[0]!.role = "context_only";
  input.result.evidence[0]!.strength = "lead";
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("missing finding evidence rejects target", () => {
  const input = fixture();
  input.result.findings[0]!.evidenceIds = ["evidence-unknown" as EvidenceId];
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("cross-snapshot evidence is rejected", () => {
  const input = fixture();
  input.result.evidence[0]!.snapshotId = otherSnapshotId;
  input.result.evidence[0]!.freshness.snapshotId = otherSnapshotId;
  input.result.evidence[0]!.sourceSpans[0]!.snapshotId = otherSnapshotId;
  assertInvalidProjectionInput(input);
});

scenario("unknown entity is excluded", () => {
  const input = fixture();
  input.result.findings[0]!.entityIds = ["entity-unknown" as EntityId];
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 0);
  assert.equal(output.projection.excludedEntities[0]?.reason, "unknown_entity");
});

scenario("ambiguous evidence-to-file mapping is rejected", () => {
  const input = fixture();
  const secondFile = file({ id: "file-second" as EntityId, path: "src/second.ts" });
  input.snapshot.files.push(secondFile);
  input.snapshot.files.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
  delete input.result.entities[0]!.fileId;
  input.result.findings[0]!.type = "supporting_context";
  input.result.evidence[0]!.sourceSpans.push(span({ file: secondFile }));
  input.result.evidence[0]!.sourceSpans.sort((left, right) => left.path.localeCompare(right.path));
  assert.equal(service.project(input).projection.supportingEntities.length, 0);
});

scenario("eligible explicit path is preserved", () => {
  const input = fixture();
  input.explicitTargets = [{ kind: "path", path: "src/target.ts" }];
  const output = service.project(input);
  assert.ok(output.diagnostics.some((entry) =>
    entry.code === "explicit_target_eligible" && entry.targetKey === "path:src/target.ts"));
});

scenario("unresolved explicit target is review-only", () => {
  const input = fixture();
  input.purpose = "review";
  input.explicitTargets = [{ kind: "symbol", symbol: "entity-target" }];
  input.result.findings[0]!.status = "probable";
  input.result.findings[0]!.authorizationHint = "review_required";
  const target = input.result.entities[0]!;
  const targetFile = input.snapshot.files[0]!;
  input.result.facts = [relationFact({
    id: "fact-explicit-symbol-definition",
    subject: entity({ id: "entity-explicit-symbol-module", fileId: targetFile.id, kind: "module" }),
    object: target,
    predicate: "contains",
    file: targetFile,
  })];
  const output = service.project(input);
  assert.equal(output.projection.referenceEntities.length, 1);
  assert.ok(output.diagnostics.some((entry) => entry.code === "explicit_target_unresolved"));
});

scenario("unknown explicit target is not invented", () => {
  const input = fixture();
  input.explicitTargets = [
    { kind: "path", path: "src/target.ts" },
    { kind: "path", path: "src/missing.ts" },
  ];
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 1);
  assert.ok(output.diagnostics.some((entry) => entry.code === "explicit_target_unknown"));
});

scenario("negative exact path excludes entity", () => {
  const input = fixture();
  input.negativeConstraints = [{ kind: "path", pattern: "src/target.ts" }];
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("negative wildcard excludes entity", () => {
  const input = fixture();
  input.negativeConstraints = [{ kind: "path", pattern: "src/*" }];
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("known secret file is excluded", () => {
  const input = fixture();
  input.snapshot.files[0]!.secretRisk = "known";
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("unreadable file is excluded", () => {
  const input = fixture();
  input.snapshot.files[0]!.readable = false;
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("generated editable target is excluded", () => {
  const input = fixture();
  input.snapshot.files[0]!.generated = true;
  input.snapshot.files[0]!.kind = "generated";
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("grounded generated context is reference-only", () => {
  const input = fixture();
  input.snapshot.files[0]!.generated = true;
  input.snapshot.files[0]!.kind = "generated";
  input.result.findings[0]!.type = "supporting_context";
  const output = service.project(input);
  assert.equal(output.projection.referenceEntities[0]?.role, "reference");
});

scenario("identical duplicate findings merge idempotently", () => {
  const input = fixture();
  input.result.findings.push(structuredClone(input.result.findings[0]!));
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 1);
  assert.deepEqual(output.projection.primaryEntities[0]?.findingIds, ["finding-target"]);
});

scenario("role precedence keeps target over test and supporting", () => {
  const input = fixture();
  input.result.findings.push(
    finding({ id: "finding-support", type: "supporting_context", entityIds: ["entity-target"], evidenceIds: ["evidence-target"] }),
    finding({ id: "finding-test", type: "test_target", entityIds: ["entity-target"], evidenceIds: ["evidence-target"] }),
  );
  const output = service.project(input);
  assert.equal(outputRole(output, "entity-target"), "target");
  assert.equal(output.projection.supportingEntities.length, 0);
});

scenario("input permutation gives identical output", () => {
  const input = fixture();
  const supportFile = file({ id: "file-support" as EntityId, path: "src/support.ts" });
  const supportEntity = entity({ id: "entity-support", fileId: supportFile.id });
  const supportEvidence = evidence({ id: "evidence-support", file: supportFile });
  const supportFinding = finding({ id: "finding-support", type: "supporting_context", entityIds: [supportEntity.id], evidenceIds: [supportEvidence.id] });
  input.snapshot.files.push(supportFile);
  input.snapshot.files.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
  input.result.entities.push(supportEntity);
  input.result.evidence.push(supportEvidence);
  input.result.findings.push(supportFinding);
  const permuted = structuredClone(input);
  permuted.result.entities.reverse();
  permuted.result.evidence.reverse();
  permuted.result.findings.reverse();
  assert.deepEqual(service.project(input), service.project(permuted));
});

scenario("projected entity has exact finding and evidence trace", () => {
  const projected = service.project(fixture()).projection.primaryEntities[0]!;
  assert.deepEqual(projected.findingIds, ["finding-target"]);
  assert.deepEqual(projected.evidenceIds, ["evidence-target"]);
});

scenario("projection does not mutate input", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  service.project(input);
  assert.equal(JSON.stringify(input), before);
});

scenario("review projection preserves grounded probable context", () => {
  const input = fixture();
  input.purpose = "review";
  input.result.findings[0]!.type = "behavior_summary";
  input.result.findings[0]!.status = "probable";
  input.result.findings[0]!.authorizationHint = "review_required";
  assert.equal(service.project(input).projection.referenceEntities.length, 1);
});

scenario("implementation projection remains narrow", () => {
  const input = fixture();
  input.result.findings[0]!.type = "behavior_summary";
  input.result.findings[0]!.status = "probable";
  input.result.findings[0]!.authorizationHint = "review_required";
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 0);
  assert.equal(output.projection.referenceEntities.length, 0);
});

scenario("legacy selection purpose follows implementation safety", () => {
  const input = fixture();
  input.purpose = "legacy_selection";
  assert.equal(service.project(input).projection.primaryEntities.length, 1);
  input.result.safeToProject = false;
  input.result.stop.safeToProject = false;
  input.result.stop.reason = "no_grounded_lead";
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("grounded risk prevents target authorization", () => {
  const input = fixture();
  input.result.findings.push(finding({
    id: "finding-risk",
    type: "risk",
    entityIds: ["entity-target"],
    evidenceIds: ["evidence-target"],
    authorizationHint: "review_required",
  }));
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 0);
  assert.ok(output.diagnostics.some((entry) => entry.code === "risk_requires_review"));
});

scenario("blocked result stays truthful and reviewable", () => {
  const input = fixture();
  input.purpose = "review";
  input.result.safeToProject = false;
  input.result.stop.safeToProject = false;
  input.result.stop.reason = "safety_blocked";
  input.result.findings[0]!.type = "supporting_context";
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 0);
  assert.equal(output.projection.supportingEntities[0]?.reviewRequired, true);
});

scenario("descriptor-unsafe input fails without executing getter", () => {
  const input = fixture();
  let calls = 0;
  Object.defineProperty(input.result.findings[0]!, "statement", {
    enumerable: true,
    get() {
      calls += 1;
      return "unsafe";
    },
  });
  assert.throws(
    () => service.project(input),
    (error: unknown) => error instanceof ContextProjectionError && error.code === "invalid_input",
  );
  assert.equal(calls, 0);
});

scenario("returned projection is frozen", () => {
  const output = service.project(fixture());
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.projection.primaryEntities), true);
});

scenario("unrelated file evidence cannot project another entity", () => {
  const input = fixture();
  const unrelated = file({ id: "file-unrelated" as EntityId, path: "src/unrelated.ts" });
  input.snapshot.files.push(unrelated);
  input.snapshot.files.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
  input.result.evidence[0]!.sourceSpans = [span({ file: unrelated })];
  input.explicitTargets = [];
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 0);
  assert.ok(output.diagnostics.some((entry) => entry.code === "evidence_entity_mismatch"));
});

scenario("same-file source span is accepted with exact explicit path basis", () => {
  assert.equal(service.project(fixture()).projection.primaryEntities.length, 1);
});

scenario("standalone definition fact cannot authorize without an exact target or chain", () => {
  const input = fixture();
  input.explicitTargets = [];
  const target = input.result.entities[0]!;
  const targetFile = input.snapshot.files[0]!;
  const module = entity({ id: "entity-target-module", fileId: targetFile.id, kind: "module" });
  const definition = relationFact({
    id: "fact-target-definition",
    subject: module,
    object: target,
    predicate: "contains",
    file: targetFile,
  });
  input.result.facts = [definition];
  input.result.evidence[0]!.factIds = [definition.id];
  input.result.evidence[0]!.sourceSpans = [];
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 0);
});

scenario("connected multi-file proof chain reaches candidate definition", () => {
  const input = fixture();
  input.explicitTargets = [];
  const target = input.result.entities[0]!;
  const targetFile = input.snapshot.files[0]!;
  const routeFile = file({ id: "file-route" as EntityId, path: "src/route.ts" });
  input.snapshot.files.push(routeFile);
  input.snapshot.files.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
  const routeModule = entity({ id: "entity-route-module", fileId: routeFile.id, kind: "module" });
  const endpoint = entity({ id: "entity-endpoint", fileId: routeFile.id, kind: "endpoint" });
  const targetModule = entity({ id: "entity-target-module", fileId: targetFile.id, kind: "module" });
  const importedTarget = entity({ id: "entity-import-target", kind: "symbol", displayName: target.displayName });
  importedTarget.attributes = {
    importedName: target.displayName,
    moduleSpecifier: "./target",
  };
  const routeFact = relationFact({ id: "fact-route", subject: routeModule, object: endpoint, predicate: "defines_endpoint", file: routeFile });
  const importFact = relationFact({ id: "fact-import", subject: routeModule, object: importedTarget, predicate: "imports", file: routeFile });
  const definitionFact = relationFact({ id: "fact-definition", subject: targetModule, object: target, predicate: "contains", file: targetFile });
  input.result.facts = [definitionFact, importFact, routeFact];
  input.result.evidence = [
    evidence({ id: "evidence-route", file: routeFile, factIds: [routeFact.id, importFact.id], sourceSpans: [] }),
    evidence({ id: "evidence-definition", file: targetFile, factIds: [definitionFact.id], sourceSpans: [] }),
  ];
  input.result.findings[0]!.evidenceIds = ["evidence-definition", "evidence-route"] as EvidenceId[];
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 1);
  assert.deepEqual(output.projection.primaryEntities[0]?.evidenceIds, ["evidence-definition", "evidence-route"]);
});

scenario("route-only evidence without candidate definition is rejected", () => {
  const input = fixture();
  input.explicitTargets = [];
  const routeFile = input.snapshot.files[0]!;
  const route = entity({ id: "entity-route", fileId: routeFile.id, kind: "route" });
  const endpoint = entity({ id: "entity-route-endpoint", fileId: routeFile.id, kind: "endpoint" });
  const routeFact = relationFact({ id: "fact-route-only", subject: route, object: endpoint, predicate: "defines_endpoint", file: routeFile });
  input.result.facts = [routeFact];
  input.result.evidence[0]!.factIds = [routeFact.id];
  input.result.evidence[0]!.sourceSpans = [];
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("unrelated evidence is omitted from projected trace", () => {
  const input = fixture();
  const targetFile = input.snapshot.files[0]!;
  const unrelatedFile = file({ id: "file-unrelated-trace" as EntityId, path: "src/unrelated-trace.ts" });
  input.snapshot.files.push(unrelatedFile);
  input.snapshot.files.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
  const unrelated = evidence({ id: "evidence-unrelated", file: unrelatedFile });
  input.result.evidence.push(unrelated);
  input.result.findings[0]!.evidenceIds.push(unrelated.id);
  input.result.findings[0]!.evidenceIds.sort();
  const projected = service.project(input).projection.primaryEntities[0]!;
  assert.deepEqual(projected.evidenceIds, ["evidence-target"]);
  assert.equal(projected.evidenceIds.includes(unrelated.id), false);
  assert.equal(targetFile.normalizedPath, "src/target.ts");
});

scenario("fileless supporting entity is not assigned a random evidence file", () => {
  const input = fixture();
  delete input.result.entities[0]!.fileId;
  input.result.findings[0]!.type = "supporting_context";
  input.explicitTargets = [];
  const output = service.project(input);
  assert.equal(output.projection.supportingEntities.length, 0);
  assert.ok(output.diagnostics.some((entry) =>
    entry.code === "ambiguous_entity_file" || entry.code === "evidence_entity_mismatch"));
});

scenario("unsafe confirmed test is never editable", () => {
  const input = fixture();
  input.result.findings[0]!.type = "test_target";
  input.result.safeToProject = false;
  input.result.stop.safeToProject = false;
  input.result.stop.reason = "safety_blocked";
  assert.equal(outputRole(service.project(input), "entity-target"), undefined);
});

scenario("mismatched safety flags are rejected before test projection", () => {
  const input = fixture();
  input.result.findings[0]!.type = "test_target";
  input.result.stop.safeToProject = false;
  input.result.stop.reason = "safety_blocked";
  assertInvalidProjectionInput(input);
});

scenario("not-eligible confirmed test is never editable", () => {
  const input = fixture();
  input.result.findings[0]!.type = "test_target";
  input.result.findings[0]!.authorizationHint = "not_eligible";
  assert.equal(outputRole(service.project(input), "entity-target"), undefined);
});

scenario("context-only lead test evidence never authorizes edit", () => {
  const input = fixture();
  input.result.findings[0]!.type = "test_target";
  input.result.evidence[0]!.role = "context_only";
  input.result.evidence[0]!.strength = "lead";
  assert.equal(outputRole(service.project(input), "entity-target"), undefined);
});

scenario("blocking gap makes a forged sufficient test result invalid", () => {
  const input = fixture();
  input.result.findings[0]!.type = "test_target";
  input.result.knowledgeGaps = [openGap({ entityId: input.result.entities[0]!.id })];
  assertInvalidProjectionInput(input);
});

scenario("blocking contradiction makes a forged sufficient test result invalid", () => {
  const input = fixture();
  input.result.findings[0]!.type = "test_target";
  input.result.contradictions = [{
    id: "contradiction-test" as ContradictionId,
    snapshotId,
    claimId: "claim-owner" as ClaimId,
    evidenceIds: ["evidence-target" as EvidenceId],
    type: "custom",
    severity: "blocking",
    status: "open",
  }];
  assertInvalidProjectionInput(input);
});

scenario("material risk prevents test edit", () => {
  const input = fixture();
  input.result.findings[0]!.type = "test_target";
  input.result.findings.push(finding({
    id: "finding-test-risk",
    type: "risk",
    entityIds: ["entity-target"],
    evidenceIds: ["evidence-target"],
    authorizationHint: "review_required",
  }));
  assert.equal(outputRole(service.project(input), "entity-target"), undefined);
});

scenario("valid confirmed eligible test passes complete editable gate", () => {
  const input = fixture();
  input.result.findings[0]!.type = "test_target";
  assert.equal(outputRole(service.project(input), "entity-target"), "test");
});

scenario("review test is reference-only", () => {
  const input = fixture();
  input.purpose = "review";
  input.result.findings[0]!.type = "test_target";
  const output = service.project(input);
  assert.equal(output.projection.referenceEntities[0]?.role, "reference");
  assert.equal(output.projection.referenceEntities[0]?.reviewRequired, true);
});

scenario("service-produced legacy projection remains editable through adapter", () => {
  const input = fixture();
  input.purpose = "legacy_selection";
  const projection = service.project(input);
  const legacy = createLegacyTaskFileSelectionProjection().project(
    projection,
    input.snapshot,
    {
      effectiveTaskArea: "general",
      requestedTaskType: "implementation",
      durationMs: 0,
      negativeConstraints: [],
    },
  );
  assert.equal(legacy.selection.selectedFiles[0]?.usage, "inspect-and-edit");
});

scenario("service-produced eligible test remains editable through adapter", () => {
  const input = fixture();
  input.purpose = "legacy_selection";
  input.result.findings[0]!.type = "test_target";
  const projection = service.project(input);
  const legacy = createLegacyTaskFileSelectionProjection().project(
    projection,
    input.snapshot,
    {
      effectiveTaskArea: "general",
      requestedTaskType: "implementation",
      durationMs: 0,
      negativeConstraints: [],
    },
  );
  assert.equal(projection.projection.supportingEntities[0]?.role, "test");
  assert.equal(legacy.selection.selectedFiles[0]?.usage, "inspect-and-edit");
});

scenario("same-name import with wrong module target cannot form owner chain", () => {
  const input = strictRelationshipFixture({ importTarget: "./totally-other" });
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 0);
  assert.ok(output.diagnostics.some((entry) => entry.code === "evidence_entity_mismatch"));
});

scenario("context-only definition cannot amplify unrelated supporting import", () => {
  const input = strictRelationshipFixture({ importTarget: "./totally-other" });
  const output = service.project(input);
  assert.equal(output.decisions[0]?.role, undefined);
  assert.equal(output.source.safeToProject, true);
});

scenario("same symbol in disconnected modules does not create continuity", () => {
  const input = strictRelationshipFixture({ importTarget: "./different-component" });
  input.result.facts[0]!.subject.id = "entity-disconnected-module" as EntityId;
  assert.equal(service.project(input).projection.primaryEntities.length, 0);
});

scenario("exact relative import reaches file-backed definition", () => {
  const output = service.project(strictRelationshipFixture({ importTarget: "./candidate" }));
  assert.equal(output.projection.primaryEntities[0]?.entityId, "entity-chain-candidate");
  assert.deepEqual(output.projection.primaryEntities[0]?.evidenceIds, [
    "evidence-chain-definition",
    "evidence-chain-import",
  ]);
});

scenario("exact bounded re-export chain remains traceable", () => {
  const output = service.project(strictRelationshipFixture({
    importTarget: "./candidate",
    includeReExport: true,
  }));
  assert.equal(output.projection.primaryEntities.length, 1);
  assert.deepEqual(output.projection.primaryEntities[0]?.evidenceIds, [
    "evidence-chain-definition",
    "evidence-chain-import",
    "evidence-chain-reexport",
  ]);
});

scenario("projection trace excludes evidence outside exact chain", () => {
  const input = strictRelationshipFixture({ importTarget: "./candidate" });
  const unrelatedFile = file({ id: "file-chain-unrelated" as EntityId, path: "src/unrelated.ts" });
  input.snapshot.files.push(unrelatedFile);
  input.snapshot.files.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
  const unrelatedSubject = entity({ id: "entity-unrelated-subject", fileId: unrelatedFile.id, kind: "module" });
  const unrelatedObject = entity({ id: "entity-unrelated-object", kind: "symbol", displayName: "OtherService" });
  unrelatedObject.attributes = { importedName: "OtherService", moduleSpecifier: "./other" };
  const unrelatedFact = relationFact({
    id: "fact-chain-unrelated",
    subject: unrelatedSubject,
    object: unrelatedObject,
    predicate: "imports",
    file: unrelatedFile,
  });
  const unrelatedEvidence = evidence({
    id: "evidence-chain-unrelated",
    file: unrelatedFile,
    factIds: [unrelatedFact.id],
    sourceSpans: [],
  });
  input.result.facts.push(unrelatedFact);
  input.result.evidence.push(unrelatedEvidence);
  input.result.findings[0]!.evidenceIds.push(unrelatedEvidence.id);
  input.result.findings[0]!.evidenceIds.sort();
  const projected = service.project(input).projection.primaryEntities[0]!;
  assert.deepEqual(projected.evidenceIds, ["evidence-chain-definition", "evidence-chain-import"]);
});

scenario("strict relationship projection is fact-order independent", () => {
  const input = strictRelationshipFixture({ importTarget: "./candidate", includeReExport: true });
  const permuted = structuredClone(input);
  permuted.result.facts.reverse();
  permuted.result.evidence.reverse();
  assert.deepEqual(service.project(input), service.project(permuted));
});

scenario("every unique explicit target receives exact keyed diagnostic", () => {
  const input = fixture();
  input.explicitTargets = [
    { kind: "path", path: "src/target.ts" },
    { kind: "symbol", symbol: "MissingSymbol" },
  ];
  const explicitDiagnostics = service.project(input).diagnostics.filter((entry) =>
    entry.code.startsWith("explicit_target_"));
  assert.deepEqual(explicitDiagnostics.map((entry) => entry.targetKey).sort(), [
    "path:src/target.ts",
    "symbol:MissingSymbol",
  ]);
});

function spanAmplificationFixture(claimId = "claim-owner"): ContextProjectionInput {
  const input = fixture();
  input.explicitTargets = [];
  const target = input.result.entities[0]!;
  const targetFile = input.snapshot.files[0]!;
  const definition = relationFact({
    id: "fact-span-amplification-definition",
    subject: entity({ id: "entity-span-amplification-module", fileId: targetFile.id, kind: "module" }),
    object: target,
    predicate: "contains",
    file: targetFile,
  });
  const definitionEvidence = evidence({
    id: "evidence-span-amplification-definition",
    file: targetFile,
    role: "context_only",
    strength: "lead",
    factIds: [definition.id],
    sourceSpans: [],
  });
  const unrelatedSpanEvidence = evidence({
    id: "evidence-span-amplification-unrelated",
    file: targetFile,
    claimId,
    factIds: [],
  });
  input.result.facts = [definition];
  input.result.evidence = [definitionEvidence, unrelatedSpanEvidence];
  input.result.findings[0]!.evidenceIds = [definitionEvidence.id, unrelatedSpanEvidence.id];
  return input;
}

scenario("same-file substantial span cannot amplify a context-only definition", () => {
  const output = service.project(spanAmplificationFixture());
  assert.equal(output.projection.primaryEntities.length, 0);
  assert.ok(output.diagnostics.some((entry) => entry.code === "evidence_entity_mismatch"));
});

scenario("same-file span from another claim cannot authorize a target", () => {
  const output = service.project(spanAmplificationFixture("claim-unrelated"));
  assert.equal(output.projection.primaryEntities.length, 0);
});

scenario("identical repeated entity occurrence is accepted", () => {
  const input = fixture();
  const target = input.result.entities[0]!;
  const targetFile = input.snapshot.files[0]!;
  input.result.facts = [relationFact({
    id: "fact-identical-entity-occurrence",
    subject: entity({ id: "entity-identical-module", fileId: targetFile.id, kind: "module" }),
    object: { ...target, attributes: { ...target.attributes } },
    predicate: "contains",
    file: targetFile,
  })];
  assert.equal(service.project(input).projection.primaryEntities.length, 1);
});

scenario("same entity id with fileless and file-backed shapes is invalid", () => {
  const input = fixture();
  const target = input.result.entities[0]!;
  const targetFile = input.snapshot.files[0]!;
  const conflicting = { ...target };
  delete conflicting.fileId;
  input.result.facts = [relationFact({
    id: "fact-conflicting-fileless-entity",
    subject: entity({ id: "entity-conflicting-module", fileId: targetFile.id, kind: "module" }),
    object: conflicting,
    predicate: "contains",
    file: targetFile,
  })];
  assert.throws(
    () => service.project(input),
    (error: unknown) => error instanceof ContextProjectionError && error.code === "invalid_input",
  );
});

scenario("same entity id with different file ids is invalid", () => {
  const input = fixture();
  const target = input.result.entities[0]!;
  const targetFile = input.snapshot.files[0]!;
  const otherFile = file({ id: "file-conflicting-owner" as EntityId, path: "src/other-owner.ts" });
  input.snapshot.files.push(otherFile);
  input.snapshot.files.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
  input.result.facts = [relationFact({
    id: "fact-conflicting-file-owner",
    subject: entity({ id: "entity-conflicting-file-module", fileId: targetFile.id, kind: "module" }),
    object: { ...target, fileId: otherFile.id },
    predicate: "contains",
    file: targetFile,
  })];
  assert.throws(
    () => service.project(input),
    (error: unknown) => error instanceof ContextProjectionError && error.code === "invalid_input",
  );
});

scenario("spoofed candidate id cannot bridge a wrong module target", () => {
  const input = strictRelationshipFixture({ importTarget: "./totally-other" });
  const candidate = input.result.entities[0]!;
  const importFact = input.result.facts.find((fact) => fact.id === "fact-chain-import")!;
  assert.equal(importFact.kind, "relation");
  if (importFact.kind === "relation") importFact.object.id = candidate.id;
  assert.throws(
    () => service.project(input),
    (error: unknown) => error instanceof ContextProjectionError && error.code === "invalid_input",
  );
});

function explicitSymbolFixture(ambiguous: boolean): ContextProjectionInput {
  const input = fixture();
  const first = input.result.entities[0]!;
  first.displayName = "SharedService";
  const firstFile = input.snapshot.files[0]!;
  input.result.facts = [relationFact({
    id: "fact-shared-first-definition",
    subject: entity({ id: "entity-shared-first-module", fileId: firstFile.id, kind: "module" }),
    object: first,
    predicate: "contains",
    file: firstFile,
  })];
  if (ambiguous) {
    const secondFile = file({ id: "file-shared-second" as EntityId, path: "src/shared-second.ts" });
    const second = entity({
      id: "entity-shared-second",
      fileId: secondFile.id,
      kind: "class",
      displayName: "SharedService",
    });
    input.snapshot.files.push(secondFile);
    input.snapshot.files.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
    input.result.entities.push(second);
    input.result.facts.push(relationFact({
      id: "fact-shared-second-definition",
      subject: entity({ id: "entity-shared-second-module", fileId: secondFile.id, kind: "module" }),
      object: second,
      predicate: "contains",
      file: secondFile,
    }));
  }
  input.explicitTargets = [{ kind: "symbol", symbol: "SharedService" }];
  return input;
}

scenario("ambiguous explicit symbol remains unresolved without arbitrary identity", () => {
  const output = service.project(explicitSymbolFixture(true));
  const diagnosticEntry = output.diagnostics.find((entry) =>
    entry.targetKey === "symbol:SharedService");
  assert.equal(diagnosticEntry?.code, "explicit_target_unresolved");
  assert.equal(diagnosticEntry?.path, undefined);
  assert.equal(diagnosticEntry?.entityId, undefined);
  assert.equal(output.projection.primaryEntities.length, 0);
});

scenario("single exact symbol definition retains eligible behavior", () => {
  const output = service.project(explicitSymbolFixture(false));
  assert.equal(output.projection.primaryEntities.length, 1);
  assert.ok(output.diagnostics.some((entry) =>
    entry.targetKey === "symbol:SharedService" && entry.code === "explicit_target_eligible"));
});

scenario("explicit symbol ambiguity is input-order independent", () => {
  const first = explicitSymbolFixture(true);
  const second = explicitSymbolFixture(true);
  second.result.entities.reverse();
  second.result.facts.reverse();
  assert.deepEqual(service.project(first), service.project(second));
});

scenario("phantom import source path is rejected before relationship projection", () => {
  const input = strictRelationshipFixture({ importTarget: "./candidate" });
  const importFact = input.result.facts.find((fact) => fact.id === "fact-chain-import")!;
  if (importFact.source.kind === "source_span") importFact.source.path = "src/phantom.ts";
  assertInvalidProjectionInput(input);
});

scenario("stale import source fingerprint is rejected", () => {
  const input = strictRelationshipFixture({ importTarget: "./candidate" });
  const importFact = input.result.facts.find((fact) => fact.id === "fact-chain-import")!;
  if (importFact.source.kind === "source_span") {
    importFact.source.contentFingerprint = "fingerprint:stale-import";
  }
  assertInvalidProjectionInput(input);
});

scenario("fact source file id and path mismatch is rejected", () => {
  const input = strictRelationshipFixture({ importTarget: "./candidate" });
  const importFact = input.result.facts.find((fact) => fact.id === "fact-chain-import")!;
  const candidateFile = input.snapshot.files.find((file) => file.normalizedPath === "src/candidate.ts")!;
  if (importFact.source.kind === "source_span") importFact.source.fileId = candidateFile.id;
  assertInvalidProjectionInput(input);
});

scenario("evidence source span with stale fingerprint is rejected", () => {
  const input = fixture();
  input.result.evidence[0]!.sourceSpans[0]!.contentFingerprint = "fingerprint:stale-evidence";
  assertInvalidProjectionInput(input);
});

scenario("blocking contradiction sharing finding evidence is rejected without claim metadata", () => {
  const input = fixture();
  delete input.result.evidence[0]!.claimId;
  input.result.contradictions = [{
    id: "contradiction-shared-evidence" as ContradictionId,
    snapshotId,
    claimId: "claim-unrelated" as ClaimId,
    evidenceIds: [input.result.evidence[0]!.id],
    type: "custom",
    severity: "blocking",
    status: "open",
  }];
  assertInvalidProjectionInput(input);
});

scenario("fact from another snapshot is rejected", () => {
  const input = strictRelationshipFixture({ importTarget: "./candidate" });
  input.result.facts[0]!.snapshotId = otherSnapshotId;
  assertInvalidProjectionInput(input);
});

scenario("top-level entity with unknown file id is rejected", () => {
  const input = fixture();
  input.result.entities[0]!.fileId = "file-phantom" as EntityId;
  assertInvalidProjectionInput(input);
});

scenario("real manifest semantic file entity uses its active snapshot fileId", () => {
  const manifestEntity = realManifestExtraction.entities.find((entry) => entry.kind === "file");
  assert.ok(manifestEntity);
  assert.notEqual(manifestEntity.id, realManifestFile.id);
  assert.equal(manifestEntity.fileId, realManifestFile.id);
  const input: ContextProjectionInput = {
    result: runnerResult({
      entities: realManifestExtraction.entities,
      evidence: [],
      findings: [],
      facts: realManifestExtraction.facts,
      safeToProject: false,
    }),
    snapshot: snapshot([realManifestFile]),
    purpose: "legacy_selection",
    explicitTargets: [],
    negativeConstraints: [],
  };
  const output = service.project(input);
  assert.equal(output.projection.primaryEntities.length, 0);
  assert.ok(output.diagnostics.some((entry) => entry.code === "result_not_safe_to_project"));
});

scenario("file entity without fileId may use a real descriptor identity", () => {
  const input = fixture();
  const descriptor = input.snapshot.files[0]!;
  const target = input.result.entities[0]!;
  target.id = descriptor.id;
  target.kind = "file";
  delete target.fileId;
  input.result.findings[0]!.entityIds = [descriptor.id];
  assert.equal(service.project(input).projection.primaryEntities.length, 1);
});

scenario("explicit invalid fileId does not fall back to a valid file entity id", () => {
  const input = fixture();
  const descriptor = input.snapshot.files[0]!;
  const target = input.result.entities[0]!;
  target.id = descriptor.id;
  target.kind = "file";
  target.fileId = "file-phantom-explicit" as EntityId;
  input.result.findings[0]!.entityIds = [descriptor.id];
  assertInvalidProjectionInput(input);
});

scenario("non-file semantic entity continues to use its active snapshot fileId", () => {
  const input = fixture();
  assert.notEqual(input.result.entities[0]!.id, input.snapshot.files[0]!.id);
  assert.equal(input.result.entities[0]!.kind, "function");
  assert.equal(input.result.entities[0]!.fileId, input.snapshot.files[0]!.id);
  assert.equal(service.project(input).projection.primaryEntities.length, 1);
});

scenario("unknown stop blocker reference is rejected", () => {
  const input = fixture();
  input.result.safeToProject = false;
  input.result.stop.safeToProject = false;
  input.result.stop.reason = "no_grounded_lead";
  input.result.stop.blockingGapIds = ["gap-unknown" as KnowledgeGapId];
  assertInvalidProjectionInput(input);
});

scenario("sufficient evidence cannot carry a resolved blocking gap id", () => {
  const input = fixture();
  const gap = openGap();
  gap.status = "resolved";
  input.result.knowledgeGaps = [gap];
  input.result.stop.blockingGapIds = [gap.id];
  assertInvalidProjectionInput(input);
});

scenario("active repository metadata fact remains valid", () => {
  const input = fixture();
  const target = input.result.entities[0]!;
  input.result.facts = [{
    kind: "fact",
    id: "fact-repository-metadata" as FactId,
    snapshotId,
    subject: target,
    predicate: "package_name",
    object: { type: "string", value: "fixture-package" },
    source: {
      kind: "repository_metadata",
      snapshotId,
      reference: "package.json#name",
      fingerprint: "metadata:fixture-package",
    },
    provenance: {
      extractorId: "extractor.projection-fixture",
      extractorVersion: "1.0.0",
      method: "parser",
      observedAt: "2026-01-01T00:00:00.000Z",
    },
    strength: "exact",
    status: "active",
    attributes: {},
  }];
  assert.equal(service.project(input).projection.primaryEntities.length, 1);
});

function outputRole(
  output: ReturnType<typeof service.project>,
  entityId: string,
): string | undefined {
  return output.decisions.find((entry) => entry.entityId === entityId)?.role;
}

assert.equal(scenarioCount, 86);
console.log(`Context Engine v2 projection smoke passed: ${scenarioCount} scenarios.`);
