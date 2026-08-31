import assert from "node:assert/strict";

import {
  createFactExtractorRegistry,
  createInMemoryKnowledgeGraphStore,
  createManifestFactExtractor,
  createTypeScriptJavaScriptFactExtractor,
} from "../adapters/index.js";
import {
  InvestigationRunnerError,
  createDeterministicInvestigationInterpreter,
  createDeterministicInvestigationPlanner,
  createInvestigationRunner,
} from "../application/index.js";
import { evaluateInvestigationQuestions } from "../application/deterministicQuestionEvaluator.js";
import {
  evaluateFactClaimEligibility,
  evaluateFactClaimEligibilityBatch,
} from "../application/factClaimEligibility.js";
import { evaluateKnowledgeGapResolution } from "../application/truthfulGapEvaluator.js";
import { buildStrictBoundedRelationshipChains } from "../application/strictRelationshipChain.js";
import { createDeterministicOperationQueue } from "../application/deterministicOperationQueue.js";
import {
  createDeterministicOperation,
  deterministicApplicationId,
} from "../application/operationIdentity.js";
import { ZERO_OPERATION_COST } from "../application/operationCost.js";
import type {
  DeterministicInvestigationPlanner,
  DeterministicPlannerState,
  InvestigationRunnerInput,
  InvestigationRunnerResult,
} from "../application/investigationRunnerTypes.js";
import type {
  ClaimId,
  ClaimRecord,
  ContradictionRecord,
  EntityId,
  EvidenceId,
  EvidenceRecord,
  FactId,
  FactRecord,
  Finding,
  FindingId,
  HypothesisId,
  InvestigationBudget,
  InvestigationHypothesis,
  InvestigationId,
  InvestigationRequest,
  InvestigationOperation,
  InvestigationQuestion,
  KnowledgeGap,
  KnowledgeGapId,
  OperationId,
  QuestionId,
  RepositoryEntity,
  RepositorySnapshot,
  SnapshotId,
} from "../contracts/index.js";
import {
  InvestigationDomainError,
  applyOperationCost,
  canFitOperationCost,
  createInvestigationBudgetState,
  evaluateEvidenceRequirement,
  evaluateFindingEligibility,
} from "../domain/index.js";
import type {
  ClockPort,
  ExtractionResult,
  ExtractorInput,
  FactExtractorPort,
  InvestigationCancellationPort,
  KnowledgeGraphStorePort,
  RepositoryReaderPort,
  RepositorySearchPort,
} from "../ports/index.js";
import { InMemoryRepositoryInvestigationAdapter } from "./inMemoryRepositoryInvestigationAdapter.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const scenarios: Array<{ name: string; run: () => void | Promise<void> }> = [];

function scenario(name: string, run: () => void | Promise<void>): void {
  scenarios.push({ name, run });
}

function id<T extends string>(value: string): T {
  return value as T;
}

class ManualClock implements ClockPort {
  constructor(
    private currentIso = timestamp,
    private currentMonotonic = 0,
  ) {}

  nowIso(): string {
    return this.currentIso;
  }

  monotonicMs(): number {
    return this.currentMonotonic;
  }

  advance(milliseconds: number): void {
    this.currentMonotonic += milliseconds;
    this.currentIso = new Date(Date.parse(this.currentIso) + milliseconds).toISOString();
  }
}

class CancellationState implements InvestigationCancellationPort {
  cancelled = false;

  isCancellationRequested(): boolean {
    return this.cancelled;
  }
}

const sourceContent = [
  "export function entry() {",
  "  return target();",
  "}",
  'export function target() { return "ok"; }',
].join("\n");

function snapshot(options: {
  suffix?: string;
  content?: string;
  path?: string;
  readable?: boolean;
  secretRisk?: "none" | "possible" | "known";
  truncated?: boolean;
} = {}): RepositorySnapshot {
  const suffix = options.suffix ?? "a";
  const content = options.content ?? sourceContent;
  const path = options.path ?? "src/feature.ts";
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
        path,
        normalizedPath: path,
        extension: path.endsWith(".json") ? ".json" : ".ts",
        language: path.endsWith(".json") ? "json" : "typescript",
        kind: path.endsWith(".json") ? "configuration" : "source",
        sizeBytes: new TextEncoder().encode(content).byteLength,
        contentFingerprint: `content-${suffix}`,
        readable: options.readable ?? true,
        generated: false,
        secretRisk: options.secretRisk ?? "none",
        attributes: {},
      },
    ],
    limits: { excludedPatterns: [] },
    truncation: {
      truncated: options.truncated ?? false,
      reasons: options.truncated ? ["adapter_limit"] : [],
    },
    metadata: {},
  };
}

function repositoryFixture(
  suffix: string,
  files: ReadonlyArray<{
    path: string;
    content: string;
    kind?: RepositorySnapshot["files"][number]["kind"];
    readable?: boolean;
    secretRisk?: RepositorySnapshot["files"][number]["secretRisk"];
  }>,
  truncated = false,
): {
  snapshot: RepositorySnapshot;
  adapterFiles: Array<{
    fileId: EntityId;
    path: string;
    content: string;
    contentFingerprint: string;
  }>;
} {
  const snapshotId = id<SnapshotId>(`snapshot-${suffix}`);
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const descriptors = ordered.map((file, index) => {
    const extension = file.path.slice(file.path.lastIndexOf("."));
    const fileId = id<EntityId>(`file-${suffix}-${index + 1}`);
    return {
      id: fileId,
      snapshotId,
      path: file.path,
      normalizedPath: file.path,
      extension,
      language: extension === ".json" ? "json" : "typescript",
      kind: file.kind ?? (extension === ".json" ? "configuration" : "source"),
      sizeBytes: new TextEncoder().encode(file.content).byteLength,
      contentFingerprint: `content-${suffix}-${index + 1}`,
      readable: file.readable ?? true,
      generated: false,
      secretRisk: file.secretRisk ?? "none",
      attributes: {},
    } satisfies RepositorySnapshot["files"][number];
  });
  return {
    snapshot: {
      id: snapshotId,
      projectId: `project-${suffix}`,
      rootUri: `repository://${suffix}`,
      rootFingerprint: `root-${suffix}`,
      createdAt: timestamp,
      source: "test_fixture",
      files: descriptors,
      limits: { excludedPatterns: [] },
      truncation: {
        truncated,
        reasons: truncated ? ["adapter_limit"] : [],
      },
      metadata: {},
    },
    adapterFiles: ordered.map((file, index) => ({
      fileId: descriptors[index]!.id,
      path: file.path,
      content: file.content,
      contentFingerprint: descriptors[index]!.contentFingerprint,
    })),
  };
}

function requestFor(
  source: RepositorySnapshot,
  options: {
    task?: string;
    explicitTargets?: InvestigationRequest["explicitTargets"];
    negativeConstraints?: InvestigationRequest["negativeConstraints"];
    purpose?: InvestigationRequest["purpose"];
  } = {},
): InvestigationRequest {
  return {
    requestId: id(`request-${source.projectId}`),
    projectId: source.projectId,
    task: { normalizedTask: options.task ?? "find owner" },
    snapshot: source,
    explicitTargets: options.explicitTargets ?? [],
    negativeConstraints: options.negativeConstraints ?? [],
    budget: budget(),
    purpose: options.purpose ?? "implementation_context",
  };
}

function exactImportOwnerFixture(suffix: string) {
  return repositoryFixture(suffix, [
    {
      path: "src/routes.ts",
      content: [
        'import { handleRequest } from "./service";',
        'router.get("/items", handleRequest);',
      ].join("\n"),
    },
    {
      path: "src/service.ts",
      content: 'export function handleRequest() { return "ok"; }',
    },
  ]);
}

function reExportOwnerFixture(suffix: string) {
  return repositoryFixture(suffix, [
    {
      path: "src/routes.ts",
      content: [
        'import { handleRequest } from "./barrel";',
        'router.get("/items", handleRequest);',
      ].join("\n"),
    },
    {
      path: "src/barrel.ts",
      content: 'export { handleRequest } from "./service";',
    },
    {
      path: "src/service.ts",
      content: 'export function handleRequest() { return "ok"; }',
    },
  ]);
}

function budget(overrides: Partial<InvestigationBudget> = {}): InvestigationBudget {
  return {
    maxOperations: 20,
    maxFileReads: 10,
    maxFileBytes: 100_000,
    maxParsedFiles: 10,
    maxRelationshipHops: 5,
    maxWallTimeMs: 10_000,
    maxPlannerRounds: 10,
    maxConcurrentOperations: 1,
    ...overrides,
  };
}

function emptyCoverage() {
  return {
    criticalQuestionsTotal: 0,
    criticalQuestionsAnswered: 0,
    questionsTotal: 0,
    questionsAnswered: 0,
    hypothesesTotal: 0,
    hypothesesSupported: 0,
    hypothesesRejected: 0,
    hypothesesUnresolved: 0,
    filesConsidered: 0,
    filesRead: 0,
    filesParsed: 0,
    relationshipHops: 0,
    evidenceIndependentGroups: 0,
    snapshotTruncated: false,
    blockedScopes: [],
  };
}

function operation(
  source: RepositorySnapshot,
  seed: Parameters<typeof createDeterministicOperation>[1],
): InvestigationOperation {
  return createDeterministicOperation(source.id, seed);
}

function searchOperation(
  source: RepositorySnapshot,
  query = "feature",
  references: { questions?: QuestionId[]; hypotheses?: HypothesisId[]; priority?: number } = {},
): InvestigationOperation {
  return operation(source, {
    type: "search_paths",
    query,
    reason: "Search a grounded repository scope.",
    questionIds: [...(references.questions ?? [])].sort(),
    hypothesisIds: [...(references.hypotheses ?? [])].sort(),
    priority: references.priority ?? 10,
    estimatedCost: {
      operations: 1,
      fileReads: 0,
      fileBytes: 0,
      parsedFiles: 0,
      relationshipHops: 0,
      plannerRounds: 0,
      wallTimeMs: 0,
    },
    safetyClassification: "safe",
  });
}

function parseOperation(
  source: RepositorySnapshot,
  references: { questions?: QuestionId[]; hypotheses?: HypothesisId[]; priority?: number } = {},
): InvestigationOperation {
  return parsePathOperation(source, source.files[0]!.normalizedPath, references);
}

function parsePathOperation(
  source: RepositorySnapshot,
  path: string,
  references: { questions?: QuestionId[]; hypotheses?: HypothesisId[]; priority?: number } = {},
): InvestigationOperation {
  const file = source.files.find((candidate) => candidate.normalizedPath === path)!;
  return operation(source, {
    type: "parse_file",
    path: file.normalizedPath,
    reason: "Parse snapshot-grounded authorized content.",
    questionIds: [...(references.questions ?? [])].sort(),
    hypothesisIds: [...(references.hypotheses ?? [])].sort(),
    priority: references.priority ?? 10,
    estimatedCost: {
      operations: 1,
      fileReads: 1,
      fileBytes: file.sizeBytes,
      parsedFiles: 1,
      relationshipHops: 0,
      plannerRounds: 0,
      wallTimeMs: 0,
    },
    safetyClassification: "safe",
  });
}

function baseInput(
  source: RepositorySnapshot,
  overrides: Partial<InvestigationRunnerInput> = {},
): InvestigationRunnerInput {
  return {
    investigationId: id<InvestigationId>(`investigation-${source.projectId}`),
    snapshot: source,
    purpose: "implementation_context",
    questions: [],
    claims: [],
    hypotheses: [],
    entities: [],
    facts: [],
    evidence: [],
    findings: [],
    contradictions: [],
    knowledgeGaps: [],
    operationCandidates: [],
    budget: budget(),
    plannerPolicy: {
      maxOperationsPerRound: 1,
      searchResultLimit: 20,
      maxFailedOperationRetries: 0,
    },
    ...overrides,
  };
}

function adapterFor(source: RepositorySnapshot, content = sourceContent) {
  return new InMemoryRepositoryInvestigationAdapter(source, [
    {
      fileId: source.files[0]!.id,
      path: source.files[0]!.normalizedPath,
      content,
      contentFingerprint: source.files[0]!.contentFingerprint,
    },
  ]);
}

function extractors(clock: ClockPort): FactExtractorPort {
  return createFactExtractorRegistry([
    createManifestFactExtractor(clock),
    createTypeScriptJavaScriptFactExtractor(clock),
  ]);
}

function createRunnerHarness(
  source: RepositorySnapshot,
  options: {
    content?: string;
    clock?: ManualClock;
    cancellation?: CancellationState;
    adapter?: InMemoryRepositoryInvestigationAdapter;
    factExtractor?: FactExtractorPort;
    graphStore?: KnowledgeGraphStorePort;
    reader?: RepositoryReaderPort;
    planner?: DeterministicInvestigationPlanner;
  } = {},
) {
  const clock = options.clock ?? new ManualClock();
  const cancellation = options.cancellation ?? new CancellationState();
  const adapter = options.adapter ?? adapterFor(source, options.content ?? sourceContent);
  const graphStore = options.graphStore ?? createInMemoryKnowledgeGraphStore();
  const runner = createInvestigationRunner({
    clock,
    cancellation,
    repositoryReader: options.reader ?? adapter,
    repositorySearch: adapter,
    factExtractor: options.factExtractor ?? extractors(clock),
    graphStore,
    ...(options.planner === undefined ? {} : { planner: options.planner }),
  });
  return { runner, clock, cancellation, adapter, graphStore };
}

async function runStructuredRepositoryFixture(input: {
  source: RepositorySnapshot;
  adapterFiles: ConstructorParameters<typeof InMemoryRepositoryInvestigationAdapter>[1];
  task: string;
  explicitTargets?: InvestigationRequest["explicitTargets"];
  negativeConstraints?: InvestigationRequest["negativeConstraints"];
  budget?: InvestigationBudget;
  cancellation?: CancellationState;
  graphStore?: KnowledgeGraphStorePort;
}) {
  const clock = new ManualClock();
  const cancellation = input.cancellation ?? new CancellationState();
  const adapter = new InMemoryRepositoryInvestigationAdapter(
    input.source,
    input.adapterFiles,
  );
  const graphStore = input.graphStore ?? createInMemoryKnowledgeGraphStore();
  const request = requestFor(input.source, {
    task: input.task,
    explicitTargets: input.explicitTargets,
    negativeConstraints: input.negativeConstraints,
  });
  const selectedBudget = input.budget ?? budget({
    maxOperations: 60,
    maxFileReads: 30,
    maxParsedFiles: 30,
    maxRelationshipHops: 20,
    maxPlannerRounds: 40,
  });
  request.budget = selectedBudget;
  const runner = createInvestigationRunner({
    clock,
    cancellation,
    repositoryReader: adapter,
    repositorySearch: adapter,
    factExtractor: extractors(clock),
    graphStore,
  });
  const runnerInput = baseInput(input.source, {
    request,
    budget: selectedBudget,
    plannerPolicy: {
      maxOperationsPerRound: 1,
      searchResultLimit: 20,
      maxFailedOperationRetries: 1,
    },
  });
  return {
    result: await runner.run(runnerInput),
    adapter,
    graphStore,
    request,
    runnerInput,
  };
}

function claim(source: RepositorySnapshot, suffix = "owner"): ClaimRecord {
  return {
    id: id<ClaimId>(`claim-${suffix}`),
    snapshotId: source.id,
    type: "implementation_owner",
    statement: "The parsed function is an implementation target candidate.",
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    status: "proposed",
    derivation: {
      ruleId: "runner.fixture",
      ruleVersion: "1",
      inputFactIds: [],
    },
  };
}

function hypothesis(
  sourceClaim: ClaimRecord,
  gapIds: KnowledgeGapId[] = [],
): InvestigationHypothesis {
  return {
    id: id<HypothesisId>(`hypothesis-${sourceClaim.id}`),
    claimId: sourceClaim.id,
    priority: "critical",
    status: "open",
    requiredEvidence: [
      {
        id: "requirement-owner",
        description: "A parser-backed containment fact is required.",
        acceptedFactPredicates: ["contains"],
        minimumStrength: "substantial",
        minimumIndependentGroups: 1,
        required: true,
      },
    ],
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    openQuestionIds: [...gapIds].sort(),
    revision: 0,
    history: [],
  };
}

async function groundedFixture(options: {
  viaSearch?: boolean;
  budget?: InvestigationBudget;
  source?: RepositorySnapshot;
  adapter?: InMemoryRepositoryInvestigationAdapter;
  factExtractor?: FactExtractorPort;
} = {}): Promise<{
  result: InvestigationRunnerResult;
  adapter: InMemoryRepositoryInvestigationAdapter;
  graphStore: KnowledgeGraphStorePort;
  input: InvestigationRunnerInput;
}> {
  const source = options.source ?? snapshot();
  const clock = new ManualClock();
  const registry = options.factExtractor ?? extractors(clock);
  const parse = parseOperation(source);
  const extraction = await registry.extract({
    snapshotId: source.id,
    fileId: source.files[0]!.id,
    path: source.files[0]!.normalizedPath,
    content: sourceContent,
    contentFingerprint: source.files[0]!.contentFingerprint,
    language: source.files[0]!.language,
  });
  const ownerClaim = claim(source);
  const ownerHypothesis = hypothesis(ownerClaim);
  const linkedParse = parseOperation(source, {
    questions: [id<QuestionId>("question-owner")],
    hypotheses: [ownerHypothesis.id],
  });
  const contains = extraction.facts.find(
    (fact) =>
      fact.kind === "relation" &&
      fact.predicate === "contains" &&
      fact.object.kind === "function" &&
      fact.object.displayName === "target",
  );
  assert.ok(contains && contains.kind === "relation");
  const gapId = id<KnowledgeGapId>("gap-owner");
  ownerHypothesis.openQuestionIds = [gapId];
  const question: InvestigationQuestion = {
    id: id<QuestionId>("question-owner"),
    text: "Which parsed entity owns the implementation?",
    category: "owner",
    priority: "critical",
    status: "answered",
    answerFindingIds: [id<FindingId>("finding-owner")],
  };
  const gap: KnowledgeGap = {
    id: gapId,
    snapshotId: source.id,
    category: "missing_owner",
    question: "Which parsed entity owns the implementation?",
    blocks: ["authorization", "finding", "projection"],
    relatedEntityIds: [],
    relatedHypothesisIds: [ownerHypothesis.id],
    suggestedOperations: [
      {
        type: "parse_file",
        reason: "Parse the grounded source file.",
        questionIds: [question.id],
        hypothesisIds: [ownerHypothesis.id],
      },
    ],
    status: "open",
  };
  const finding: Finding = {
    id: id<FindingId>("finding-owner"),
    snapshotId: source.id,
    type: "implementation_target",
    statement: "The parsed function is the grounded implementation target.",
    entityIds: [contains.object.id],
    evidenceIds: [],
    status: "probable",
    limitations: [],
    authorizationHint: "not_eligible",
  };
  const firstOperation = options.viaSearch
    ? searchOperation(source, "feature", {
        questions: [question.id],
        hypotheses: [ownerHypothesis.id],
      })
    : linkedParse;
  const input = baseInput(source, {
    questions: [question],
    claims: [ownerClaim],
    hypotheses: [ownerHypothesis],
    entities: extraction.entities,
    findings: [finding],
    knowledgeGaps: [gap],
    operationCandidates: [firstOperation],
    budget: options.budget ?? budget(),
  });
  const adapter = options.adapter ?? adapterFor(source);
  const graphStore = createInMemoryKnowledgeGraphStore();
  const runner = createInvestigationRunner({
    clock,
    cancellation: new CancellationState(),
    repositoryReader: adapter,
    repositorySearch: adapter,
    factExtractor: registry,
    graphStore,
  });
  return { result: await runner.run(input), adapter, graphStore, input };
}

function readOperation(
  source: RepositorySnapshot,
  options: {
    range?: { startLine: number; endLine: number };
    safety?: "safe" | "restricted" | "blocked";
    questions?: QuestionId[];
    hypotheses?: HypothesisId[];
  } = {},
): InvestigationOperation {
  const shared = {
    reason: "Read a snapshot-grounded repository source.",
    questionIds: [...(options.questions ?? [])].sort(),
    hypothesisIds: [...(options.hypotheses ?? [])].sort(),
    priority: 10,
    estimatedCost: {
      operations: 1,
      fileReads: 1,
      fileBytes: source.files[0]!.sizeBytes,
      parsedFiles: 0,
      relationshipHops: 0,
      plannerRounds: 0,
      wallTimeMs: 0,
    },
    safetyClassification: options.safety ?? "safe",
  } as const;
  return options.range
    ? operation(source, {
        type: "read_range",
        path: source.files[0]!.normalizedPath,
        startLine: options.range.startLine,
        endLine: options.range.endLine,
        ...shared,
      })
    : operation(source, {
        type: "read_file",
        path: source.files[0]!.normalizedPath,
        ...shared,
      });
}

function repositoryEntity(
  source: RepositorySnapshot,
  suffix = "owner",
): RepositoryEntity {
  return {
    id: id<EntityId>(`entity-${suffix}`),
    snapshotId: source.id,
    kind: "function",
    displayName: `Entity ${suffix}`,
    canonicalName: `${source.files[0]!.normalizedPath}#${suffix}`,
    fileId: source.files[0]!.id,
    attributes: {},
  };
}

function metadataFact(
  source: RepositorySnapshot,
  suffix = "owner",
  options: {
    value?: string;
    predicate?: string;
    status?: FactRecord["status"];
    subject?: RepositoryEntity;
  } = {},
): FactRecord {
  return {
    kind: "fact",
    id: id<FactId>(`fact-${suffix}`),
    snapshotId: source.id,
    subject: options.subject ?? repositoryEntity(source, suffix),
    predicate: options.predicate ?? "owns",
    object: { type: "string", value: options.value ?? suffix },
    source: {
      kind: "repository_metadata",
      snapshotId: source.id,
      reference: `metadata-${suffix}`,
      fingerprint: `metadata-fingerprint-${suffix}`,
    },
    provenance: {
      extractorId: "fixture.extractor",
      extractorVersion: "1.0.0",
      method: "repository_metadata",
      observedAt: timestamp,
    },
    strength: "exact",
    status: options.status ?? "active",
    attributes: {},
  };
}

function evidenceRecord(
  source: RepositorySnapshot,
  fact: FactRecord | null,
  suffix = "owner",
  options: {
    claimId?: ClaimId;
    role?: EvidenceRecord["role"];
    strength?: EvidenceRecord["strength"];
    current?: boolean;
    group?: string;
    sourceSpanOnly?: boolean;
  } = {},
): EvidenceRecord {
  const current = options.current ?? true;
  const sourceSpan: EvidenceRecord["sourceSpans"][number] = {
    kind: "source_span",
    snapshotId: source.id,
    fileId: source.files[0]!.id,
    path: source.files[0]!.normalizedPath,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 2,
    contentFingerprint: source.files[0]!.contentFingerprint,
  };
  return {
    id: id<EvidenceId>(`evidence-${suffix}`),
    snapshotId: source.id,
    ...(options.claimId === undefined ? {} : { claimId: options.claimId }),
    role: options.role ?? "supports",
    factIds: options.sourceSpanOnly || !fact ? [] : [fact.id],
    sourceSpans: options.sourceSpanOnly ? [sourceSpan] : [],
    summary: `Deterministic evidence ${suffix}`,
    strength: options.strength ?? "substantial",
    independenceGroup: options.group ?? `group-${suffix}`,
    freshness: {
      snapshotId: source.id,
      current,
      reason: current
        ? options.sourceSpanOnly
          ? "fingerprint_match"
          : "snapshot_match"
        : "stale",
    },
    limitations: [],
  };
}

function findingFor(
  source: RepositorySnapshot,
  entity: RepositoryEntity,
  evidenceIds: EvidenceId[],
  status: Finding["status"] = "confirmed",
): Finding {
  return {
    id: id<FindingId>(`finding-${entity.id}`),
    snapshotId: source.id,
    type: "implementation_target",
    statement: "A validated entity is the implementation target.",
    entityIds: [entity.id],
    evidenceIds: [...evidenceIds].sort(),
    status,
    limitations: [],
    authorizationHint: "not_eligible",
  };
}

async function runInput(
  input: InvestigationRunnerInput,
  options: Parameters<typeof createRunnerHarness>[1] = {},
) {
  const harness = createRunnerHarness(input.snapshot, options);
  return {
    ...harness,
    result: await harness.runner.run(input),
  };
}

function syntheticEntity(
  source: RepositorySnapshot,
  path: string,
  suffix: string,
  kind: RepositoryEntity["kind"],
  displayName: string,
  attributes: RepositoryEntity["attributes"] = {},
): RepositoryEntity {
  const file = source.files.find((candidate) => candidate.normalizedPath === path);
  return {
    id: id<EntityId>(`entity-${suffix}`),
    snapshotId: source.id,
    kind,
    displayName,
    ...(file === undefined ? {} : { fileId: file.id }),
    attributes,
  };
}

function syntheticRelation(
  source: RepositorySnapshot,
  path: string,
  suffix: string,
  subject: RepositoryEntity,
  predicate: string,
  object: RepositoryEntity,
): FactRecord {
  const file = source.files.find((candidate) => candidate.normalizedPath === path)!;
  return {
    kind: "relation",
    id: id<FactId>(`fact-${suffix}`),
    snapshotId: source.id,
    subject,
    predicate,
    object,
    source: {
      kind: "source_span",
      snapshotId: source.id,
      fileId: file.id,
      path: file.normalizedPath,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 2,
      contentFingerprint: file.contentFingerprint,
    },
    provenance: {
      extractorId: "fixture.owner-chain",
      extractorVersion: "1",
      method: "parser",
      observedAt: timestamp,
    },
    strength: "exact",
    status: "active",
    attributes: {},
  };
}

async function runSyntheticOwnerFacts(input: {
  suffix: string;
  facts: (source: RepositorySnapshot) => {
    entities: RepositoryEntity[];
    facts: FactRecord[];
    expectedChainFactIds?: FactId[];
    unrelatedFactIds?: FactId[];
  };
  reverseFacts?: boolean;
}) {
  const fixture = repositoryFixture(input.suffix, [
    { path: "src/candidate.ts", content: "export function CandidateService() {}" },
    { path: "src/import.ts", content: "export const importModule = true;" },
    { path: "src/other.ts", content: "export function CandidateService() {}" },
    { path: "src/route.ts", content: "export const routeModule = true;" },
  ]);
  const records = input.facts(fixture.snapshot);
  const ownerClaim = claim(fixture.snapshot, input.suffix);
  const ownerHypothesis = hypothesis(ownerClaim);
  ownerHypothesis.requiredEvidence[0]!.acceptedFactPredicates = [
    "calls",
    "contains",
    "defines_endpoint",
    "defines_route",
    "imports",
    "re_exports",
  ];
  const question = openQuestion(`owner-chain-${input.suffix}`, "critical");
  const gap: KnowledgeGap = {
    id: id<KnowledgeGapId>(`gap-owner-chain-${input.suffix}`),
    snapshotId: fixture.snapshot.id,
    category: "missing_owner",
    question: question.text,
    blocks: ["authorization", "finding", "projection"],
    relatedEntityIds: [],
    relatedHypothesisIds: [ownerHypothesis.id],
    suggestedOperations: [],
    status: "open",
  };
  ownerHypothesis.openQuestionIds = [gap.id];
  const orderedFacts = input.reverseFacts ? [...records.facts].reverse() : records.facts;
  const parsePaths = [...new Set(orderedFacts.map((fact) => {
    assert.equal(fact.source.kind, "source_span");
    return fact.source.path;
  }))].sort();
  const parses = parsePaths.map((path) => parsePathOperation(fixture.snapshot, path, {
    questions: [question.id],
    hypotheses: [ownerHypothesis.id],
  }));
  const factExtractor: FactExtractorPort = {
    id: "fixture.owner-chain",
    version: "1",
    supports: () => true,
    extract: async (extractorInput) => {
      const facts = orderedFacts.filter(
        (fact) => fact.source.kind === "source_span" && fact.source.path === extractorInput.path,
      );
      const referencedIds = new Set(
        facts.flatMap((fact) =>
          fact.kind === "relation"
            ? [fact.subject.id, fact.object.id]
            : [fact.subject.id],
        ),
      );
      const entities = records.entities.filter((entity) => referencedIds.has(entity.id));
      return {
        entities: structuredClone(entities),
        facts: structuredClone(facts),
        limitations: [],
      };
    },
  };
  const adapter = new InMemoryRepositoryInvestigationAdapter(
    fixture.snapshot,
    fixture.adapterFiles,
  );
  const output = await runInput(baseInput(fixture.snapshot, {
    questions: [question],
    claims: [ownerClaim],
    hypotheses: [ownerHypothesis],
    knowledgeGaps: [gap],
    operationCandidates: parses,
    budget: budget({
      maxOperations: 40,
      maxFileReads: 20,
      maxParsedFiles: 20,
      maxRelationshipHops: 10,
      maxPlannerRounds: 20,
    }),
  }), { adapter, factExtractor });
  return { ...output, records, ownerClaim, ownerHypothesis, question };
}

function directOwnerChainRecords(
  source: RepositorySnapshot,
  suffix: string,
  origin: "connected_call" | "disconnected_call" | "route",
) {
  const routeModule = syntheticEntity(source, "src/route.ts", `${suffix}-route-module`, "module", "route");
  const routeHandler = syntheticEntity(source, "src/route.ts", `${suffix}-route-handler`, "function", "RouteHandler");
  const endpoint = syntheticEntity(source, "src/route.ts", `${suffix}-endpoint`, "endpoint", "GET /items");
  const unrelated = syntheticEntity(source, "src/route.ts", `${suffix}-unrelated`, "function", "UnrelatedHelper");
  const importModule = syntheticEntity(source, "src/import.ts", `${suffix}-import-module`, "module", "import");
  const importedCandidate = syntheticEntity(
    source,
    "",
    `${suffix}-imported-candidate`,
    "symbol",
    "CandidateService",
    {
      importedName: "CandidateService",
      localName: "CandidateService",
      moduleSpecifier: "./candidate",
    },
  );
  const candidateModule = syntheticEntity(source, "src/candidate.ts", `${suffix}-candidate-module`, "module", "candidate");
  const candidate = syntheticEntity(source, "src/candidate.ts", `${suffix}-candidate`, "function", "CandidateService");
  const originFact = origin === "route"
    ? syntheticRelation(source, "src/route.ts", `${suffix}-origin-route`, routeModule, "defines_endpoint", endpoint)
    : syntheticRelation(
        source,
        "src/route.ts",
        `${suffix}-origin-call`,
        routeHandler,
        "calls",
        origin === "connected_call" ? importedCandidate : unrelated,
      );
  const importFact = syntheticRelation(
    source,
    origin === "connected_call" ? "src/import.ts" : "src/route.ts",
    `${suffix}-import`,
    origin === "connected_call" ? importModule : routeModule,
    "imports",
    importedCandidate,
  );
  const containsFact = syntheticRelation(
    source,
    "src/candidate.ts",
    `${suffix}-contains`,
    candidateModule,
    "contains",
    candidate,
  );
  return {
    entities: [
      routeModule,
      routeHandler,
      endpoint,
      unrelated,
      importModule,
      importedCandidate,
      candidateModule,
      candidate,
    ],
    facts: [originFact, importFact, containsFact],
    originFact,
    importFact,
    containsFact,
    candidate,
  };
}

function groundFactForOperation(
  fact: FactRecord,
  operationId: OperationId,
): FactRecord {
  return {
    ...fact,
    provenance: {
      ...fact.provenance,
      operationId,
    },
  };
}

function directOwnerEligibilityContext(suffix: string) {
  const fixture = repositoryFixture(suffix, [
    { path: "src/candidate.ts", content: "export function CandidateService() {}" },
    { path: "src/import.ts", content: "export const importModule = true;" },
    { path: "src/other.ts", content: "export function OtherOwner() {}" },
    { path: "src/route.ts", content: "export const routeModule = true;" },
  ]);
  const ownerClaim = claim(fixture.snapshot, suffix);
  const ownerHypothesis = hypothesis(ownerClaim);
  ownerHypothesis.requiredEvidence[0]!.acceptedFactPredicates = [
    "calls",
    "contains",
    "defines_endpoint",
    "defines_route",
    "imports",
    "re_exports",
  ];
  const linkedOperation = parsePathOperation(fixture.snapshot, "src/route.ts", {
    hypotheses: [ownerHypothesis.id],
  });
  const records = directOwnerChainRecords(fixture.snapshot, suffix, "connected_call");
  const facts = records.facts.map((fact) => groundFactForOperation(fact, linkedOperation.id));
  return {
    fixture,
    ownerClaim,
    ownerHypothesis,
    linkedOperation,
    records,
    facts,
  };
}

function extractionBoundaryFixture(suffix: string) {
  return repositoryFixture(suffix, [
    { path: "src/a-public.ts", content: "export const publicValue = 1;" },
    { path: "src/private/secret.ts", content: "export const privateValue = 2;" },
  ]);
}

function currentFileRelation(
  source: RepositorySnapshot,
  suffix: string,
): {
  entities: RepositoryEntity[];
  fact: FactRecord;
  subject: RepositoryEntity;
  object: RepositoryEntity;
} {
  const subject = syntheticEntity(
    source,
    "src/a-public.ts",
    `${suffix}-subject`,
    "module",
    "a-public",
  );
  const object = syntheticEntity(
    source,
    "",
    `${suffix}-reference`,
    "symbol",
    "Dependency",
    {
      importedName: "Dependency",
      localName: "Dependency",
      moduleSpecifier: "./dependency",
    },
  );
  return {
    entities: [subject, object],
    fact: syntheticRelation(
      source,
      "src/a-public.ts",
      `${suffix}-relation`,
      subject,
      "imports",
      object,
    ),
    subject,
    object,
  };
}

function filelessReferenceRelation(
  source: RepositorySnapshot,
  suffix: string,
  predicate: string,
  kind: RepositoryEntity["kind"] = "symbol",
) {
  const subject = syntheticEntity(
    source,
    "src/a-public.ts",
    `${suffix}-subject`,
    "module",
    "a-public",
  );
  const reference = syntheticEntity(
    source,
    "",
    `${suffix}-reference`,
    kind,
    kind === "component" ? "RenderedComponent" : "ReferencedSymbol",
    { referenceKind: "unresolved_syntax_reference" },
  );
  const fact = syntheticRelation(
    source,
    "src/a-public.ts",
    `${suffix}-fact`,
    subject,
    predicate,
    reference,
  );
  return { entities: [subject, reference], fact, subject, reference };
}

async function runExtractionBoundaryCase(input: {
  suffix: string;
  extraction: (
    source: RepositorySnapshot,
    extractorInput: ExtractorInput,
  ) => unknown;
  negativeConstraints?: InvestigationRequest["negativeConstraints"];
}) {
  const fixture = extractionBoundaryFixture(input.suffix);
  const publicFile = fixture.snapshot.files.find(
    (file) => file.normalizedPath === "src/a-public.ts",
  )!;
  const selectedBudget = budget({ maxPlannerRounds: 20 });
  const request = input.negativeConstraints === undefined
    ? undefined
    : requestFor(fixture.snapshot, {
        task: "inspect the public source",
        negativeConstraints: input.negativeConstraints,
      });
  if (request) request.budget = selectedBudget;
  const factExtractor: FactExtractorPort = {
    id: "fixture.extraction-boundary",
    version: "1",
    supports: () => true,
    extract: async (extractorInput) =>
      input.extraction(fixture.snapshot, extractorInput) as ExtractionResult,
  };
  const adapter = new InMemoryRepositoryInvestigationAdapter(
    fixture.snapshot,
    fixture.adapterFiles,
  );
  const graphStore = createInMemoryKnowledgeGraphStore();
  const output = await runInput(baseInput(fixture.snapshot, {
    ...(request === undefined ? {} : { request }),
    operationCandidates: [parsePathOperation(
      fixture.snapshot,
      publicFile.normalizedPath,
      { priority: 1_000 },
    )],
    budget: selectedBudget,
  }), { adapter, factExtractor, graphStore });
  return { ...output, fixture, publicFile, graphStore };
}

function invalidExtractionRecord(result: InvestigationRunnerResult) {
  const record = result.operationRecords.find(
    (candidate) => candidate.error?.code === "invalid_operation_result",
  );
  assert.ok(record);
  assert.equal(record.status, "failed");
  assert.deepEqual(record.producedEntityIds, []);
  assert.deepEqual(record.producedFactIds, []);
  assert.deepEqual(record.producedEvidenceIds, []);
  return record;
}

function sufficientInput(source = snapshot({ suffix: "sufficient" })) {
  const owner = repositoryEntity(source, "sufficient");
  const fact = metadataFact(source, "sufficient", { subject: owner });
  const evidence = evidenceRecord(source, fact, "sufficient");
  const finding = findingFor(source, owner, [evidence.id]);
  return baseInput(source, {
    entities: [owner],
    facts: [fact],
    evidence: [evidence],
    findings: [finding],
  });
}

function plannerState(
  source: RepositorySnapshot,
  overrides: Partial<DeterministicPlannerState> = {},
): DeterministicPlannerState {
  return {
    snapshotId: source.id,
    snapshot: source,
    explicitTargets: [],
    negativeConstraints: [],
    questions: [],
    claims: [],
    hypotheses: [],
    evidence: [],
    facts: [],
    contradictions: [],
    knowledgeGaps: [],
    findings: [],
    entities: [],
    coverage: emptyCoverage(),
    budgetState: createInvestigationBudgetState(budget()),
    operationCandidates: [],
    operationRecords: [],
    policy: {
      maxOperationsPerRound: 10,
      searchResultLimit: 10,
      maxFailedOperationRetries: 0,
    },
    repositoryChanged: false,
    ...overrides,
  };
}

function openQuestion(suffix: string, priority: InvestigationQuestion["priority"]): InvestigationQuestion {
  return {
    id: id<QuestionId>(`question-${suffix}`),
    text: `Repository question ${suffix}`,
    category: "owner",
    priority,
    status: "open",
    answerFindingIds: [],
  };
}

async function assertRejects(
  action: () => unknown | Promise<unknown>,
  predicate?: (error: unknown) => boolean,
): Promise<void> {
  const wrapped = async () => {
    await action();
  };
  if (predicate) await assert.rejects(wrapped, predicate);
  else await assert.rejects(wrapped);
}

function contradictoryInput(source = snapshot({ suffix: "contradiction" })) {
  const owner = repositoryEntity(source, "contradiction");
  const first = metadataFact(source, "contradiction-a", {
    subject: owner,
    value: "owner-a",
    predicate: "owns",
  });
  const second = metadataFact(source, "contradiction-b", {
    subject: owner,
    value: "owner-b",
    predicate: "owns",
  });
  const ownerClaim = claim(source, "contradiction");
  ownerClaim.derivation.inputFactIds = [first.id, second.id].sort();
  const support = evidenceRecord(source, first, "contradiction-a", {
    claimId: ownerClaim.id,
    role: "supports",
  });
  const contradict = evidenceRecord(source, second, "contradiction-b", {
    claimId: ownerClaim.id,
    role: "contradicts",
  });
  ownerClaim.supportingEvidenceIds = [support.id];
  ownerClaim.contradictingEvidenceIds = [contradict.id];
  ownerClaim.status = "supported";
  const ownerHypothesis = hypothesis(ownerClaim);
  ownerHypothesis.status = "supported";
  ownerHypothesis.supportingEvidenceIds = [support.id];
  return baseInput(source, {
    claims: [ownerClaim],
    hypotheses: [ownerHypothesis],
    entities: [owner],
    facts: [first, second],
    evidence: [support, contradict],
    budget: budget({ maxPlannerRounds: 1 }),
  });
}

scenario("1. planner prioritizes a critical blocking question", () => {
  const source = snapshot({ suffix: "planner-critical" });
  const critical = openQuestion("critical", "critical");
  const normal = openQuestion("normal", "normal");
  const criticalOperation = searchOperation(source, "feature", {
    questions: [critical.id],
    priority: 1,
  });
  const normalOperation = searchOperation(source, "target", {
    questions: [normal.id],
    priority: 100,
  });
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, {
      questions: [normal, critical],
      operationCandidates: [normalOperation, criticalOperation],
    }),
  );
  assert.equal(plan.operations[0]?.id, criticalOperation.id);
});

scenario("2. required evidence is planned before optional context", () => {
  const source = snapshot({ suffix: "planner-required" });
  const ownerClaim = claim(source, "required");
  const ownerHypothesis = hypothesis(ownerClaim);
  const required = searchOperation(source, "feature", {
    hypotheses: [ownerHypothesis.id],
  });
  const optional = searchOperation(source, "target", { priority: 100 });
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, {
      claims: [ownerClaim],
      hypotheses: [ownerHypothesis],
      operationCandidates: [optional, required],
    }),
  );
  assert.equal(plan.operations[0]?.id, required.id);
});

scenario("3. blocking contradiction resolution precedes corroboration", () => {
  const source = snapshot({ suffix: "planner-contradiction" });
  const ownerClaim = claim(source, "planner-contradiction");
  const ownerHypothesis = hypothesis(ownerClaim);
  const resolution = searchOperation(source, "feature", {
    hypotheses: [ownerHypothesis.id],
  });
  const corroboration = searchOperation(source, "target");
  const contradiction: ContradictionRecord = {
    id: id("contradiction-planner"),
    snapshotId: source.id,
    claimId: ownerClaim.id,
    evidenceIds: [id("evidence-planner")],
    type: "custom",
    severity: "blocking",
    status: "open",
  };
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, {
      claims: [ownerClaim],
      hypotheses: [ownerHypothesis],
      contradictions: [contradiction],
      operationCandidates: [corroboration, resolution],
    }),
  );
  assert.equal(plan.operations[0]?.id, resolution.id);
});

scenario("4. identical planner proposal is idempotently deduplicated", () => {
  const source = snapshot({ suffix: "planner-duplicate" });
  const candidate = searchOperation(source);
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, {
      operationCandidates: [candidate, structuredClone(candidate)],
    }),
  );
  assert.equal(plan.operations.length, 1);
});

scenario("5. conflicting proposal id is rejected", () => {
  const source = snapshot({ suffix: "planner-conflict" });
  const first = searchOperation(source);
  const conflicting = { ...structuredClone(first), query: "different-target" };
  assert.throws(
    () =>
      createDeterministicInvestigationPlanner().proposeNextOperations(
        plannerState(source, { operationCandidates: [first, conflicting] }),
      ),
    (error) => error instanceof InvestigationRunnerError && error.code === "operation_conflict",
  );
});

scenario("6. planner proposal order is deterministic", () => {
  const source = snapshot({ suffix: "planner-order" });
  const first = searchOperation(source, "alpha", { priority: 4 });
  const second = searchOperation(source, "beta", { priority: 8 });
  const planner = createDeterministicInvestigationPlanner();
  const left = planner.proposeNextOperations(
    plannerState(source, { operationCandidates: [first, second] }),
  );
  const right = planner.proposeNextOperations(
    plannerState(source, { operationCandidates: [second, first] }),
  );
  assert.deepEqual(left, right);
});

scenario("7. no grounded input creates no invented target", () => {
  const source = snapshot({ suffix: "planner-empty" });
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source),
  );
  assert.equal(plan.productive, false);
  assert.deepEqual(plan.operations, []);
});

scenario("8. planner ignores numeric confidence-like caller noise", () => {
  const source = snapshot({ suffix: "planner-confidence" });
  const candidate = searchOperation(source);
  const planner = createDeterministicInvestigationPlanner();
  const normal = planner.proposeNextOperations(
    plannerState(source, { operationCandidates: [candidate] }),
  );
  const noisy = planner.proposeNextOperations({
    ...plannerState(source, { operationCandidates: [candidate] }),
    confidence: 99,
  } as DeterministicPlannerState);
  assert.deepEqual(noisy, normal);
});

scenario("9. completed operation is not proposed again", () => {
  const source = snapshot({ suffix: "planner-completed" });
  const candidate = searchOperation(source);
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, {
      operationCandidates: [candidate],
      operationRecords: [
        {
          operation: candidate,
          status: "completed",
          producedEntityIds: [],
          producedFactIds: [],
          producedEvidenceIds: [],
        },
      ],
    }),
  );
  assert.equal(plan.productive, false);
  assert.deepEqual(plan.skippedDuplicateOperationIds, [candidate.id]);
});

scenario("10. planner result survives all input permutations", () => {
  const source = snapshot({ suffix: "planner-permutation" });
  const operations = [
    searchOperation(source, "gamma", { priority: 3 }),
    searchOperation(source, "alpha", { priority: 3 }),
    searchOperation(source, "beta", { priority: 3 }),
  ];
  const planner = createDeterministicInvestigationPlanner();
  const expected = planner.proposeNextOperations(
    plannerState(source, { operationCandidates: operations }),
  );
  const actual = planner.proposeNextOperations(
    plannerState(source, { operationCandidates: [...operations].reverse() }),
  );
  assert.deepEqual(actual, expected);
});

scenario("11. operation queue uses canonical order", () => {
  const source = snapshot({ suffix: "queue-order" });
  const low = searchOperation(source, "low", { priority: 1 });
  const high = searchOperation(source, "high", { priority: 9 });
  const queue = createDeterministicOperationQueue();
  queue.enqueue([low, high]);
  assert.equal(queue.dequeue()?.id, high.id);
});

scenario("12. duplicate queued operation executes once", () => {
  const source = snapshot({ suffix: "queue-duplicate" });
  const candidate = searchOperation(source);
  const queue = createDeterministicOperationQueue();
  assert.deepEqual(queue.enqueue([candidate, structuredClone(candidate)]), [candidate.id]);
  assert.equal(queue.snapshot().length, 1);
});

scenario("13. operation outside budget is never launched", async () => {
  const source = snapshot({ suffix: "budget-reject" });
  const input = baseInput(source, {
    operationCandidates: [readOperation(source)],
    budget: budget({ maxFileBytes: 1, maxPlannerRounds: 2 }),
  });
  const { result, adapter } = await runInput(input);
  assert.equal(adapter.callCounts.readFile, 0);
  assert.ok(result.operationRecords.some((record) => record.status === "skipped"));
});

scenario("14. zero operation budget stops before execution", async () => {
  const source = snapshot({ suffix: "budget-zero-operation" });
  const { result, adapter } = await runInput(
    baseInput(source, {
      operationCandidates: [readOperation(source)],
      budget: budget({ maxOperations: 0 }),
    }),
  );
  assert.equal(result.stop.reason, "operation_budget_exhausted");
  assert.equal(adapter.callCounts.readFile, 0);
});

scenario("15. file byte parse and hop limits participate in preflight", () => {
  const state = createInvestigationBudgetState(
    budget({
      maxFileReads: 0,
      maxFileBytes: 0,
      maxParsedFiles: 0,
      maxRelationshipHops: 0,
    }),
  );
  assert.equal(
    canFitOperationCost(state, {
      operations: 0,
      fileReads: 1,
      fileBytes: 1,
      parsedFiles: 1,
      relationshipHops: 1,
      plannerRounds: 0,
      wallTimeMs: 0,
    }),
    false,
  );
});

scenario("16. zero planner-round budget stops canonically", async () => {
  const source = snapshot({ suffix: "budget-zero-planner" });
  const { result } = await runInput(
    baseInput(source, { budget: budget({ maxPlannerRounds: 0 }) }),
  );
  assert.equal(result.stop.reason, "planner_round_budget_exhausted");
});

scenario("17. operation cost is applied exactly once", () => {
  const initial = createInvestigationBudgetState(budget());
  const cost = {
    operations: 1,
    fileReads: 1,
    fileBytes: 8,
    parsedFiles: 1,
    relationshipHops: 0,
    plannerRounds: 0,
    wallTimeMs: 0,
  };
  const next = applyOperationCost(initial, cost);
  assert.deepEqual(next.usage, cost);
  assert.equal(initial.usage.operations, 0);
});

scenario("18. failed operation accounting is not duplicated", async () => {
  const source = snapshot({ suffix: "budget-failed" });
  const adapter = adapterFor(source);
  adapter.setReadFailure(source.files[0]!.id, "unreadable");
  const { result } = await runInput(
    baseInput(source, {
      operationCandidates: [readOperation(source)],
      budget: budget({ maxPlannerRounds: 2 }),
    }),
    { adapter },
  );
  assert.equal(result.budgetState.usage.operations, 1);
  assert.equal(result.operationRecords.filter((record) => record.status === "failed").length, 1);
});

scenario("19. caller zero-cost search is replaced by canonical cost", async () => {
  const source = snapshot({ suffix: "budget-zero-cost" });
  const candidate = searchOperation(source, "missing");
  candidate.estimatedCost = {
    operations: 0,
    fileReads: 0,
    fileBytes: 0,
    parsedFiles: 0,
    relationshipHops: 0,
    plannerRounds: 0,
    wallTimeMs: 0,
  };
  const { result, adapter } = await runInput(
    baseInput(source, {
      operationCandidates: [candidate],
      budget: budget({ maxPlannerRounds: 2 }),
    }),
  );
  assert.ok(adapter.callCounts.searchPaths >= 1);
  assert.equal(result.budgetState.usage.operations, 1);
});

scenario("20. cancellation before execution prevents port calls", async () => {
  const source = snapshot({ suffix: "cancel-before" });
  const cancellation = new CancellationState();
  cancellation.cancelled = true;
  const harness = createRunnerHarness(source, { cancellation });
  await assertRejects(
    () => harness.runner.run(baseInput(source, { operationCandidates: [readOperation(source)] })),
    (error) => error instanceof InvestigationRunnerError && error.code === "cancelled",
  );
  assert.equal(harness.adapter.callCounts.readFile, 0);
});

scenario("21. snapshot-verified read completes", async () => {
  const source = snapshot({ suffix: "read-success" });
  const { result, adapter } = await runInput(
    baseInput(source, {
      operationCandidates: [readOperation(source)],
      budget: budget({ maxPlannerRounds: 3 }),
    }),
  );
  assert.equal(adapter.callCounts.readFile, 1);
  assert.ok(result.operationRecords.some((record) => record.status === "completed"));
});

scenario("22. read result with unknown file id is rejected", async () => {
  const source = snapshot({ suffix: "read-unknown-id" });
  const adapter = adapterFor(source);
  const reader: RepositoryReaderPort = {
    readFile: async (request) => ({
      status: "success",
      snapshotId: request.snapshotId,
      fileId: id<EntityId>("file-unknown"),
      path: request.path,
      content: sourceContent,
      contentFingerprint: source.files[0]!.contentFingerprint,
      bytesRead: source.files[0]!.sizeBytes,
      startLine: 1,
      endLine: 4,
    }),
    readRange: (request) => adapter.readRange(request),
  };
  const { result } = await runInput(
    baseInput(source, { operationCandidates: [readOperation(source)] }),
    { adapter, reader },
  );
  assert.equal(result.stop.reason, "repository_changed");
});

scenario("23. read result path mismatch stops as repository changed", async () => {
  const source = snapshot({ suffix: "read-path-mismatch" });
  const adapter = adapterFor(source);
  const reader: RepositoryReaderPort = {
    readFile: async (request) => ({
      status: "success",
      snapshotId: request.snapshotId,
      fileId: request.fileId,
      path: "src/other.ts",
      content: sourceContent,
      contentFingerprint: source.files[0]!.contentFingerprint,
      bytesRead: source.files[0]!.sizeBytes,
      startLine: 1,
      endLine: 4,
    }),
    readRange: (request) => adapter.readRange(request),
  };
  const { result } = await runInput(
    baseInput(source, { operationCandidates: [readOperation(source)] }),
    { adapter, reader },
  );
  assert.equal(result.stop.reason, "repository_changed");
});

scenario("24. fingerprint mismatch stops as repository changed", async () => {
  const source = snapshot({ suffix: "read-fingerprint" });
  const adapter = adapterFor(source);
  adapter.setCurrentFingerprint(source.files[0]!.id, "content-new");
  const { result } = await runInput(
    baseInput(source, { operationCandidates: [readOperation(source)] }),
    { adapter },
  );
  assert.equal(result.stop.reason, "repository_changed");
});

scenario("25. cross-snapshot search result is rejected", async () => {
  const source = snapshot({ suffix: "search-cross-snapshot" });
  const adapter = adapterFor(source);
  const search: RepositorySearchPort = {
    searchPaths: async () => [{
      kind: "lead",
      snapshotId: id<SnapshotId>("snapshot-other"),
      path: source.files[0]!.normalizedPath,
    }],
    searchText: (query) => adapter.searchText(query),
    searchSymbols: (query) => adapter.searchSymbols(query),
  };
  const runner = createInvestigationRunner({
    clock: new ManualClock(),
    cancellation: new CancellationState(),
    repositoryReader: adapter,
    repositorySearch: search,
    factExtractor: extractors(new ManualClock()),
    graphStore: createInMemoryKnowledgeGraphStore(),
  });
  const result = await runner.run(
    baseInput(source, { operationCandidates: [searchOperation(source)] }),
  );
  assert.equal(result.stop.reason, "repository_changed");
});

scenario("26. parse uses the registered deterministic extractor", async () => {
  const { result } = await groundedFixture();
  assert.ok(result.facts.some((fact) => fact.provenance.extractorId === "typescript-javascript-fact-extractor"));
});

scenario("27. extracted facts are stored in the graph", async () => {
  const { result, graphStore } = await groundedFixture();
  const trace = await graphStore.exportTrace(result.snapshotId);
  assert.deepEqual(trace.facts.map((fact) => fact.id), result.facts.map((fact) => fact.id));
});

scenario("28. malformed extractor fact is rejected atomically", async () => {
  const source = snapshot({ suffix: "extract-malformed" });
  const malformed: FactExtractorPort = {
    id: "malformed.extractor",
    version: "1",
    supports: () => true,
    extract: async () => ({ entities: [], facts: [{ kind: "fact" } as FactRecord], limitations: [] }),
  };
  const { result, graphStore } = await runInput(
    baseInput(source, { operationCandidates: [parseOperation(source)] }),
    { factExtractor: malformed },
  );
  assert.equal(result.operationRecords[0]?.status, "failed");
  assert.deepEqual((await graphStore.exportTrace(source.id)).facts, []);
});

scenario("29. model-proposed fact cannot enter the graph", async () => {
  const source = snapshot({ suffix: "extract-model" });
  const owner = repositoryEntity(source, "model");
  const proposed = structuredClone(metadataFact(source, "model", { subject: owner }));
  (proposed.provenance as unknown as { method: string }).method = "model_proposed";
  const extractor: FactExtractorPort = {
    id: "unsafe.extractor",
    version: "1",
    supports: () => true,
    extract: async () => ({ entities: [owner], facts: [proposed as FactRecord], limitations: [] }),
  };
  const { graphStore } = await runInput(
    baseInput(source, { operationCandidates: [parseOperation(source)] }),
    { factExtractor: extractor },
  );
  assert.deepEqual((await graphStore.exportTrace(source.id)).facts, []);
});

scenario("30. raw source content never appears in result", async () => {
  const { result } = await groundedFixture();
  assert.equal(JSON.stringify(result).includes(sourceContent), false);
});

scenario("31. active fact-backed evidence is created", async () => {
  const { result } = await groundedFixture();
  assert.ok(result.evidence.some((record) => record.factIds.length > 0 && record.freshness.current));
});

scenario("32. source-span-only evidence is snapshot verified", async () => {
  const source = snapshot({ suffix: "range-evidence" });
  const { result } = await runInput(
    baseInput(source, {
      operationCandidates: [readOperation(source, { range: { startLine: 1, endLine: 1 } })],
      budget: budget({ maxPlannerRounds: 2 }),
    }),
  );
  const record = result.evidence.find((item) => item.factIds.length === 0);
  assert.equal(record?.sourceSpans[0]?.contentFingerprint, source.files[0]!.contentFingerprint);
});

scenario("33. evidence with unknown fact id is rejected", async () => {
  const source = snapshot({ suffix: "evidence-unknown-fact" });
  const unknown = evidenceRecord(source, null, "unknown-fact");
  unknown.factIds = [id<FactId>("fact-does-not-exist")];
  await assertRejects(
    () => runInput(baseInput(source, { evidence: [unknown] })),
    (error) => error instanceof InvestigationDomainError && error.code === "unknown_reference",
  );
});

scenario("34. invalidated fact is not grounded support", async () => {
  const source = snapshot({ suffix: "evidence-invalidated" });
  const owner = repositoryEntity(source, "invalidated");
  const fact = metadataFact(source, "invalidated", { subject: owner, status: "invalidated" });
  const evidence = evidenceRecord(source, fact, "invalidated");
  const finding = findingFor(source, owner, [evidence.id]);
  const { result } = await runInput(
    baseInput(source, {
      entities: [owner],
      facts: [fact],
      evidence: [evidence],
      findings: [finding],
      budget: budget({ maxPlannerRounds: 1 }),
    }),
  );
  assert.equal(result.findings[0]?.authorizationHint, "not_eligible");
});

scenario("35. search result remains context-only lead", async () => {
  const source = snapshot({ suffix: "search-lead" });
  const search = operation(source, {
    type: "search_text",
    query: "target",
    reason: "Search for a grounded textual lead.",
    questionIds: [],
    hypothesisIds: [],
    priority: 1,
    estimatedCost: {
      operations: 1,
      fileReads: 0,
      fileBytes: 0,
      parsedFiles: 0,
      relationshipHops: 0,
      plannerRounds: 0,
      wallTimeMs: 0,
    },
    safetyClassification: "safe",
  });
  const { result } = await runInput(
    baseInput(source, { operationCandidates: [search], budget: budget({ maxOperations: 1 }) }),
  );
  assert.ok(result.evidence.every((record) => record.role === "context_only" && record.strength === "lead"));
});

scenario("36. independence groups are deduplicated in coverage", async () => {
  const source = snapshot({ suffix: "evidence-groups" });
  const first = metadataFact(source, "groups-a");
  const second = metadataFact(source, "groups-b");
  const evidenceA = evidenceRecord(source, first, "groups-a", { group: "shared-group" });
  const evidenceB = evidenceRecord(source, second, "groups-b", { group: "shared-group" });
  const { result } = await runInput(
    baseInput(source, {
      entities: [first.subject, second.subject],
      facts: [first, second],
      evidence: [evidenceA, evidenceB],
      budget: budget({ maxPlannerRounds: 1 }),
    }),
  );
  assert.equal(result.coverage.evidenceIndependentGroups, 1);
});

scenario("37. context-only evidence cannot support a claim", async () => {
  const source = snapshot({ suffix: "evidence-context-only" });
  const ownerClaim = claim(source, "context-only");
  const ownerHypothesis = hypothesis(ownerClaim);
  const context = evidenceRecord(source, null, "context-only", { sourceSpanOnly: true, role: "context_only" });
  const { result } = await runInput(
    baseInput(source, {
      claims: [ownerClaim],
      hypotheses: [ownerHypothesis],
      evidence: [context],
      budget: budget({ maxPlannerRounds: 1 }),
    }),
  );
  assert.equal(result.hypotheses[0]?.status, "open");
});

scenario("38. stale evidence does not retain support", async () => {
  const source = snapshot({ suffix: "evidence-stale" });
  const owner = repositoryEntity(source, "stale");
  const fact = metadataFact(source, "stale", { subject: owner });
  const ownerClaim = claim(source, "stale");
  const stale = evidenceRecord(source, fact, "stale", { claimId: ownerClaim.id, current: false });
  ownerClaim.supportingEvidenceIds = [stale.id];
  ownerClaim.derivation.inputFactIds = [fact.id];
  const ownerHypothesis = hypothesis(ownerClaim);
  const { result } = await runInput(
    baseInput(source, {
      claims: [ownerClaim],
      hypotheses: [ownerHypothesis],
      entities: [owner],
      facts: [fact],
      evidence: [stale],
      budget: budget({ maxPlannerRounds: 1 }),
    }),
  );
  assert.notEqual(result.hypotheses[0]?.status, "supported");
});

scenario("39. claim evaluation is applied to its hypothesis", async () => {
  const { result } = await groundedFixture();
  assert.equal(result.claims[0]?.status, "supported");
  assert.ok(result.hypotheses[0]?.supportingEvidenceIds.length);
});

scenario("40. open hypothesis transitions to supported", async () => {
  const { result } = await groundedFixture();
  assert.equal(result.hypotheses[0]?.status, "supported");
  assert.equal(result.hypotheses[0]?.history.at(-1)?.to, "supported");
});

scenario("41. supported hypothesis reopens on material contradiction", async () => {
  const { result } = await runInput(contradictoryInput());
  assert.equal(result.hypotheses[0]?.status, "open");
  assert.ok(result.hypotheses[0]?.contradictingEvidenceIds.length);
});

scenario("42. competing hypotheses remain explicit", async () => {
  const source = snapshot({ suffix: "hypothesis-competing" });
  const firstClaim = claim(source, "competing-a");
  const secondClaim = claim(source, "competing-b");
  const { result } = await runInput(
    baseInput(source, {
      claims: [secondClaim, firstClaim],
      hypotheses: [hypothesis(secondClaim), hypothesis(firstClaim)],
      budget: budget({ maxPlannerRounds: 1 }),
    }),
  );
  assert.equal(result.hypotheses.length, 2);
  assert.ok(result.hypotheses.every((item) => item.status === "open"));
});

scenario("43. deterministic detector output is accepted by registry", async () => {
  const { result } = await runInput(contradictoryInput());
  assert.ok(result.contradictions.some((record) => record.type === "mutually_exclusive_claims"));
});

scenario("44. blocking contradiction controls canonical stop", async () => {
  const { result } = await runInput(contradictoryInput());
  assert.equal(result.stop.reason, "contradictory_evidence");
});

scenario("45. unreadable source creates a gap rather than internal error", async () => {
  const source = snapshot({ suffix: "gap-unreadable" });
  const adapter = adapterFor(source);
  adapter.setReadFailure(source.files[0]!.id, "unreadable");
  const { result } = await runInput(
    baseInput(source, { operationCandidates: [readOperation(source)], budget: budget({ maxPlannerRounds: 2 }) }),
    { adapter },
  );
  assert.ok(result.knowledgeGaps.some((gap) => gap.category === "unreadable_source"));
  assert.notEqual(result.stop.reason, "internal_error");
});

scenario("46. truncated critical scope creates a blocking gap", async () => {
  const source = snapshot({ suffix: "gap-truncated", truncated: true });
  const critical = openQuestion("truncated", "critical");
  const { result } = await runInput(baseInput(source, { questions: [critical] }));
  assert.equal(result.stop.reason, "repository_snapshot_truncated");
  assert.ok(result.knowledgeGaps.some((gap) => gap.category === "snapshot_truncated"));
});

scenario("47. resolved gap operation is not planned again", () => {
  const source = snapshot({ suffix: "gap-resolved" });
  const candidate = searchOperation(source);
  const gap: KnowledgeGap = {
    id: id<KnowledgeGapId>("gap-resolved"),
    snapshotId: source.id,
    category: "missing_owner",
    question: "Which repository entity is the owner?",
    blocks: ["finding"],
    relatedEntityIds: [],
    relatedHypothesisIds: [],
    suggestedOperations: [{ type: "search_paths", reason: "Search paths.", questionIds: [], hypothesisIds: [] }],
    status: "resolved",
  };
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, { operationCandidates: [candidate], knowledgeGaps: [gap] }),
  );
  assert.equal(plan.productive, false);
});

scenario("48. failed ingestion leaves graph and state atomic", async () => {
  const source = snapshot({ suffix: "atomic-ingestion" });
  const malformed: FactExtractorPort = {
    id: "atomic.extractor",
    version: "1",
    supports: () => true,
    extract: async () => ({ entities: [], facts: [{ id: "fact-malformed" } as FactRecord], limitations: [] }),
  };
  const { result, graphStore } = await runInput(
    baseInput(source, { operationCandidates: [parseOperation(source)] }),
    { factExtractor: malformed },
  );
  assert.deepEqual(result.facts, []);
  assert.deepEqual((await graphStore.exportTrace(source.id)).facts, []);
});

scenario("49. sufficient evidence stops before first operation", async () => {
  const input = sufficientInput();
  input.operationCandidates = [readOperation(input.snapshot)];
  const { result, adapter } = await runInput(input);
  assert.equal(result.stop.reason, "sufficient_evidence");
  assert.equal(adapter.callCounts.readFile, 0);
});

scenario("50. one operation round reaches sufficient evidence", async () => {
  const { result } = await groundedFixture();
  assert.equal(result.stop.reason, "sufficient_evidence");
  assert.equal(result.findings[0]?.authorizationHint, "eligible");
});

scenario("51. multiple rounds resolve search read and parse", async () => {
  const { result, adapter } = await groundedFixture({ viaSearch: true });
  assert.equal(result.stop.reason, "sufficient_evidence");
  assert.ok(adapter.callCounts.searchPaths >= 1);
  assert.equal(adapter.callCounts.readFile, 1);
  assert.ok(result.coverage.filesParsed >= 1);
});

scenario("52. duplicate-only plan reports no productive operation", () => {
  const source = snapshot({ suffix: "loop-duplicate-only" });
  const candidate = searchOperation(source);
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, {
      operationCandidates: [candidate],
      operationRecords: [{
        operation: candidate,
        status: "completed",
        producedEntityIds: [],
        producedFactIds: [],
        producedEvidenceIds: [],
      }],
    }),
  );
  assert.equal(plan.productive, false);
});

scenario("53. hard budget exhaustion uses canonical stop", async () => {
  const source = snapshot({ suffix: "loop-budget" });
  const { result } = await runInput(
    baseInput(source, { budget: budget({ maxOperations: 0 }) }),
  );
  assert.equal(result.stop.reason, "operation_budget_exhausted");
});

scenario("54. repository change has canonical priority", async () => {
  const source = snapshot({ suffix: "loop-repository-change" });
  const adapter = adapterFor(source);
  adapter.setCurrentFingerprint(source.files[0]!.id, "changed-fingerprint");
  const { result } = await runInput(
    baseInput(source, { operationCandidates: [readOperation(source)], budget: budget({ maxOperations: 1 }) }),
    { adapter },
  );
  assert.equal(result.stop.reason, "repository_changed");
});

scenario("55. safety block has canonical priority", async () => {
  const source = snapshot({ suffix: "loop-safety", secretRisk: "known" });
  const blocked = readOperation(source, { safety: "blocked" });
  const { result, adapter } = await runInput(
    baseInput(source, { operationCandidates: [blocked] }),
  );
  assert.equal(result.stop.reason, "safety_blocked");
  assert.equal(adapter.callCounts.readFile, 0);
});

scenario("56. clarification-required gap is preserved", async () => {
  const source = snapshot({ suffix: "loop-clarification" });
  const gap: KnowledgeGap = {
    id: id<KnowledgeGapId>("gap-clarification"),
    snapshotId: source.id,
    category: "ambiguous_user_intent",
    question: "Should the externally defined behavior preserve or replace the existing variant?",
    blocks: ["authorization", "finding"],
    relatedEntityIds: [],
    relatedHypothesisIds: [],
    suggestedOperations: [],
    status: "open",
  };
  const { result } = await runInput(baseInput(source, { knowledgeGaps: [gap] }));
  assert.equal(result.stop.reason, "clarification_required");
});

scenario("57. unresolved contradiction stop is preserved", async () => {
  const { result } = await runInput(contradictoryInput());
  assert.equal(result.stop.reason, "contradictory_evidence");
});

scenario("58. final sufficient evidence beats simultaneous operation exhaustion", async () => {
  const { result } = await groundedFixture({ budget: budget({ maxOperations: 1 }) });
  assert.equal(result.budgetState.exhausted.includes("operations"), true);
  assert.equal(result.stop.reason, "sufficient_evidence");
});

scenario("59. malformed runner state cannot become canonical success", async () => {
  const input = sufficientInput(snapshot({ suffix: "loop-malformed" }));
  (input.questions as unknown) = "not-an-array";
  await assertRejects(
    () => runInput(input),
    (error) => error instanceof InvestigationRunnerError && error.code === "invalid_input",
  );
});

scenario("60. runner output is deterministic under duplicate input permutation", async () => {
  const source = snapshot({ suffix: "loop-permutation" });
  const input = sufficientInput(source);
  input.entities = [input.entities[0]!, structuredClone(input.entities[0]!)];
  input.facts = [input.facts[0]!, structuredClone(input.facts[0]!)];
  input.evidence = [input.evidence[0]!, structuredClone(input.evidence[0]!)];
  const left = await runInput(input);
  const rightInput = structuredClone(input);
  rightInput.entities = [...rightInput.entities].reverse();
  rightInput.facts = [...rightInput.facts].reverse();
  rightInput.evidence = [...rightInput.evidence].reverse();
  const right = await runInput(rightInput);
  assert.deepEqual(right.result, left.result);
});

scenario("61. trace ordering is stable", async () => {
  const left = await groundedFixture({ viaSearch: true });
  const right = await groundedFixture({ viaSearch: true });
  assert.deepEqual(right.result.trace, left.result.trace);
});

scenario("62. trace contains no raw source", async () => {
  const { result } = await groundedFixture({ viaSearch: true });
  assert.equal(JSON.stringify(result.trace).includes(sourceContent), false);
});

scenario("63. trace contains planner operation and stop events", async () => {
  const { result } = await groundedFixture();
  const types = new Set(result.trace.map((event) => event.type));
  assert.ok(types.has("plan_created"));
  assert.ok(types.has("operation_selected"));
  assert.ok(types.has("operation_completed"));
  assert.ok(result.trace.some((event) => event.type === "stop_checked" && event.decision === "stop"));
});

scenario("64. final result is an immutable defensive snapshot", async () => {
  const { result } = await groundedFixture();
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.facts), true);
  assert.throws(() => result.facts.push(result.facts[0]!));
});

scenario("65. result is JSON-safe and exposes no mutable infrastructure", async () => {
  const { result } = await groundedFixture();
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length > 0);
  assert.equal(serialized.includes("[object Map]"), false);
  assert.equal(Object.values(result).some((value) => typeof value === "function"), false);
});

scenario("66. unsafe identifiers do not leak through typed errors", async () => {
  const rawSecret = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
  const input = baseInput(snapshot({ suffix: "error-secret-id" }));
  input.investigationId = rawSecret as InvestigationId;
  await assertRejects(
    () => runInput(input),
    (error) =>
      error instanceof InvestigationRunnerError &&
      error.code === "invalid_input" &&
      !error.message.includes(rawSecret) &&
      error.recordId === undefined,
  );
});

scenario("67. accessors in runner input are never executed", async () => {
  const source = snapshot({ suffix: "input-getter" });
  const input = baseInput(source);
  let getterCalls = 0;
  Object.defineProperty(input, "questions", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("sk-proj-do-not-execute-this-secret");
    },
  });
  await assertRejects(
    () => runInput(input),
    (error) => error instanceof InvestigationRunnerError && error.code === "invalid_input",
  );
  assert.equal(getterCalls, 0);
});

scenario("68. identical runs are semantically equivalent", async () => {
  const first = await groundedFixture();
  const second = await groundedFixture();
  assert.deepEqual(second.result, first.result);
});

scenario("69. interpreter seeds a verified explicit path without inventing another path", () => {
  const source = snapshot({ suffix: "seed-explicit-path" });
  const request = requestFor(source, {
    task: "verify target",
    explicitTargets: [{ kind: "path", path: source.files[0]!.normalizedPath }],
  });
  const seed = createDeterministicInvestigationInterpreter().interpret(request);
  assert.ok(seed.questions.some((question) => question.priority === "critical"));
  assert.ok(seed.operationCandidates.some(
    (candidate) => candidate.type === "read_file" && candidate.path === source.files[0]!.normalizedPath,
  ));
  assert.equal(seed.operationCandidates.some(
    (candidate) => "path" in candidate && candidate.path !== source.files[0]!.normalizedPath,
  ), false);
});

scenario("70. interpreter keeps an unknown explicit path unresolved", () => {
  const source = snapshot({ suffix: "seed-unknown-path" });
  const seed = createDeterministicInvestigationInterpreter().interpret(
    requestFor(source, {
      task: "verify missing target",
      explicitTargets: [{ kind: "path", path: "src/missing.ts" }],
    }),
  );
  assert.equal(seed.operationCandidates.some((candidate) => candidate.type === "read_file"), false);
  assert.ok(seed.knowledgeGaps.some(
    (gap) => gap.status === "open" && gap.category === "missing_owner",
  ));
});

scenario("71. interpreter grounds an explicit symbol search", () => {
  const source = snapshot({ suffix: "seed-symbol" });
  const seed = createDeterministicInvestigationInterpreter().interpret(
    requestFor(source, {
      task: "verify symbol",
      explicitTargets: [{ kind: "symbol", symbol: "handleRequest" }],
    }),
  );
  assert.ok(seed.operationCandidates.some(
    (candidate) => candidate.type === "search_symbols" && candidate.query === "handleRequest",
  ));
});

scenario("72. general implementation seed is deterministic and has a critical question", () => {
  const source = snapshot({ suffix: "seed-general" });
  const request = requestFor(source, { task: "change behavior" });
  const interpreter = createDeterministicInvestigationInterpreter();
  const first = interpreter.interpret(request);
  const second = interpreter.interpret(structuredClone(request));
  assert.deepEqual(second, first);
  assert.ok(first.questions.some((question) => question.priority === "critical"));
});

scenario("73. planner synthesizes explicit path verification without caller candidates", () => {
  const source = snapshot({ suffix: "planner-explicit-derived" });
  const question = openQuestion("explicit-derived", "critical");
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, {
      questions: [question],
      explicitTargets: [{ kind: "path", path: source.files[0]!.normalizedPath }],
      operationCandidates: [],
    }),
  );
  assert.ok(plan.operations.some(
    (candidate) => candidate.type === "read_file" && candidate.path === source.files[0]!.normalizedPath,
  ));
  assert.ok(plan.synthesizedOperationSources.some((entry) => entry.source === "explicit_path"));
});

scenario("74. planner derives bounded relationship expansion from an active exact fact", () => {
  const source = snapshot({ suffix: "planner-graph-fact" });
  const owner = repositoryEntity(source, "graph-owner");
  const target = repositoryEntity(source, "graph-target");
  const relation: FactRecord = {
    kind: "relation",
    id: id<FactId>("fact-planner-relation"),
    snapshotId: source.id,
    subject: owner,
    predicate: "calls",
    object: target,
    source: {
      kind: "repository_metadata",
      snapshotId: source.id,
      reference: "fixture-relation",
      fingerprint: "fixture-relation-fingerprint",
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
  const plan = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, { entities: [owner, target], facts: [relation] }),
  );
  assert.ok(plan.operations.some(
    (candidate) => candidate.type === "follow_relationship" && candidate.fromEntityId === owner.id,
  ));
});

scenario("75. one execution key merges multiple question and hypothesis purposes", () => {
  const source = snapshot({ suffix: "purpose-merge" });
  const first = parseOperation(source, {
    questions: [id<QuestionId>("question-a")],
    hypotheses: [id<HypothesisId>("hypothesis-a")],
  });
  const second = {
    ...structuredClone(first),
    reason: "Serve another grounded purpose.",
    questionIds: [id<QuestionId>("question-b")],
    hypothesisIds: [id<HypothesisId>("hypothesis-b")],
  };
  const queue = createDeterministicOperationQueue();
  queue.enqueue([first, second]);
  const merged = queue.dequeue();
  assert.deepEqual(merged?.questionIds, ["question-a", "question-b"]);
  assert.deepEqual(merged?.hypothesisIds, ["hypothesis-a", "hypothesis-b"]);
  assert.equal(queue.dequeue(), null);
});

scenario("76. zero-cost forged read cannot bypass file budgets or invoke the reader", async () => {
  const source = snapshot({ suffix: "canonical-zero-read" });
  const forged = readOperation(source);
  forged.estimatedCost = { ...forged.estimatedCost, operations: 0, fileReads: 0, fileBytes: 0 };
  const { adapter, result } = await runInput(baseInput(source, {
    operationCandidates: [forged],
    budget: budget({ maxFileReads: 0, maxFileBytes: 0 }),
  }));
  assert.equal(adapter.callCounts.readFile, 0);
  assert.ok(result.budgetState.exhausted.includes("file_reads"));
});

scenario("77. underestimated parse cost is rejected before repository execution", async () => {
  const source = snapshot({ suffix: "canonical-parse" });
  const forged = parseOperation(source);
  forged.estimatedCost = { ...forged.estimatedCost, fileReads: 0, fileBytes: 0, parsedFiles: 0 };
  const { adapter } = await runInput(baseInput(source, {
    operationCandidates: [forged],
    budget: budget({ maxFileReads: 0, maxFileBytes: 0, maxParsedFiles: 0 }),
  }));
  assert.equal(adapter.callCounts.readFile, 0);
});

scenario("78. actual operation cost stays within the canonical reservation", async () => {
  const source = snapshot({ suffix: "canonical-actual" });
  const { result } = await runInput(baseInput(source, {
    operationCandidates: [readOperation(source)],
    budget: budget({ maxOperations: 1 }),
  }));
  const record = result.operationRecords.find((candidate) => candidate.status === "completed");
  assert.ok(record?.actualCost);
  for (const field of Object.keys(record.actualCost) as Array<keyof typeof record.actualCost>) {
    assert.ok(record.actualCost[field] <= record.operation.estimatedCost[field]);
  }
});

scenario("79. non-retryable failed operation is not executed again", async () => {
  const source = snapshot({ suffix: "retry-denied" });
  const adapter = adapterFor(source);
  adapter.setReadFailure(source.files[0]!.id, "unreadable", false);
  const { adapter: used } = await runInput(baseInput(source, {
    operationCandidates: [readOperation(source)],
    plannerPolicy: { maxOperationsPerRound: 1, searchResultLimit: 10, maxFailedOperationRetries: 3 },
  }), { adapter });
  assert.equal(used.callCounts.readFile, 1);
});

scenario("80. retryable failed operation retries only inside policy", async () => {
  const source = snapshot({ suffix: "retry-allowed" });
  const adapter = adapterFor(source);
  adapter.setReadFailureSequence(source.files[0]!.id, [
    { reason: "unreadable", retryable: true },
  ]);
  const { adapter: used, result } = await runInput(baseInput(source, {
    operationCandidates: [readOperation(source)],
    plannerPolicy: { maxOperationsPerRound: 1, searchResultLimit: 10, maxFailedOperationRetries: 1 },
  }), { adapter });
  assert.equal(used.callCounts.readFile, 2);
  assert.equal(result.operationRecords.filter((record) => record.operation.type === "read_file").length, 2);
});

scenario("81. atomic graph batch rejects entity plus invalid fact without partial mutation", async () => {
  const source = snapshot({ suffix: "atomic-batch" });
  const store = createInMemoryKnowledgeGraphStore();
  await store.beginSnapshot(source);
  const owner = repositoryEntity(source, "atomic-owner");
  const target = repositoryEntity(source, "atomic-target");
  const invalidRelation: FactRecord = {
    kind: "relation",
    id: id<FactId>("fact-atomic-invalid"),
    snapshotId: source.id,
    subject: owner,
    predicate: "calls",
    object: target,
    source: {
      kind: "repository_metadata",
      snapshotId: source.id,
      reference: "atomic-fixture",
      fingerprint: "atomic-fixture-fingerprint",
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
  await assert.rejects(() => store.putBatch({
    snapshotId: source.id,
    entities: [owner],
    facts: [invalidRelation],
  }));
  assert.deepEqual(await store.exportTrace(source.id), {
    snapshotId: source.id,
    entities: [],
    facts: [],
  });
});

scenario("82. cancellation after extraction and before graph commit leaves graph unchanged", async () => {
  const source = snapshot({ suffix: "atomic-cancel" });
  const clock = new ManualClock();
  const cancellation = new CancellationState();
  const delegate = extractors(clock);
  const cancellingExtractor: FactExtractorPort = {
    id: "fixture.cancelling-extractor",
    version: "1.0.0",
    supports: (input) => delegate.supports(input),
    async extract(input) {
      const result = await delegate.extract(input);
      cancellation.cancelled = true;
      return result;
    },
  };
  const graphStore = createInMemoryKnowledgeGraphStore();
  const harness = createRunnerHarness(source, { clock, cancellation, factExtractor: cancellingExtractor, graphStore });
  await assertRejects(
    () => harness.runner.run(baseInput(source, { operationCandidates: [parseOperation(source)] })),
    (error) => error instanceof InvestigationRunnerError && error.code === "cancelled",
  );
  assert.deepEqual((await graphStore.exportTrace(source.id)).facts, []);
});

scenario("83. context-only search lead does not close a missing-owner gap", async () => {
  const source = snapshot({ suffix: "lead-gap" });
  const question = openQuestion("lead-gap", "critical");
  const gap: KnowledgeGap = {
    id: id<KnowledgeGapId>("gap-lead-owner"),
    snapshotId: source.id,
    category: "missing_owner",
    question: question.text,
    blocks: ["authorization", "finding", "projection"],
    relatedEntityIds: [],
    relatedHypothesisIds: [],
    suggestedOperations: [{
      type: "search_text",
      reason: "Search a grounded token.",
      questionIds: [question.id],
      hypothesisIds: [],
    }],
    status: "open",
  };
  const candidate = operation(source, {
    type: "search_text",
    query: "target",
    reason: "Search a grounded token.",
    questionIds: [question.id],
    hypothesisIds: [],
    priority: 10,
    estimatedCost: { operations: 1, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 0, plannerRounds: 0, wallTimeMs: 0 },
    safetyClassification: "safe",
  });
  const { result } = await runInput(baseInput(source, {
    questions: [question],
    knowledgeGaps: [gap],
    operationCandidates: [candidate],
    budget: budget({ maxOperations: 1 }),
  }));
  assert.equal(result.knowledgeGaps.find((item) => item.id === gap.id)?.status, "open");
});

scenario("84. unrelated parsed fact does not close a blocking gap", async () => {
  const source = snapshot({ suffix: "unrelated-gap" });
  const related = repositoryEntity(source, "related");
  const unrelated = repositoryEntity(source, "unrelated");
  const fact = metadataFact(source, "unrelated-gap", { subject: unrelated, predicate: "calls" });
  const evidence = evidenceRecord(source, fact, "unrelated-gap");
  const gap: KnowledgeGap = {
    id: id<KnowledgeGapId>("gap-unrelated-owner"),
    snapshotId: source.id,
    category: "missing_owner",
    question: "Which related entity is the implementation owner?",
    blocks: ["authorization", "finding"],
    relatedEntityIds: [related.id],
    relatedHypothesisIds: [],
    suggestedOperations: [],
    status: "open",
  };
  const { result } = await runInput(baseInput(source, {
    entities: [related, unrelated],
    facts: [fact],
    evidence: [evidence],
    knowledgeGaps: [gap],
  }));
  assert.equal(result.knowledgeGaps.find((item) => item.id === gap.id)?.status, "open");
});

scenario("85. same physical parse serves two hypotheses with one execution", async () => {
  const source = snapshot({ suffix: "shared-parse" });
  const firstClaim = claim(source, "shared-a");
  const secondClaim = claim(source, "shared-b");
  const firstHypothesis = hypothesis(firstClaim);
  const secondHypothesis = hypothesis(secondClaim);
  const first = parseOperation(source, { hypotheses: [firstHypothesis.id] });
  const second = {
    ...structuredClone(first),
    reason: "Serve the second grounded hypothesis.",
    hypothesisIds: [secondHypothesis.id],
  };
  const { result, adapter } = await runInput(baseInput(source, {
    claims: [firstClaim, secondClaim],
    hypotheses: [firstHypothesis, secondHypothesis],
    operationCandidates: [first, second],
  }));
  assert.equal(adapter.callCounts.readFile, 1);
  const parsed = result.operationRecords.find(
    (record) => record.status === "completed" && record.operation.type === "parse_file",
  );
  assert.deepEqual(parsed?.operation.hypothesisIds, [firstHypothesis.id, secondHypothesis.id].sort());
  assert.ok(result.evidence.some((record) => record.claimId === firstClaim.id));
  assert.ok(result.evidence.some((record) => record.claimId === secondClaim.id));
});

scenario("86. complete bounded absence creates a safe unresolved gap", async () => {
  const source = snapshot({ suffix: "bounded-absence-complete" });
  const absence = operation(source, {
    type: "evaluate_absence",
    query: "missingImplementationToken",
    scopes: ["src"],
    reason: "Evaluate absence in a grounded complete scope.",
    questionIds: [],
    hypothesisIds: [],
    priority: 10,
    estimatedCost: { operations: 1, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 0, plannerRounds: 0, wallTimeMs: 0 },
    safetyClassification: "safe",
  });
  const { result } = await runInput(baseInput(source, { operationCandidates: [absence] }));
  assert.ok(result.knowledgeGaps.some(
    (gap) => gap.category === "missing_behavior" && gap.status === "open",
  ));
  assert.notEqual(result.stop.reason, "sufficient_evidence");
});

scenario("87. truncated snapshot never confirms bounded absence", async () => {
  const source = snapshot({ suffix: "bounded-absence-truncated", truncated: true });
  const question = openQuestion("bounded-truncated", "critical");
  const absence = operation(source, {
    type: "evaluate_absence",
    query: "missingImplementationToken",
    scopes: ["src"],
    reason: "Evaluate absence in a bounded scope.",
    questionIds: [question.id],
    hypothesisIds: [],
    priority: 10,
    estimatedCost: { operations: 1, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 0, plannerRounds: 0, wallTimeMs: 0 },
    safetyClassification: "safe",
  });
  const { result } = await runInput(baseInput(source, {
    questions: [question],
    operationCandidates: [absence],
  }));
  assert.ok(result.knowledgeGaps.some(
    (gap) => gap.category === "snapshot_truncated" && gap.status === "open",
  ));
  assert.equal(result.evidence.some((record) => record.summary.includes("absence")), false);
});

scenario("88. roadmap exact import owner reaches sufficient evidence from an open request", async () => {
  const fixture = exactImportOwnerFixture("roadmap-import-owner");
  const { result } = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "items",
  });
  assert.equal(result.stop.reason, "sufficient_evidence");
  assert.ok(result.questions.some(
    (question) => question.priority === "critical" && question.status === "answered",
  ));
  const ownerFinding = result.findings.find(
    (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
  );
  assert.ok(ownerFinding);
  const ownerEntity = result.entities.find((entity) => ownerFinding.entityIds.includes(entity.id));
  assert.equal(ownerEntity?.fileId, fixture.snapshot.files.find((file) => file.normalizedPath === "src/service.ts")?.id);
  assert.ok(result.operationRecords.some((record) => record.operation.type === "follow_relationship"));
});

scenario("89. roadmap re-export chain performs two bounded relationship hops", async () => {
  const fixture = reExportOwnerFixture("roadmap-reexport");
  const { result } = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "items",
  });
  const follows = result.operationRecords.filter(
    (record) => record.status === "completed" && record.operation.type === "follow_relationship",
  );
  assert.ok(follows.some((record) =>
    record.operation.type === "follow_relationship" && record.operation.predicates.includes("imports"),
  ));
  assert.ok(follows.some((record) =>
    record.operation.type === "follow_relationship" && record.operation.predicates.includes("re_exports"),
  ));
  assert.equal(result.stop.reason, "sufficient_evidence");
});

scenario("90. roadmap competing owners remain explicit without distinguishing call evidence", async () => {
  const fixture = repositoryFixture("roadmap-competing", [
    {
      path: "src/routes.ts",
      content: [
        'import { firstHandler } from "./first";',
        'import { secondHandler } from "./second";',
        'router.get("/items", firstHandler);',
      ].join("\n"),
    },
    { path: "src/first.ts", content: "export function firstHandler() { return 1; }" },
    { path: "src/second.ts", content: "export function secondHandler() { return 2; }" },
  ]);
  const { result } = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "items",
  });
  assert.notEqual(result.stop.reason, "sufficient_evidence");
  assert.equal(
    result.findings.some(
      (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
    ),
    false,
  );
});

scenario("91. roadmap missing implementation remains safely unresolved", async () => {
  const fixture = repositoryFixture("roadmap-missing", [{
    path: "src/routes.ts",
    content: 'router.get("/items", missingHandler);',
  }]);
  const { result } = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "items",
  });
  assert.notEqual(result.stop.reason, "sufficient_evidence");
  assert.ok(result.knowledgeGaps.some(
    (gap) => gap.category === "missing_owner" && gap.status === "open",
  ));
  assert.equal(result.safeToProject, false);
});

scenario("92. roadmap contradictory configuration preserves a canonical contradiction stop", async () => {
  const input = contradictoryInput(snapshot({ suffix: "roadmap-configuration" }));
  input.claims[0]!.type = "configuration";
  const { result } = await runInput(input);
  assert.equal(result.stop.reason, "contradictory_evidence");
});

scenario("93. roadmap budget exhaustion is explicit", async () => {
  const source = snapshot({ suffix: "roadmap-budget" });
  const { result } = await runInput(baseInput(source, { budget: budget({ maxOperations: 0 }) }));
  assert.equal(result.stop.reason, "operation_budget_exhausted");
});

scenario("94. roadmap repository mutation stops before mixed-snapshot ingestion", async () => {
  const source = snapshot({ suffix: "roadmap-mutation" });
  const adapter = adapterFor(source);
  adapter.setCurrentFingerprint(source.files[0]!.id, "changed-fingerprint");
  const { result } = await runInput(baseInput(source, {
    operationCandidates: [readOperation(source)],
  }), { adapter });
  assert.equal(result.stop.reason, "repository_changed");
  assert.deepEqual(result.facts, []);
});

scenario("95. roadmap safety restriction never invokes the reader", async () => {
  const source = snapshot({ suffix: "roadmap-safety", secretRisk: "known" });
  const request = requestFor(source, {
    task: "verify target",
    explicitTargets: [{ kind: "path", path: source.files[0]!.normalizedPath }],
  });
  const { result, adapter } = await runInput(baseInput(source, { request }));
  assert.equal(result.stop.reason, "safety_blocked");
  assert.equal(adapter.callCounts.readFile, 0);
});

scenario("96. roadmap no grounded lead invents no repository target", async () => {
  const source = snapshot({ suffix: "roadmap-no-lead" });
  const request = requestFor(source, { task: "find owner" });
  const { result, adapter } = await runInput(baseInput(source, { request }));
  assert.equal(result.stop.reason, "no_grounded_lead");
  assert.equal(adapter.callCounts.searchText + adapter.callCounts.searchPaths + adapter.callCounts.searchSymbols, 0);
});

scenario("97. roadmap clarification required remains a canonical user-intent stop", async () => {
  const source = snapshot({ suffix: "roadmap-clarification" });
  const gap: KnowledgeGap = {
    id: id<KnowledgeGapId>("gap-roadmap-clarification"),
    snapshotId: source.id,
    category: "ambiguous_user_intent",
    question: "Should the externally defined variant be preserved or replaced?",
    blocks: ["authorization", "finding"],
    relatedEntityIds: [],
    relatedHypothesisIds: [],
    suggestedOperations: [],
    status: "open",
  };
  const { result } = await runInput(baseInput(source, { knowledgeGaps: [gap] }));
  assert.equal(result.stop.reason, "clarification_required");
});

scenario("98. end-to-end trace records seed planning question gap domain and atomic events", async () => {
  const fixture = exactImportOwnerFixture("trace-e2e");
  const { result } = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "items",
  });
  const types = new Set(result.trace.map((event) => event.type));
  for (const type of [
    "seed_interpreted",
    "planner_proposal_synthesized",
    "question_updated",
    "gap_evaluated",
    "domain_evaluated",
    "atomic_commit",
  ] as const) {
    assert.ok(types.has(type));
  }
  assert.equal(JSON.stringify(result.trace).includes('router.get("/items"'), false);
});

scenario("99. same structured fixture run is semantically deterministic", async () => {
  const fixture = exactImportOwnerFixture("deterministic-e2e");
  const first = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "items",
  });
  const second = await runStructuredRepositoryFixture({
    source: structuredClone(fixture.snapshot),
    adapterFiles: structuredClone(fixture.adapterFiles),
    task: "items",
  });
  assert.deepEqual(second.result, first.result);
});

scenario("100. plain matching function is not inferred as an implementation owner", async () => {
  const fixture = repositoryFixture("owner-plain-function", [{
    path: "src/candidate.ts",
    content: "export function candidate() { return 1; }",
  }]);
  const { result } = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "candidate",
  });
  assert.notEqual(result.stop.reason, "sufficient_evidence");
  assert.equal(
    result.findings.some(
      (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
    ),
    false,
  );
  assert.equal(
    result.questions.some(
      (question) => question.category === "owner" && question.status === "answered",
    ),
    false,
  );
});

scenario("101. bare contains fact is ineligible for an owner claim", async () => {
  const source = snapshot({
    suffix: "owner-bare-contains",
    content: "export function candidate() { return 1; }",
  });
  const clock = new ManualClock();
  const extraction = await extractors(clock).extract({
    snapshotId: source.id,
    fileId: source.files[0]!.id,
    path: source.files[0]!.normalizedPath,
    content: "export function candidate() { return 1; }",
    contentFingerprint: source.files[0]!.contentFingerprint,
    language: source.files[0]!.language,
  });
  const contains = extraction.facts.find((fact) => fact.predicate === "contains")!;
  const ownerClaim = claim(source, "bare-contains");
  const ownerHypothesis = hypothesis(ownerClaim);
  const parse = parseOperation(source, { hypotheses: [ownerHypothesis.id] });
  const decision = evaluateFactClaimEligibility({
    fact: contains,
    claim: ownerClaim,
    hypothesis: ownerHypothesis,
    operation: parse,
    operationRecords: [],
    facts: [contains],
    snapshot: source,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "owner_proof_missing");
});

scenario("102. unrelated import and call facts do not support an owner claim", async () => {
  const content = [
    'import { helper } from "./helper";',
    "export function candidate() { return helper(); }",
  ].join("\n");
  const source = snapshot({ suffix: "owner-unrelated-relations", content });
  const clock = new ManualClock();
  const extraction = await extractors(clock).extract({
    snapshotId: source.id,
    fileId: source.files[0]!.id,
    path: source.files[0]!.normalizedPath,
    content,
    contentFingerprint: source.files[0]!.contentFingerprint,
    language: source.files[0]!.language,
  });
  const ownerClaim = claim(source, "unrelated-relations");
  const ownerHypothesis = hypothesis(ownerClaim);
  const parse = parseOperation(source, { hypotheses: [ownerHypothesis.id] });
  assert.equal(
    extraction.facts.some((fact) =>
      evaluateFactClaimEligibility({
        fact,
        claim: ownerClaim,
        hypothesis: ownerHypothesis,
        operation: parse,
        operationRecords: [],
        facts: extraction.facts,
        snapshot: source,
      }).eligible,
    ),
    false,
  );
});

scenario("103. explicit path proves only an entity defined in the exact target", async () => {
  const fixture = repositoryFixture("owner-explicit-path", [
    { path: "src/allowed.ts", content: "export function selected() { return 1; }" },
    { path: "src/sibling.ts", content: "export function sibling() { return 2; }" },
  ]);
  const target = fixture.snapshot.files.find((file) => file.normalizedPath === "src/allowed.ts")!;
  const { result } = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "verify explicit target",
    explicitTargets: [{ kind: "path", path: target.normalizedPath }],
  });
  const confirmed = result.findings.filter(
    (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
  );
  assert.ok(confirmed.length > 0);
  assert.ok(confirmed.every((finding) =>
    finding.entityIds.every((entityId) =>
      result.entities.find((entity) => entity.id === entityId)?.fileId === target.id,
    ),
  ));
});

scenario("104. implementation target does not answer a behavior question", () => {
  const source = sufficientInput();
  const finding = source.findings[0]!;
  const question: InvestigationQuestion = {
    ...openQuestion("compatibility-behavior", "critical"),
    category: "behavior",
    answerFindingIds: [finding.id],
  };
  const evaluated = evaluateInvestigationQuestions({
    snapshotId: source.snapshot.id,
    questions: [question],
    claims: [],
    facts: source.facts,
    evidence: source.evidence,
    findings: source.findings,
    findingEvaluations: [{ finding, eligible: true, safeToProject: true, limitations: [] }],
    knowledgeGaps: [],
    operationRecords: [],
  });
  assert.equal(evaluated.questions[0]?.status, "open");
});

scenario("105. implementation target does not answer a risk question", () => {
  const source = sufficientInput();
  const finding = source.findings[0]!;
  const question: InvestigationQuestion = {
    ...openQuestion("compatibility-risk", "critical"),
    category: "risk",
    answerFindingIds: [finding.id],
  };
  const evaluated = evaluateInvestigationQuestions({
    snapshotId: source.snapshot.id,
    questions: [question],
    claims: [],
    facts: source.facts,
    evidence: source.evidence,
    findings: source.findings,
    findingEvaluations: [{ finding, eligible: true, safeToProject: true, limitations: [] }],
    knowledgeGaps: [],
    operationRecords: [],
  });
  assert.equal(evaluated.questions[0]?.status, "open");
});

scenario("106. behavior summary answers a compatible behavior question", () => {
  const source = sufficientInput();
  const finding: Finding = { ...source.findings[0]!, type: "behavior_summary" };
  const question: InvestigationQuestion = {
    ...openQuestion("compatibility-summary", "critical"),
    category: "behavior",
    answerFindingIds: [finding.id],
  };
  const evaluated = evaluateInvestigationQuestions({
    snapshotId: source.snapshot.id,
    questions: [question],
    claims: [],
    facts: source.facts,
    evidence: source.evidence,
    findings: [finding],
    findingEvaluations: [{ finding, eligible: true, safeToProject: true, limitations: [] }],
    knowledgeGaps: [],
    operationRecords: [],
  });
  assert.equal(evaluated.questions[0]?.status, "answered");
});

scenario("107. wildcard negative path blocks search lead read and parse", async () => {
  const fixture = repositoryFixture("negative-wildcard", [{
    path: "src/private/hidden.ts",
    content: "export function hiddenNeedle() { return 1; }",
  }]);
  const { result, adapter } = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "hiddenNeedle",
    negativeConstraints: [{ kind: "path", pattern: "src\\private\\*" }],
  });
  assert.equal(adapter.callCounts.readFile, 0);
  assert.equal(
    result.operationRecords.some(
      (record) =>
        (record.operation.type === "read_file" || record.operation.type === "parse_file") &&
        record.operation.path === "src/private/hidden.ts",
    ),
    false,
  );
});

scenario("108. exact negative path blocks caller-seeded read at execution boundary", async () => {
  const source = snapshot({ suffix: "negative-exact", path: "src/private.ts" });
  const candidate = readOperation(source);
  const request = requestFor(source, {
    task: "private",
    negativeConstraints: [{ kind: "path", pattern: "src/private.ts" }],
  });
  const planner: DeterministicInvestigationPlanner = {
    proposeNextOperations: (state) => ({
      rationale: "Exercise the execution-boundary negative constraint preflight.",
      operations: state.operationRecords.length === 0 ? [candidate] : [],
      skippedDuplicateOperationIds: [],
      consideredQuestionIds: [],
      consideredHypothesisIds: [],
      consideredKnowledgeGapIds: [],
      synthesizedOperationSources: state.operationRecords.length === 0
        ? [{ operationId: candidate.id, source: "caller_seed" }]
        : [],
      productive: state.operationRecords.length === 0,
    }),
  };
  const { adapter } = await runInput(baseInput(source, {
    request,
    operationCandidates: [candidate],
  }), { planner });
  assert.equal(adapter.callCounts.readFile, 0);
});

scenario("109. excluded path is removed from derived operation candidates", () => {
  const source = snapshot({ suffix: "negative-planner", path: "src/private/value.ts" });
  const derived = createDeterministicInvestigationPlanner().proposeNextOperations(
    plannerState(source, {
      negativeConstraints: [{ kind: "path", pattern: "src/private/*" }],
      operationCandidates: [readOperation(source)],
    }),
  );
  assert.equal(derived.operations.length, 0);
});

scenario("110. allowed sibling search result remains readable", async () => {
  const fixture = repositoryFixture("negative-sibling", [
    { path: "src/private/hidden.ts", content: "export const sharedNeedle = 1;" },
    { path: "src/public/visible.ts", content: "export const sharedNeedle = 2;" },
  ]);
  const { result, adapter } = await runStructuredRepositoryFixture({
    source: fixture.snapshot,
    adapterFiles: fixture.adapterFiles,
    task: "sharedNeedle",
    negativeConstraints: [{ kind: "path", pattern: "src/private/*" }],
  });
  assert.ok(adapter.callCounts.readFile > 0);
  assert.equal(
    result.operationRecords.some(
      (record) =>
        record.operation.type === "read_file" &&
        record.operation.path === "src/private/hidden.ts",
    ),
    false,
  );
});

scenario("111. forged bytesRead is rejected and charged by actual UTF-8 bytes", async () => {
  const content = "x".repeat(10_035);
  const source = snapshot({ suffix: "read-forged-bytes", content });
  const adapter = adapterFor(source, content);
  const reader: RepositoryReaderPort = {
    readFile: async (request) => ({
      status: "success",
      snapshotId: request.snapshotId,
      fileId: request.fileId,
      path: request.path,
      content,
      contentFingerprint: source.files[0]!.contentFingerprint,
      bytesRead: 1,
      startLine: 1,
      endLine: 1,
    }),
    readRange: (request) => adapter.readRange(request),
  };
  const { result } = await runInput(
    baseInput(source, { operationCandidates: [readOperation(source)] }),
    { adapter, reader },
  );
  const record = result.operationRecords.find((candidate) => candidate.error?.code === "invalid_operation_result");
  assert.equal(record?.actualCost?.fileBytes, 10_035);
});

scenario("112. forged parse read never reaches the extractor", async () => {
  const content = "x".repeat(10_035);
  const source = snapshot({ suffix: "read-forged-extractor", content });
  const adapter = adapterFor(source, content);
  let extractCalls = 0;
  const factExtractor: FactExtractorPort = {
    id: "fixture.extractor",
    version: "1",
    supports: () => true,
    extract: async () => {
      extractCalls += 1;
      return { entities: [], facts: [], limitations: [] };
    },
  };
  const reader: RepositoryReaderPort = {
    readFile: async (request) => ({
      status: "success",
      snapshotId: request.snapshotId,
      fileId: request.fileId,
      path: request.path,
      content,
      contentFingerprint: source.files[0]!.contentFingerprint,
      bytesRead: 1,
      startLine: 1,
      endLine: 1,
    }),
    readRange: (request) => adapter.readRange(request),
  };
  await runInput(
    baseInput(source, { operationCandidates: [parseOperation(source)] }),
    { adapter, reader, factExtractor },
  );
  assert.equal(extractCalls, 0);
});

scenario("113. incorrect full-read endLine is rejected", async () => {
  const source = snapshot({ suffix: "read-end-line" });
  const adapter = adapterFor(source);
  const reader: RepositoryReaderPort = {
    readFile: async (request) => ({
      status: "success",
      snapshotId: request.snapshotId,
      fileId: request.fileId,
      path: request.path,
      content: sourceContent,
      contentFingerprint: source.files[0]!.contentFingerprint,
      bytesRead: source.files[0]!.sizeBytes,
      startLine: 1,
      endLine: 3,
    }),
    readRange: (request) => adapter.readRange(request),
  };
  const { result } = await runInput(
    baseInput(source, { operationCandidates: [readOperation(source)] }),
    { adapter, reader },
  );
  assert.ok(result.operationRecords.some((record) => record.error?.code === "invalid_operation_result"));
});

scenario("114. range result must preserve requested bounds", async () => {
  const source = snapshot({ suffix: "read-range-bounds" });
  const adapter = adapterFor(source);
  const reader: RepositoryReaderPort = {
    readFile: (request) => adapter.readFile(request),
    readRange: async (request) => ({
      status: "success",
      snapshotId: request.snapshotId,
      fileId: request.fileId,
      path: request.path,
      content: sourceContent.split("\n").slice(1, 3).join("\n"),
      contentFingerprint: source.files[0]!.contentFingerprint,
      bytesRead: new TextEncoder().encode(sourceContent.split("\n").slice(1, 3).join("\n")).byteLength,
      startLine: 1,
      endLine: 2,
    }),
  };
  const { result } = await runInput(
    baseInput(source, {
      operationCandidates: [readOperation(source, { range: { startLine: 2, endLine: 3 } })],
    }),
    { adapter, reader },
  );
  assert.ok(result.operationRecords.some((record) => record.error?.code === "invalid_operation_result"));
});

scenario("115. valid multibyte read accounts UTF-8 bytes instead of JavaScript length", async () => {
  const content = "🙂é";
  const source = snapshot({ suffix: "read-multibyte", content });
  const { result } = await runInput(
    baseInput(source, { operationCandidates: [readOperation(source)] }),
    { content },
  );
  const completed = result.operationRecords.find(
    (record) => record.status === "completed" && record.operation.type === "read_file",
  );
  assert.equal(completed?.actualCost?.fileBytes, new TextEncoder().encode(content).byteLength);
  assert.notEqual(completed?.actualCost?.fileBytes, content.length);
});

scenario("116. resolved gap removes derived blocking limitations but preserves intrinsic ones", () => {
  const input = sufficientInput(snapshot({ suffix: "limitations-resolved" }));
  const finding = { ...input.findings[0]!, limitations: ["caller_intrinsic"] };
  const openGap: KnowledgeGap = {
    id: id<KnowledgeGapId>("gap-limitations"),
    snapshotId: input.snapshot.id,
    category: "missing_owner",
    question: "Owner proof is required.",
    blocks: ["authorization", "finding", "projection"],
    relatedEntityIds: [],
    relatedHypothesisIds: [],
    suggestedOperations: [],
    status: "open",
  };
  const blocked = evaluateFindingEligibility({
    finding,
    snapshotId: input.snapshot.id,
    evidence: input.evidence,
    facts: input.facts,
    entities: input.entities,
    contradictions: [],
    knowledgeGaps: [openGap],
  });
  assert.ok(blocked.limitations.some((value) => value.startsWith("blocking_")));
  const eligible = evaluateFindingEligibility({
    finding: blocked.finding,
    snapshotId: input.snapshot.id,
    evidence: input.evidence,
    facts: input.facts,
    entities: input.entities,
    contradictions: [],
    knowledgeGaps: [{ ...openGap, status: "resolved" }],
  });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.safeToProject, true);
  assert.equal(eligible.limitations.some((value) => value.startsWith("blocking_")), false);
  assert.ok(eligible.limitations.includes("caller_intrinsic"));
  const reopened = evaluateFindingEligibility({
    finding: eligible.finding,
    snapshotId: input.snapshot.id,
    evidence: input.evidence,
    facts: input.facts,
    entities: input.entities,
    contradictions: [],
    knowledgeGaps: [openGap],
  });
  assert.ok(reopened.limitations.includes("blocking_authorization_gap"));
});

scenario("117. zero search results without completeness metadata do not prove absence", async () => {
  const source = snapshot({ suffix: "absence-unproven" });
  const absence = operation(source, {
    type: "evaluate_absence",
    query: "does-not-exist",
    scopes: ["src"],
    reason: "Evaluate only a caller-grounded bounded scope.",
    questionIds: [],
    hypothesisIds: [],
    priority: 10,
    estimatedCost: { ...ZERO_OPERATION_COST, operations: 1 },
    safetyClassification: "safe",
  });
  const { result } = await runInput(baseInput(source, { operationCandidates: [absence] }));
  assert.notEqual(result.stop.reason, "sufficient_evidence");
  assert.ok(result.knowledgeGaps.some(
    (gap) => gap.category === "missing_behavior" && gap.status === "open",
  ));
  assert.equal(result.evidence.some((record) => record.summary.includes("absence")), false);
});

scenario("118. unrelated same-hypothesis evidence cannot close unreadable source gap", () => {
  const source = snapshot({ suffix: "unreadable-source-specific" });
  const owner = repositoryEntity(source, "unreadable-alternative");
  const fact = metadataFact(source, "unreadable-alternative", { subject: owner });
  const ownerClaim = claim(source, "unreadable-alternative");
  const ownerHypothesis = hypothesis(ownerClaim);
  const evidence = evidenceRecord(source, fact, "unreadable-alternative", {
    claimId: ownerClaim.id,
  });
  const gap: KnowledgeGap = {
    id: id<KnowledgeGapId>("gap-unreadable-specific"),
    snapshotId: source.id,
    category: "unreadable_source",
    question: "The original source must be revalidated.",
    blocks: ["finding"],
    relatedEntityIds: [owner.id],
    relatedHypothesisIds: [ownerHypothesis.id],
    suggestedOperations: [],
    status: "open",
  };
  const evaluated = evaluateKnowledgeGapResolution({
    snapshot: source,
    gaps: [gap],
    claims: [ownerClaim],
    hypotheses: [ownerHypothesis],
    facts: [fact],
    evidence: [evidence],
    findings: [],
    operationRecords: [],
  });
  assert.equal(evaluated.gaps[0]?.status, "open");
  assert.equal(evaluated.decisions[0]?.reasonCode, "source_identity_unavailable");
});

scenario("119. semantic negative constraints remain traceable without becoming search targets", async () => {
  const source = snapshot({ suffix: "semantic-negative" });
  const selectedBudget = budget({ maxPlannerRounds: 0 });
  const request = requestFor(source, {
    task: "inspect behavior",
    negativeConstraints: [{ kind: "semantic", description: "Do not change external behavior." }],
  });
  request.budget = selectedBudget;
  const { result } = await runInput(baseInput(source, {
    request,
    budget: selectedBudget,
  }));
  const seed = result.trace.find((event) => event.type === "seed_interpreted");
  assert.equal(seed?.negativeConstraintCount, 1);
  assert.equal(seed?.semanticNegativeConstraintCount, 1);
  assert.equal(
    result.operationRecords.some(
      (record) =>
        (record.operation.type === "search_text" ||
          record.operation.type === "search_paths" ||
          record.operation.type === "search_symbols") &&
        record.operation.query === "Do not change external behavior.",
    ),
    false,
  );
});

scenario("120. unrelated call and matching import cannot manufacture an owner chain", async () => {
  const run = await runSyntheticOwnerFacts({
    suffix: "owner-disconnected-call",
    facts: (source) => directOwnerChainRecords(source, "owner-disconnected-call", "disconnected_call"),
  });
  assert.notEqual(run.result.stop.reason, "sufficient_evidence");
  assert.equal(
    run.result.findings.some(
      (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
    ),
    false,
  );
  assert.notEqual(
    run.result.questions.find((question) => question.id === run.question.id)?.status,
    "answered",
  );
  const parseRecords = run.result.operationRecords.filter(
    (record) => record.operation.type === "parse_file" && record.status === "completed",
  );
  assert.ok(parseRecords.length >= 2);
  assert.ok(parseRecords.every((record) =>
    record.operation.hypothesisIds.includes(run.ownerHypothesis.id),
  ));
  const call = run.result.facts.find((fact) => fact.predicate === "calls");
  const imported = run.result.facts.find((fact) => fact.predicate === "imports");
  assert.ok(call?.provenance.operationId);
  assert.equal(call.provenance.operationId, imported?.provenance.operationId);
  assert.equal(
    run.result.evidence.some((record) => record.claimId === run.ownerClaim.id),
    false,
  );
});

scenario("121. connected call-import-contains chain preserves exact owner evidence", async () => {
  let expectedChainFactIds: FactId[] = [];
  let unrelatedFactId: FactId | undefined;
  const run = await runSyntheticOwnerFacts({
    suffix: "owner-connected-call",
    facts: (source) => {
      const records = directOwnerChainRecords(source, "owner-connected-call", "connected_call");
      const unrelatedSubject = syntheticEntity(
        source,
        "src/route.ts",
        "owner-connected-call-unrelated-subject",
        "function",
        "OtherHandler",
      );
      const unrelatedObject = syntheticEntity(
        source,
        "src/route.ts",
        "owner-connected-call-unrelated-object",
        "function",
        "OtherHelper",
      );
      const unrelated = syntheticRelation(
        source,
        "src/route.ts",
        "owner-connected-call-unrelated",
        unrelatedSubject,
        "calls",
        unrelatedObject,
      );
      expectedChainFactIds = [
        records.originFact.id,
        records.importFact.id,
        records.containsFact.id,
      ].sort();
      unrelatedFactId = unrelated.id;
      return {
        entities: [...records.entities, unrelatedSubject, unrelatedObject],
        facts: [...records.facts, unrelated],
      };
    },
  });
  assert.equal(run.result.stop.reason, "sufficient_evidence");
  assert.notEqual(
    run.result.questions.find((question) => question.id === run.question.id)?.status,
    "open",
  );
  const ownerFinding = run.result.findings.find(
    (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
  );
  assert.ok(ownerFinding);
  const findingFactIds = [...new Set(
    run.result.evidence
      .filter((record) => ownerFinding.evidenceIds.includes(record.id))
      .flatMap((record) => record.factIds),
  )].sort();
  assert.deepEqual(findingFactIds, expectedChainFactIds);
  assert.equal(findingFactIds.includes(unrelatedFactId!), false);
  const evaluatedClaim = run.result.claims.find((candidate) => candidate.id === run.ownerClaim.id);
  assert.deepEqual(evaluatedClaim?.derivation.inputFactIds, expectedChainFactIds);
});

scenario("122. connected route-import-contains chain remains a grounded owner proof", async () => {
  const run = await runSyntheticOwnerFacts({
    suffix: "owner-connected-route",
    facts: (source) => directOwnerChainRecords(source, "owner-connected-route", "route"),
  });
  assert.equal(
    run.result.findings.filter(
      (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
    ).length,
    1,
  );
});

scenario("123. disconnected same-name owner components remain competing", async () => {
  const run = await runSyntheticOwnerFacts({
    suffix: "owner-disconnected-components",
    facts: (source) => {
      const routeHandlerA = syntheticEntity(source, "src/route.ts", "component-a-handler", "function", "HandlerA");
      const routeHandlerB = syntheticEntity(source, "src/route.ts", "component-b-handler", "function", "HandlerB");
      const moduleA = syntheticEntity(source, "src/route.ts", "component-a-module", "module", "route-a");
      const moduleB = syntheticEntity(source, "src/route.ts", "component-b-module", "module", "route-b");
      const importedA = syntheticEntity(source, "", "component-a-imported", "symbol", "CandidateService", {
        importedName: "CandidateService",
        localName: "CandidateService",
        moduleSpecifier: "./candidate",
      });
      const importedB = syntheticEntity(source, "", "component-b-imported", "symbol", "CandidateService", {
        importedName: "CandidateService",
        localName: "CandidateService",
        moduleSpecifier: "./other",
      });
      const candidateModuleA = syntheticEntity(source, "src/candidate.ts", "component-a-candidate-module", "module", "candidate-a");
      const candidateModuleB = syntheticEntity(source, "src/other.ts", "component-b-candidate-module", "module", "candidate-b");
      const candidateA = syntheticEntity(source, "src/candidate.ts", "component-a-candidate", "function", "CandidateService");
      const candidateB = syntheticEntity(source, "src/other.ts", "component-b-candidate", "function", "CandidateService");
      return {
        entities: [
          routeHandlerA,
          routeHandlerB,
          moduleA,
          moduleB,
          importedA,
          importedB,
          candidateModuleA,
          candidateModuleB,
          candidateA,
          candidateB,
        ],
        facts: [
          syntheticRelation(source, "src/route.ts", "component-a-call", routeHandlerA, "calls", moduleA),
          syntheticRelation(source, "src/route.ts", "component-a-import", moduleA, "imports", importedA),
          syntheticRelation(source, "src/candidate.ts", "component-a-contains", candidateModuleA, "contains", candidateA),
          syntheticRelation(source, "src/route.ts", "component-b-call", routeHandlerB, "calls", moduleB),
          syntheticRelation(source, "src/route.ts", "component-b-import", moduleB, "imports", importedB),
          syntheticRelation(source, "src/other.ts", "component-b-contains", candidateModuleB, "contains", candidateB),
        ],
      };
    },
  });
  assert.notEqual(run.result.stop.reason, "sufficient_evidence");
  assert.equal(
    run.result.findings.some(
      (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
    ),
    false,
  );
  assert.ok(run.result.findings.filter(
    (finding) => finding.type === "implementation_target" && finding.status === "probable",
  ).length >= 2);
});

scenario("124. owner-chain result is independent of fact ordering", async () => {
  const createRecords = (source: RepositorySnapshot) =>
    directOwnerChainRecords(source, "owner-order-independent", "connected_call");
  const forward = await runSyntheticOwnerFacts({
    suffix: "owner-order-independent",
    facts: createRecords,
  });
  const reversed = await runSyntheticOwnerFacts({
    suffix: "owner-order-independent",
    facts: createRecords,
    reverseFacts: true,
  });
  const summarize = (result: InvestigationRunnerResult) => ({
    stop: result.stop.reason,
    questions: result.questions.map((question) => [question.id, question.status]),
    findings: result.findings.map((finding) => ({
      type: finding.type,
      status: finding.status,
      entityIds: finding.entityIds,
    })),
    claimFacts: result.claims.map((candidate) => candidate.derivation.inputFactIds),
  });
  assert.deepEqual(summarize(reversed.result), summarize(forward.result));
});

scenario("125. cyclic import graph remains bounded without an owner path", async () => {
  const run = await runSyntheticOwnerFacts({
    suffix: "owner-import-cycle",
    facts: (source) => {
      const handler = syntheticEntity(source, "src/route.ts", "cycle-handler", "function", "Handler");
      const routeModule = syntheticEntity(source, "src/route.ts", "cycle-route-module", "module", "route");
      const importModule = syntheticEntity(source, "src/import.ts", "cycle-import-module", "module", "import");
      const importedCycle = syntheticEntity(source, "", "cycle-import-symbol", "symbol", "Cycle", {
        importedName: "Cycle",
        localName: "Cycle",
        moduleSpecifier: "./import",
      });
      const reExportedCycle = syntheticEntity(source, "", "cycle-reexport-symbol", "symbol", "Cycle", {
        importedName: "Cycle",
        localName: "Cycle",
        moduleSpecifier: "./route",
      });
      const candidateModule = syntheticEntity(source, "src/candidate.ts", "cycle-candidate-module", "module", "candidate");
      const candidate = syntheticEntity(source, "src/candidate.ts", "cycle-candidate", "function", "CandidateService");
      return {
        entities: [
          handler,
          routeModule,
          importModule,
          importedCycle,
          reExportedCycle,
          candidateModule,
          candidate,
        ],
        facts: [
          syntheticRelation(source, "src/route.ts", "cycle-call", handler, "calls", routeModule),
          syntheticRelation(source, "src/route.ts", "cycle-import", routeModule, "imports", importedCycle),
          syntheticRelation(source, "src/import.ts", "cycle-reexport", importModule, "re_exports", reExportedCycle),
          syntheticRelation(source, "src/candidate.ts", "cycle-contains", candidateModule, "contains", candidate),
        ],
      };
    },
  });
  assert.notEqual(run.result.stop.reason, "sufficient_evidence");
  assert.equal(
    run.result.findings.some(
      (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
    ),
    false,
  );
});

scenario("126. wildcard and default imports do not prove exact owner identity", async () => {
  for (const importedName of ["*", "default"] as const) {
    const run = await runSyntheticOwnerFacts({
      suffix: `owner-non-exact-${importedName === "*" ? "wildcard" : "default"}`,
      facts: (source) => {
        const records = directOwnerChainRecords(
          source,
          `owner-non-exact-${importedName === "*" ? "wildcard" : "default"}`,
          "route",
        );
        const imported = records.importFact.kind === "relation"
          ? records.importFact.object
          : undefined;
        assert.ok(imported);
        imported.attributes = {
          ...imported.attributes,
          importedName,
          localName: importedName,
        };
        return records;
      },
    });
    assert.notEqual(run.result.stop.reason, "sufficient_evidence");
    assert.equal(
      run.result.findings.some(
        (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
      ),
      false,
    );
  }
});

scenario("127. one origin with competing connected candidates is never sort-selected", async () => {
  const run = await runSyntheticOwnerFacts({
    suffix: "owner-competing-connected",
    facts: (source) => {
      const routeModule = syntheticEntity(source, "src/route.ts", "competing-route-module", "module", "route");
      const endpoint = syntheticEntity(source, "src/route.ts", "competing-endpoint", "endpoint", "GET /items");
      const candidateModule = syntheticEntity(source, "src/candidate.ts", "competing-candidate-module", "module", "candidate");
      const candidateA = syntheticEntity(source, "src/candidate.ts", "competing-candidate-a", "function", "CandidateA");
      const candidateB = syntheticEntity(source, "src/candidate.ts", "competing-candidate-b", "function", "CandidateB");
      const importedA = syntheticEntity(source, "", "competing-import-a", "symbol", "CandidateA", {
        importedName: "CandidateA",
        localName: "CandidateA",
        moduleSpecifier: "./candidate",
      });
      const importedB = syntheticEntity(source, "", "competing-import-b", "symbol", "CandidateB", {
        importedName: "CandidateB",
        localName: "CandidateB",
        moduleSpecifier: "./candidate",
      });
      return {
        entities: [routeModule, endpoint, candidateModule, candidateA, candidateB, importedA, importedB],
        facts: [
          syntheticRelation(source, "src/route.ts", "competing-route", routeModule, "defines_endpoint", endpoint),
          syntheticRelation(source, "src/route.ts", "competing-import-a", routeModule, "imports", importedA),
          syntheticRelation(source, "src/route.ts", "competing-import-b", routeModule, "imports", importedB),
          syntheticRelation(source, "src/candidate.ts", "competing-contains-a", candidateModule, "contains", candidateA),
          syntheticRelation(source, "src/candidate.ts", "competing-contains-b", candidateModule, "contains", candidateB),
        ],
      };
    },
  });
  assert.notEqual(run.result.stop.reason, "sufficient_evidence");
  assert.equal(
    run.result.findings.some(
      (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
    ),
    false,
  );
});

scenario("128. cross-file extraction is rejected atomically after the authorized read", async () => {
  let rejectedEntityId: EntityId | undefined;
  let rejectedFactId: FactId | undefined;
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-cross-file",
    extraction: (source) => {
      const privateModule = syntheticEntity(
        source,
        "src/private/secret.ts",
        "boundary-private-module",
        "module",
        "private",
      );
      const privateCandidate = syntheticEntity(
        source,
        "src/private/secret.ts",
        "boundary-private-candidate",
        "function",
        "PrivateCandidate",
      );
      const fact = syntheticRelation(
        source,
        "src/private/secret.ts",
        "boundary-private-contains",
        privateModule,
        "contains",
        privateCandidate,
      );
      rejectedEntityId = privateCandidate.id;
      rejectedFactId = fact.id;
      return { entities: [privateModule, privateCandidate], facts: [fact], limitations: [] };
    },
  });
  const record = invalidExtractionRecord(run.result);
  assert.equal(record.actualCost?.operations, 1);
  assert.equal(record.actualCost?.fileReads, 1);
  assert.equal(record.actualCost?.fileBytes, run.publicFile.sizeBytes);
  assert.equal(record.actualCost?.parsedFiles, 1);
  assert.equal(run.result.budgetState.usage.fileBytes, run.publicFile.sizeBytes);
  assert.equal(run.result.entities.some((entity) => entity.id === rejectedEntityId), false);
  assert.equal(run.result.facts.some((fact) => fact.id === rejectedFactId), false);
  assert.equal(run.result.evidence.some((evidence) => evidence.factIds.includes(rejectedFactId!)), false);
  assert.equal(run.result.findings.length, 0);
  const graph = await run.graphStore.exportTrace(run.fixture.snapshot.id);
  assert.deepEqual(graph.entities, []);
  assert.deepEqual(graph.facts, []);
});

scenario("129. path-negative constraints cannot be bypassed by cross-file extractor output", async () => {
  let privateEntityId: EntityId | undefined;
  let privateFactId: FactId | undefined;
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-negative-private",
    negativeConstraints: [{ kind: "path", pattern: "src/private/*" }],
    extraction: (source) => {
      const privateModule = syntheticEntity(source, "src/private/secret.ts", "negative-private-module", "module", "private");
      const privateEntity = syntheticEntity(source, "src/private/secret.ts", "negative-private-entity", "function", "PrivateEntity");
      const fact = syntheticRelation(source, "src/private/secret.ts", "negative-private-fact", privateModule, "contains", privateEntity);
      privateEntityId = privateEntity.id;
      privateFactId = fact.id;
      return { entities: [privateModule, privateEntity], facts: [fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
  assert.equal(run.result.entities.some((entity) => entity.id === privateEntityId), false);
  assert.equal(run.result.facts.some((fact) => fact.id === privateFactId), false);
  assert.equal(
    run.result.evidence.some((evidence) =>
      evidence.factIds.includes(privateFactId!) ||
      evidence.sourceSpans.some((span) => span.path === "src/private/secret.ts"),
    ),
    false,
  );
  assert.equal(JSON.stringify(run.result.trace).includes("src/private/secret.ts"), false);
  assert.deepEqual((await run.graphStore.exportTrace(run.fixture.snapshot.id)).facts, []);
});

scenario("130. extractor entity fileId must equal the authorized input file", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-entity-file",
    extraction: (source) => ({
      entities: [syntheticEntity(source, "src/private/secret.ts", "foreign-entity", "function", "ForeignEntity")],
      facts: [],
      limitations: [],
    }),
  });
  invalidExtractionRecord(run.result);
  assert.equal(run.result.entities.length, 0);
});

scenario("131. relation subject cannot be file-backed by another file", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-subject-file",
    extraction: (source) => {
      const records = currentFileRelation(source, "foreign-subject");
      const privateSubject = syntheticEntity(source, "src/private/secret.ts", "foreign-subject-private", "module", "private");
      records.fact.subject = privateSubject;
      return { entities: [], facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
  assert.equal(run.result.facts.length, 0);
});

scenario("132. relation object cannot be file-backed by another file", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-object-file",
    extraction: (source) => {
      const records = currentFileRelation(source, "foreign-object");
      const privateObject = syntheticEntity(source, "src/private/secret.ts", "foreign-object-private", "function", "PrivateTarget");
      if (records.fact.kind !== "relation") throw new Error("Fixture relation is required.");
      records.fact.object = privateObject;
      return { entities: [], facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
  assert.equal(run.result.facts.length, 0);
});

scenario("133. exact fileless imported-symbol references remain valid", async () => {
  let expectedFactId: FactId | undefined;
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-fileless-reference",
    extraction: (source) => {
      const records = currentFileRelation(source, "fileless-reference");
      expectedFactId = records.fact.id;
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  assert.ok(run.result.facts.some((fact) => fact.id === expectedFactId));
  assert.ok(run.result.entities.some(
    (entity) => entity.fileId === undefined && entity.kind === "symbol",
  ));
});

scenario("134. source fileId mismatch is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-source-file",
    extraction: (source) => {
      const records = currentFileRelation(source, "source-file-mismatch");
      const privateFile = source.files.find((file) => file.normalizedPath === "src/private/secret.ts")!;
      if (records.fact.source.kind !== "source_span") throw new Error("Fixture span is required.");
      records.fact.source.fileId = privateFile.id;
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
});

scenario("135. source path mismatch is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-source-path",
    extraction: (source) => {
      const records = currentFileRelation(source, "source-path-mismatch");
      if (records.fact.source.kind !== "source_span") throw new Error("Fixture span is required.");
      records.fact.source.path = "src/private/secret.ts";
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
});

scenario("136. source fingerprint mismatch is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-source-fingerprint",
    extraction: (source) => {
      const records = currentFileRelation(source, "source-fingerprint-mismatch");
      if (records.fact.source.kind !== "source_span") throw new Error("Fixture span is required.");
      records.fact.source.contentFingerprint = "content-foreign";
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
});

scenario("137. source line beyond authorized content is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-source-line",
    extraction: (source) => {
      const records = currentFileRelation(source, "source-line-outside");
      if (records.fact.source.kind !== "source_span") throw new Error("Fixture span is required.");
      records.fact.source.startLine = 2;
      records.fact.source.endLine = 2;
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
});

scenario("138. source end column beyond authorized content is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-source-column",
    extraction: (source) => {
      const records = currentFileRelation(source, "source-column-outside");
      if (records.fact.source.kind !== "source_span") throw new Error("Fixture span is required.");
      records.fact.source.endColumn = 10_000;
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
});

scenario("139. extractor-spoofed provenance operationId is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-operation-id",
    extraction: (source) => {
      const records = currentFileRelation(source, "spoofed-operation");
      records.fact.provenance.operationId = id<OperationId>("operation-spoofed");
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
  assert.equal(run.result.facts.length, 0);
});

scenario("140. extraction-result accessors are rejected without execution", async () => {
  let getterCalls = 0;
  const unsafeText = "raw-boundary-secret-value";
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-accessor",
    extraction: () => {
      const result: Record<string, unknown> = { facts: [], limitations: [] };
      Object.defineProperty(result, "entities", {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error(unsafeText);
        },
      });
      return result;
    },
  });
  const record = invalidExtractionRecord(run.result);
  assert.equal(getterCalls, 0);
  assert.equal(record.error?.message.includes(unsafeText), false);
  assert.equal(JSON.stringify(run.result).includes(unsafeText), false);
});

scenario("141. repository-metadata facts are rejected at the file-parser boundary", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-metadata-source",
    extraction: (source) => {
      const owner = syntheticEntity(source, "src/a-public.ts", "metadata-owner", "module", "a-public");
      const fact = metadataFact(source, "metadata-boundary", { subject: owner });
      return { entities: [owner], facts: [fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
  assert.equal(run.result.facts.length, 0);
});

scenario("142. closed extraction-result schema rejects unsupported fields", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-closed-result",
    extraction: () => ({ entities: [], facts: [], limitations: [], extra: true }),
  });
  invalidExtractionRecord(run.result);
});

scenario("143. ordinary TypeScript extraction remains input-bound and accepted", async () => {
  const { result } = await groundedFixture();
  const completed = result.operationRecords.find(
    (record) => record.operation.type === "parse_file" && record.status === "completed",
  );
  assert.ok(completed);
  assert.equal(completed.operation.type, "parse_file");
  if (completed.operation.type !== "parse_file") throw new Error("Parse operation is required.");
  const parsedPath = completed.operation.path;
  const parsedFacts = result.facts.filter((fact) => completed.producedFactIds.includes(fact.id));
  assert.ok(parsedFacts.length > 0);
  assert.ok(parsedFacts.every(
    (fact) =>
      fact.source.kind === "source_span" &&
      fact.source.path === parsedPath &&
      fact.provenance.operationId === completed.operation.id,
  ));
});

scenario("144. ordinary manifest extraction remains input-bound and accepted", async () => {
  const fixture = repositoryFixture("boundary-manifest", [{
    path: "package.json",
    content: JSON.stringify({ name: "fixture-package", version: "1.0.0", scripts: { test: "node test.js" } }),
    kind: "configuration",
  }]);
  const manifest = fixture.snapshot.files[0]!;
  const inspect = operation(fixture.snapshot, {
    type: "inspect_manifest",
    path: manifest.normalizedPath,
    reason: "Inspect a snapshot-grounded manifest.",
    questionIds: [],
    hypothesisIds: [],
    priority: 10,
    estimatedCost: {
      operations: 1,
      fileReads: 1,
      fileBytes: manifest.sizeBytes,
      parsedFiles: 1,
      relationshipHops: 0,
      plannerRounds: 0,
      wallTimeMs: 0,
    },
    safetyClassification: "safe",
  });
  const adapter = new InMemoryRepositoryInvestigationAdapter(fixture.snapshot, fixture.adapterFiles);
  const { result } = await runInput(baseInput(fixture.snapshot, {
    operationCandidates: [inspect],
    budget: budget({ maxPlannerRounds: 2 }),
  }), { adapter });
  const completed = result.operationRecords.find(
    (record) => record.operation.type === "inspect_manifest" && record.status === "completed",
  );
  assert.ok(completed);
  assert.ok(result.facts.some(
    (fact) =>
      fact.source.kind === "source_span" &&
      fact.source.fileId === manifest.id &&
      fact.source.path === manifest.normalizedPath &&
      fact.source.contentFingerprint === manifest.contentFingerprint,
  ));
});

scenario("145. source snapshot mismatch is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-source-snapshot",
    extraction: (source) => {
      const records = currentFileRelation(source, "source-snapshot-mismatch");
      if (records.fact.source.kind !== "source_span") throw new Error("Fixture span is required.");
      records.fact.source.snapshotId = id<SnapshotId>("snapshot-foreign");
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
});

scenario("146. sparse extraction arrays are rejected before cloning", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "boundary-sparse-array",
    extraction: () => ({
      entities: [],
      facts: new Array<FactRecord>(1),
      limitations: [],
    }),
  });
  invalidExtractionRecord(run.result);
});

scenario("147. fileless contains object is rejected before graph ingestion", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "fileless-contains-boundary",
    extraction: (source) => {
      const records = filelessReferenceRelation(
        source,
        "fileless-contains-boundary",
        "contains",
      );
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
  const graph = await run.graphStore.exportTrace(run.fixture.snapshot.id);
  assert.deepEqual(graph.entities, []);
  assert.deepEqual(graph.facts, []);
});

scenario("148. complete fileless-candidate exploit chain cannot confirm an owner", async () => {
  const run = await runSyntheticOwnerFacts({
    suffix: "fileless-owner-exploit",
    facts: (source) => {
      const records = directOwnerChainRecords(source, "fileless-owner-exploit", "route");
      if (
        records.importFact.kind !== "relation" ||
        records.containsFact.kind !== "relation"
      ) {
        throw new Error("Relation fixtures are required.");
      }
      records.containsFact.object = records.importFact.object;
      return records;
    },
  });
  assert.ok(run.result.operationRecords.some(
    (record) => record.error?.code === "invalid_operation_result",
  ));
  assert.equal(
    run.result.findings.some(
      (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
    ),
    false,
  );
  assert.notEqual(
    run.result.questions.find((question) => question.id === run.question.id)?.status,
    "answered",
  );
  assert.notEqual(run.result.stop.reason, "sufficient_evidence");
  assert.equal(run.result.safeToProject, false);
});

scenario("149. mixed import and fileless contains rejects the whole extraction result", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "fileless-mixed-use",
    extraction: (source) => {
      const imported = currentFileRelation(source, "fileless-mixed-import");
      if (imported.fact.kind !== "relation") throw new Error("Relation fixture is required.");
      const contains = syntheticRelation(
        source,
        "src/a-public.ts",
        "fileless-mixed-contains",
        imported.subject,
        "contains",
        imported.object,
      );
      return {
        entities: imported.entities,
        facts: [imported.fact, contains],
        limitations: [],
      };
    },
  });
  invalidExtractionRecord(run.result);
  assert.equal(run.result.facts.length, 0);
});

scenario("150. orphan fileless symbol is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "fileless-orphan",
    extraction: (source) => ({
      entities: [syntheticEntity(
        source,
        "",
        "fileless-orphan-reference",
        "symbol",
        "OrphanReference",
        { referenceKind: "unresolved_syntax_reference" },
      )],
      facts: [],
      limitations: [],
    }),
  });
  invalidExtractionRecord(run.result);
});

scenario("151. fileless relation subject is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "fileless-subject",
    extraction: (source) => {
      const records = filelessReferenceRelation(source, "fileless-subject", "calls");
      const fact = syntheticRelation(
        source,
        "src/a-public.ts",
        "fileless-subject-fact",
        records.reference,
        "calls",
        records.subject,
      );
      return { entities: records.entities, facts: [fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
});

scenario("152. unsupported fileless object predicate is rejected", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "fileless-unsupported-predicate",
    extraction: (source) => {
      const records = filelessReferenceRelation(
        source,
        "fileless-unsupported-predicate",
        "configures",
      );
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
});

scenario("153. exact fileless import reference remains accepted", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "fileless-import-valid",
    extraction: (source) => {
      const records = currentFileRelation(source, "fileless-import-valid");
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  assert.ok(run.result.facts.some((fact) => fact.predicate === "imports"));
});

scenario("154. fileless re-export reference remains accepted", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "fileless-reexport-valid",
    extraction: (source) => {
      const records = currentFileRelation(source, "fileless-reexport-valid");
      records.fact.predicate = "re_exports";
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  assert.ok(run.result.facts.some((fact) => fact.predicate === "re_exports"));
});

scenario("155. unresolved fileless call target remains accepted as context", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "fileless-call-valid",
    extraction: (source) => {
      const records = filelessReferenceRelation(source, "fileless-call-valid", "calls");
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  const fact = run.result.facts.find((candidate) => candidate.predicate === "calls");
  assert.equal(fact?.kind, "relation");
  assert.equal(fact?.kind === "relation" ? fact.object.fileId : "unexpected", undefined);
});

scenario("156. unresolved fileless rendered component remains accepted", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "fileless-render-valid",
    extraction: (source) => {
      const records = filelessReferenceRelation(
        source,
        "fileless-render-valid",
        "renders",
        "component",
      );
      return { entities: records.entities, facts: [records.fact], limitations: [] };
    },
  });
  assert.ok(run.result.facts.some((fact) => fact.predicate === "renders"));
});

scenario("157. ordinary file-backed contains remains accepted", async () => {
  let definitionId: EntityId | undefined;
  const run = await runExtractionBoundaryCase({
    suffix: "file-backed-contains-valid",
    extraction: (source) => {
      const module = syntheticEntity(source, "src/a-public.ts", "definition-module", "module", "a-public");
      const definition = syntheticEntity(source, "src/a-public.ts", "definition-function", "function", "PublicDefinition");
      const fact = syntheticRelation(source, "src/a-public.ts", "definition-contains", module, "contains", definition);
      definitionId = definition.id;
      return { entities: [module, definition], facts: [fact], limitations: [] };
    },
  });
  assert.ok(run.result.entities.some(
    (entity) => entity.id === definitionId && entity.fileId === run.publicFile.id,
  ));
  assert.ok(run.result.facts.some((fact) => fact.predicate === "contains"));
});

scenario("158. explicit path and symbol owners remain file-backed", async () => {
  const fixture = repositoryFixture("file-backed-explicit-owner", [{
    path: "src/candidate.ts",
    content: "export function CandidateService() { return 1; }",
  }]);
  for (const explicitTargets of [
    [{ kind: "path" as const, path: "src/candidate.ts" }],
    [{ kind: "symbol" as const, symbol: "CandidateService" }],
  ]) {
    const { result } = await runStructuredRepositoryFixture({
      source: structuredClone(fixture.snapshot),
      adapterFiles: structuredClone(fixture.adapterFiles),
      task: "verify CandidateService",
      explicitTargets,
    });
    const finding = result.findings.find(
      (candidate) =>
        candidate.type === "implementation_target" && candidate.status === "confirmed",
    );
    assert.ok(finding);
    const entity = result.entities.find((candidate) => finding.entityIds.includes(candidate.id));
    assert.equal(entity?.fileId, fixture.snapshot.files[0]!.id);
  }
});

scenario("159. separate import and re-export parses end at a file-backed definition", async () => {
  for (const fixture of [
    exactImportOwnerFixture("file-backed-import-chain"),
    reExportOwnerFixture("file-backed-reexport-chain"),
  ]) {
    const { result } = await runStructuredRepositoryFixture({
      source: fixture.snapshot,
      adapterFiles: fixture.adapterFiles,
      task: "items",
    });
    assert.equal(result.stop.reason, "sufficient_evidence");
    assert.ok(result.questions.some(
      (question) => question.category === "owner" && question.status === "answered",
    ));
    const finding = result.findings.find(
      (candidate) =>
        candidate.type === "implementation_target" && candidate.status === "confirmed",
    );
    assert.ok(finding);
    const definition = result.entities.find((entity) => finding.entityIds.includes(entity.id));
    assert.ok(definition?.fileId);
    const definitionFact = result.facts.find(
      (fact) =>
        fact.kind === "relation" &&
        fact.predicate === "contains" &&
        fact.object.id === definition.id,
    );
    assert.equal(definitionFact?.kind, "relation");
    assert.equal(definitionFact?.kind === "relation" ? definitionFact.object.fileId : undefined, definition.fileId);
    assert.equal(
      result.facts
        .filter((fact) => fact.kind === "relation" && fact.predicate === "imports")
        .some((fact) => fact.kind === "relation" && fact.object.id === finding.entityIds[0]),
      false,
    );
  }
});

scenario("160. preloaded fileless contains cannot bypass defensive owner validation", async () => {
  const source = snapshot({ suffix: "preloaded-fileless-owner" });
  const module = syntheticEntity(
    source,
    source.files[0]!.normalizedPath,
    "preloaded-fileless-module",
    "module",
    "feature",
  );
  const reference = syntheticEntity(
    source,
    "",
    "preloaded-fileless-reference",
    "symbol",
    "CandidateService",
    {
      importedName: "CandidateService",
      localName: "CandidateService",
      moduleSpecifier: "./candidate",
    },
  );
  const ownerClaim = claim(source, "preloaded-fileless-owner");
  const ownerHypothesis = hypothesis(ownerClaim);
  const question = openQuestion("preloaded-fileless-owner", "critical");
  const follow = operation(source, {
    type: "follow_relationship",
    fromEntityId: module.id,
    predicates: ["contains"],
    maxHops: 1,
    reason: "Inspect a preloaded relationship through the public runner.",
    questionIds: [question.id],
    hypothesisIds: [ownerHypothesis.id],
    priority: 10,
    estimatedCost: {
      operations: 1,
      fileReads: 0,
      fileBytes: 0,
      parsedFiles: 0,
      relationshipHops: 1,
      plannerRounds: 0,
      wallTimeMs: 0,
    },
    safetyClassification: "safe",
  });
  const fact = syntheticRelation(
    source,
    source.files[0]!.normalizedPath,
    "preloaded-fileless-contains",
    module,
    "contains",
    reference,
  );
  fact.provenance.operationId = follow.id;
  const evidence = evidenceRecord(source, fact, "preloaded-fileless-owner", {
    claimId: ownerClaim.id,
  });
  const { result } = await runInput(baseInput(source, {
    questions: [question],
    claims: [ownerClaim],
    hypotheses: [ownerHypothesis],
    entities: [module, reference],
    facts: [fact],
    evidence: [evidence],
    operationCandidates: [follow],
    budget: budget({ maxPlannerRounds: 2 }),
  }));
  assert.equal(
    result.findings.some(
      (finding) => finding.type === "implementation_target" && finding.status === "confirmed",
    ),
    false,
  );
  assert.notEqual(
    result.questions.find((candidate) => candidate.id === question.id)?.status,
    "answered",
  );
  assert.notEqual(result.stop.reason, "sufficient_evidence");
  assert.equal(result.safeToProject, false);
});

scenario("161. fileless-role rejection is independent of entity and fact ordering", async () => {
  const run = async (reverse: boolean) => runExtractionBoundaryCase({
    suffix: `fileless-order-${reverse ? "reverse" : "forward"}`,
    extraction: (source) => {
      const imported = currentFileRelation(source, `fileless-order-${reverse}`);
      if (imported.fact.kind !== "relation") throw new Error("Relation fixture is required.");
      const contains = syntheticRelation(
        source,
        "src/a-public.ts",
        `fileless-order-contains-${reverse}`,
        imported.subject,
        "contains",
        imported.object,
      );
      const entities = [...imported.entities];
      const facts = [imported.fact, contains];
      return {
        entities: reverse ? entities.reverse() : entities,
        facts: reverse ? facts.reverse() : facts,
        limitations: [],
      };
    },
  });
  const forward = await run(false);
  const reverse = await run(true);
  invalidExtractionRecord(forward.result);
  invalidExtractionRecord(reverse.result);
  assert.deepEqual(forward.result.facts, []);
  assert.deepEqual(reverse.result.facts, []);
});

scenario("162. file-backed definition object must exactly exist in extraction entities", async () => {
  const run = await runExtractionBoundaryCase({
    suffix: "definition-entity-missing",
    extraction: (source) => {
      const module = syntheticEntity(source, "src/a-public.ts", "definition-missing-module", "module", "a-public");
      const definition = syntheticEntity(source, "src/a-public.ts", "definition-missing-object", "function", "MissingDefinition");
      const fact = syntheticRelation(source, "src/a-public.ts", "definition-missing-fact", module, "contains", definition);
      return { entities: [module], facts: [fact], limitations: [] };
    },
  });
  invalidExtractionRecord(run.result);
  assert.deepEqual(run.result.entities, []);
  assert.deepEqual(run.result.facts, []);
});

scenario("163. monotonic runner deadline is distinct from caller cancellation", async () => {
  const source = snapshot({ suffix: "typed-runner-deadline" });
  const harness = createRunnerHarness(source);
  await assertRejects(
    () => harness.runner.run(baseInput(source, { deadlineMonotonicMs: 0 })),
    (error) => error instanceof InvestigationRunnerError && error.code === "deadline_exceeded",
  );
  assert.equal(harness.cancellation.cancelled, false);
});

scenario("164. caller cancellation retains precedence over an expired runner deadline", async () => {
  const source = snapshot({ suffix: "typed-caller-cancellation" });
  const cancellation = new CancellationState();
  cancellation.cancelled = true;
  const harness = createRunnerHarness(source, { cancellation });
  await assertRejects(
    () => harness.runner.run(baseInput(source, { deadlineMonotonicMs: 0 })),
    (error) => error instanceof InvestigationRunnerError && error.code === "cancelled",
  );
});

scenario("165. cooperative event-loop yield delivers caller cancellation before another planner round", async () => {
  const source = snapshot({ suffix: "cooperative-yield" });
  const cancellation = new CancellationState();
  const ownerClaim = claim(source, "cooperative-yield");
  const ownerHypothesis = hypothesis(ownerClaim);
  const question = openQuestion("cooperative-yield", "critical");
  const harness = createRunnerHarness(source, { cancellation });
  const timer = setTimeout(() => {
    cancellation.cancelled = true;
  }, 0);
  const started = performance.now();
  await assertRejects(
    () => harness.runner.run(baseInput(source, {
      questions: [question],
      claims: [ownerClaim],
      hypotheses: [ownerHypothesis],
      operationCandidates: [searchOperation(source, "target")],
      budget: budget({ maxPlannerRounds: 100 }),
    })),
    (error) => error instanceof InvestigationRunnerError && error.code === "cancelled",
  );
  clearTimeout(timer);
  assert.ok(performance.now() - started < 500);
});

scenario("166. a fast investigation is semantically unchanged by a non-expiring deadline", async () => {
  const source = snapshot({ suffix: "fast-deadline-parity" });
  const withoutDeadline = await runInput(baseInput(source, {
    operationCandidates: [readOperation(source)],
  }));
  const withDeadline = await runInput(baseInput(source, {
    operationCandidates: [readOperation(source)],
    deadlineMonotonicMs: 10_000,
  }));
  assert.deepEqual(withDeadline.result, withoutDeadline.result);
});

scenario("167. controlled runner timeout classification replays deterministically", async () => {
  const run = async () => {
    const source = snapshot({ suffix: "deadline-replay" });
    const harness = createRunnerHarness(source);
    try {
      await harness.runner.run(baseInput(source, { deadlineMonotonicMs: 0 }));
      return "completed";
    } catch (error) {
      return error instanceof InvestigationRunnerError ? error.code : "unexpected";
    }
  };
  assert.deepEqual(await Promise.all([run(), run()]), ["deadline_exceeded", "deadline_exceeded"]);
});

scenario("168. dense relationship-chain expansion observes bounded infrastructure checkpoints", () => {
  const source = snapshot({ suffix: "dense-chain-checkpoint" });
  const entry = syntheticEntity(source, source.files[0]!.normalizedPath, "dense-chain-entry", "module", "entry");
  const bridge = syntheticEntity(source, source.files[0]!.normalizedPath, "dense-chain-bridge", "module", "bridge");
  const owner = syntheticEntity(source, source.files[0]!.normalizedPath, "dense-chain-owner", "function", "owner");
  const origin = syntheticRelation(
    source,
    source.files[0]!.normalizedPath,
    "dense-chain-origin",
    entry,
    "contains",
    bridge,
  );
  const first = syntheticRelation(
    source,
    source.files[0]!.normalizedPath,
    "dense-chain-first",
    bridge,
    "contains",
    owner,
  );
  const branches = Array.from({ length: 17 }, (_, index) => syntheticRelation(
    source,
    source.files[0]!.normalizedPath,
    `dense-chain-branch-${index}`,
    owner,
    "contains",
    owner,
  ));
  const facts = [first, ...branches];
  let checks = 0;
  const started = performance.now();
  assert.throws(
    () => buildStrictBoundedRelationshipChains({
      origins: [origin],
      facts,
      candidateFact: branches.at(-1)! as Extract<FactRecord, { kind: "relation" }>,
    }, () => {
      checks += 1;
      if (checks >= 1_000) {
        throw new InvestigationRunnerError("deadline_exceeded", "Fixture deadline reached.");
      }
    }),
    (error) => error instanceof InvestigationRunnerError && error.code === "deadline_exceeded",
  );
  assert.equal(checks, 1_000);
  assert.ok(performance.now() - started < 500);
});

scenario("169. implementation-owner batch decisions match repeated scalar decisions", () => {
  const context = directOwnerEligibilityContext("owner-batch-positive");
  const shared = {
    claim: context.ownerClaim,
    hypothesis: context.ownerHypothesis,
    operation: context.linkedOperation,
    operationRecords: [],
    facts: context.facts,
    snapshot: context.fixture.snapshot,
    request: requestFor(context.fixture.snapshot),
  };
  const batch = evaluateFactClaimEligibilityBatch({
    ...shared,
    factsToEvaluate: context.facts,
  });
  const scalar = context.facts.map((fact) => ({
    factId: fact.id,
    decision: evaluateFactClaimEligibility({ ...shared, fact }),
  }));
  assert.deepEqual(batch, scalar);
  assert.ok(batch.every(({ decision }) => decision.eligible));

  const reversed = evaluateFactClaimEligibilityBatch({
    ...shared,
    factsToEvaluate: [...context.facts].reverse(),
  });
  const byFactId = (decisions: typeof batch) => [...decisions]
    .sort((left, right) => left.factId.localeCompare(right.factId));
  assert.deepEqual(byFactId(reversed), byFactId(batch));
});

scenario("170. owner batch preserves every fact-specific negative decision", () => {
  const fixture = repositoryFixture("owner-batch-negative", [
    { path: "src/candidate.ts", content: "export function CandidateService() {}" },
    { path: "src/route.ts", content: "export const routeModule = true;" },
  ]);
  const ownerClaim = claim(fixture.snapshot, "owner-batch-negative");
  const ownerHypothesis = hypothesis(ownerClaim);
  ownerHypothesis.requiredEvidence[0]!.acceptedFactPredicates = ["contains", "tests"];
  const linkedOperation = parsePathOperation(fixture.snapshot, "src/route.ts", {
    hypotheses: [ownerHypothesis.id],
  });
  const routeModule = syntheticEntity(
    fixture.snapshot,
    "src/route.ts",
    "owner-batch-negative-route",
    "module",
    "route",
  );
  const signal = syntheticEntity(
    fixture.snapshot,
    "",
    "owner-batch-negative-signal",
    "symbol",
    "CandidateService",
  );
  const candidateModule = syntheticEntity(
    fixture.snapshot,
    "src/candidate.ts",
    "owner-batch-negative-module",
    "module",
    "candidate",
  );
  const candidate = syntheticEntity(
    fixture.snapshot,
    "src/candidate.ts",
    "owner-batch-negative-candidate",
    "function",
    "CandidateService",
  );
  const inactive = {
    ...syntheticRelation(
      fixture.snapshot,
      "src/route.ts",
      "owner-batch-negative-inactive",
      routeModule,
      "calls",
      signal,
    ),
    status: "invalidated" as const,
  };
  const requirementMismatch = syntheticRelation(
    fixture.snapshot,
    "src/route.ts",
    "owner-batch-negative-requirement",
    routeModule,
    "imports",
    signal,
  );
  const semanticMismatch = syntheticRelation(
    fixture.snapshot,
    "src/route.ts",
    "owner-batch-negative-semantic",
    routeModule,
    "tests",
    signal,
  );
  const missingProof = syntheticRelation(
    fixture.snapshot,
    "src/candidate.ts",
    "owner-batch-negative-missing-proof",
    candidateModule,
    "contains",
    candidate,
  );
  const facts = [inactive, requirementMismatch, semanticMismatch, missingProof]
    .map((fact) => groundFactForOperation(fact, linkedOperation.id));
  const shared = {
    claim: ownerClaim,
    hypothesis: ownerHypothesis,
    operation: linkedOperation,
    operationRecords: [],
    facts,
    snapshot: fixture.snapshot,
    request: requestFor(fixture.snapshot),
  };
  const batch = evaluateFactClaimEligibilityBatch({ ...shared, factsToEvaluate: facts });
  const scalar = facts.map((fact) => ({
    factId: fact.id,
    decision: evaluateFactClaimEligibility({ ...shared, fact }),
  }));
  assert.deepEqual(batch, scalar);
  assert.deepEqual(batch.map(({ decision }) => decision.reason), [
    "inactive_fact",
    "requirement_mismatch",
    "claim_semantic_mismatch",
    "owner_proof_missing",
  ]);
});

scenario("171. non-owner claim batch decisions remain scalar-equivalent", () => {
  const context = directOwnerEligibilityContext("owner-batch-non-owner");
  const behaviorClaim: ClaimRecord = {
    ...context.ownerClaim,
    id: id<ClaimId>("claim-owner-batch-behavior"),
    type: "behavior",
  };
  const behaviorHypothesis: InvestigationHypothesis = {
    ...context.ownerHypothesis,
    id: id<HypothesisId>("hypothesis-owner-batch-behavior"),
    claimId: behaviorClaim.id,
    requiredEvidence: [{
      ...context.ownerHypothesis.requiredEvidence[0]!,
      acceptedFactPredicates: ["calls"],
    }],
  };
  const linkedOperation = parsePathOperation(context.fixture.snapshot, "src/route.ts", {
    hypotheses: [behaviorHypothesis.id],
  });
  const facts = context.records.facts
    .map((fact) => groundFactForOperation(fact, linkedOperation.id));
  const shared = {
    claim: behaviorClaim,
    hypothesis: behaviorHypothesis,
    operation: linkedOperation,
    operationRecords: [],
    facts,
    snapshot: context.fixture.snapshot,
    request: requestFor(context.fixture.snapshot),
  };
  const batch = evaluateFactClaimEligibilityBatch({ ...shared, factsToEvaluate: facts });
  const scalar = facts.map((fact) => ({
    factId: fact.id,
    decision: evaluateFactClaimEligibility({ ...shared, fact }),
  }));
  assert.deepEqual(batch, scalar);
  assert.equal(batch.filter(({ decision }) => decision.eligible).length, 1);
  assert.equal(batch.find(({ decision }) => decision.eligible)?.decision.supportingFactIds.length, 1);
});

scenario("172. ambiguous owner chains remain unproven through the batch path", () => {
  const context = directOwnerEligibilityContext("owner-batch-ambiguous");
  const duplicateImport = {
    ...structuredClone(context.facts[1]!),
    id: id<FactId>("fact-owner-batch-ambiguous-import-duplicate"),
  };
  const facts = [...context.facts, duplicateImport];
  const shared = {
    claim: context.ownerClaim,
    hypothesis: context.ownerHypothesis,
    operation: context.linkedOperation,
    operationRecords: [],
    facts,
    snapshot: context.fixture.snapshot,
    request: requestFor(context.fixture.snapshot),
  };
  const batch = evaluateFactClaimEligibilityBatch({ ...shared, factsToEvaluate: facts });
  const scalar = facts.map((fact) => ({
    factId: fact.id,
    decision: evaluateFactClaimEligibility({ ...shared, fact }),
  }));
  assert.deepEqual(batch, scalar);
  const candidateFactId = context.facts[2]!.id;
  assert.deepEqual(batch.find(({ factId }) => factId === candidateFactId)?.decision, {
    eligible: false,
    reason: "owner_proof_missing",
    supportingFactIds: [],
  });
});

scenario("173. explicit owner proof remains batch and scalar equivalent", () => {
  const context = directOwnerEligibilityContext("owner-batch-explicit");
  const candidateFact = context.facts[2]!;
  const explicitTargets: InvestigationRequest["explicitTargets"][] = [
    [{ kind: "path", path: "src/candidate.ts" }],
    [{ kind: "symbol", symbol: "CandidateService" }],
  ];
  for (const targets of explicitTargets) {
    const shared = {
      claim: context.ownerClaim,
      hypothesis: context.ownerHypothesis,
      operation: context.linkedOperation,
      operationRecords: [],
      facts: context.facts,
      snapshot: context.fixture.snapshot,
      request: requestFor(context.fixture.snapshot, { explicitTargets: targets }),
    };
    let relationshipChainBuilds = 0;
    const batch = evaluateFactClaimEligibilityBatch(
      { ...shared, factsToEvaluate: context.facts },
      undefined,
      { relationshipChainBuildStarted: () => { relationshipChainBuilds += 1; } },
    );
    const scalar = context.facts.map((fact) => ({
      factId: fact.id,
      decision: evaluateFactClaimEligibility({ ...shared, fact }),
    }));
    assert.deepEqual(batch, scalar);
    assert.deepEqual(batch.find(({ factId }) => factId === candidateFact.id)?.decision, {
      eligible: true,
      reason: "eligible",
      supportingFactIds: [candidateFact.id],
    });
    assert.equal(relationshipChainBuilds, 0);
  }
});

scenario("174. owner-proof derivation scales with candidates instead of evaluated facts", () => {
  const fixture = repositoryFixture("owner-batch-structural", [
    { path: "src/candidate.ts", content: "export const candidates = true;" },
    { path: "src/import.ts", content: "export const imports = true;" },
    { path: "src/route.ts", content: "export const routes = true;" },
  ]);
  const ownerClaim = claim(fixture.snapshot, "owner-batch-structural");
  const ownerHypothesis = hypothesis(ownerClaim);
  ownerHypothesis.requiredEvidence[0]!.acceptedFactPredicates = ["calls", "contains", "imports"];
  const linkedOperation = parsePathOperation(fixture.snapshot, "src/route.ts", {
    hypotheses: [ownerHypothesis.id],
  });
  const importedSignal = syntheticEntity(
    fixture.snapshot,
    "",
    "owner-batch-structural-imported",
    "symbol",
    "Candidate0",
    {
      importedName: "Candidate0",
      localName: "Candidate0",
      moduleSpecifier: "./candidate",
    },
  );
  const importModule = syntheticEntity(
    fixture.snapshot,
    "src/import.ts",
    "owner-batch-structural-import-module",
    "module",
    "imports",
  );
  const candidateModule = syntheticEntity(
    fixture.snapshot,
    "src/candidate.ts",
    "owner-batch-structural-candidate-module",
    "module",
    "candidates",
  );
  const calls = Array.from({ length: 50 }, (_, index) => {
    const caller = syntheticEntity(
      fixture.snapshot,
      "src/route.ts",
      `owner-batch-structural-caller-${index}`,
      "function",
      `Caller${index}`,
    );
    return syntheticRelation(
      fixture.snapshot,
      "src/route.ts",
      `owner-batch-structural-call-${index}`,
      caller,
      "calls",
      importedSignal,
    );
  });
  const importFact = syntheticRelation(
    fixture.snapshot,
    "src/import.ts",
    "owner-batch-structural-import",
    importModule,
    "imports",
    importedSignal,
  );
  const candidates = Array.from({ length: 13 }, (_, index) => {
    const candidate = syntheticEntity(
      fixture.snapshot,
      "src/candidate.ts",
      `owner-batch-structural-candidate-${index}`,
      "function",
      `Candidate${index}`,
    );
    return syntheticRelation(
      fixture.snapshot,
      "src/candidate.ts",
      `owner-batch-structural-contains-${index}`,
      candidateModule,
      "contains",
      candidate,
    );
  });
  const facts = [...calls, importFact, ...candidates]
    .map((fact) => groundFactForOperation(fact, linkedOperation.id));
  let proofDerivations = 0;
  let relationshipChainBuilds = 0;
  const decisions = evaluateFactClaimEligibilityBatch(
    {
      factsToEvaluate: facts,
      claim: ownerClaim,
      hypothesis: ownerHypothesis,
      operation: linkedOperation,
      operationRecords: [],
      facts,
      snapshot: fixture.snapshot,
      request: requestFor(fixture.snapshot),
    },
    undefined,
    {
      ownerProofDerivationStarted: () => { proofDerivations += 1; },
      relationshipChainBuildStarted: () => { relationshipChainBuilds += 1; },
    },
  );
  assert.equal(facts.length, 64);
  assert.equal(candidates.length, 13);
  assert.equal(facts.length * candidates.length, 832);
  assert.equal(decisions.length, facts.length);
  assert.equal(proofDerivations, 1);
  assert.equal(relationshipChainBuilds, candidates.length);
});

for (const current of scenarios) {
  await current.run();
}

console.log(`Context Engine v2 investigation runner smoke passed: ${scenarios.length} scenarios.`);
