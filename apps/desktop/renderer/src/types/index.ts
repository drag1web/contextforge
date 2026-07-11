export interface ReadinessCheck {
  key: string;
  label: string;
  passed: boolean;
  points: number;
  message: string;
}

export interface ScannerPackageSummary {
  path: string;
  name: string | null;
  scripts: Record<string, string>;
}

export interface ScannerSignals {
  packageFiles: string[];
  docs: string[];
  envExamples: string[];
  testFiles: string[];
  testConfigs: string[];
  ciFiles: string[];
  lockFiles: string[];
  configs: string[];
  directories: string[];
  commands: {
    dev: string | null;
    build: string | null;
    test: string | null;
    typecheck: string | null;
    lint: string | null;
  };
  packages: ScannerPackageSummary[];
  inventory: {
    totalFiles: number;
    totalDirectories: number;
    truncated: boolean;
    maxDepth: number;
    maxEntries: number;
  };
}

export interface ReadinessReport {
  score: number;
  checks: ReadinessCheck[];
  issues: string[];
  signals?: ScannerSignals;
}

export type TargetTool = "codex" | "cursor" | "claude" | "gemini" | "generic";

export type TemplateTaskType =
  | "general"
  | "ui"
  | "backend"
  | "fullstack"
  | "build"
  | "bugfix"
  | "refactor"
  | "docs"
  | "tests";

export type RuleCategory =
  | "general"
  | "ui"
  | "backend"
  | "bugfix"
  | "refactor"
  | "docs"
  | "tests"
  | "assets"
  | "verification";

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  targetTool: TargetTool;
  taskType: TemplateTaskType;
  content: string;
  isBuiltin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleItem {
  id: string;
  title: string;
  description: string;
  category: RuleCategory;
  content: string;
  isBuiltin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleProfile {
  id: string;
  name: string;
  description: string;
  taskType: TemplateTaskType;
  enabledRuleIds: string[];
  customRules: string[];
  acceptanceCriteriaPresetId?: string | null;
  isBuiltin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcceptanceCriteriaPreset {
  id: string;
  name: string;
  description: string;
  taskType: TemplateTaskType;
  criteria: string[];
  isBuiltin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleProfilesCatalog {
  ruleProfiles: RuleProfile[];
  ruleItems: RuleItem[];
  acceptanceCriteriaPresets: AcceptanceCriteriaPreset[];
}

export interface Project {
  id: number;
  name: string;
  localPath: string;
  packageManager: string | null;
  detectedStack: string[];
  scripts: Record<string, string>;
  readinessScore: number;
  readinessReport: ReadinessReport;
  createdAt: string;
  updatedAt: string;
  lastScanAt: string | null;
}

export type GitFileChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "unmerged"
  | "untracked"
  | "unknown";

export interface GitChangedFile {
  path: string;
  originalPath?: string | null;
  status: GitFileChangeKind;
  indexStatus: string;
  workingTreeStatus: string;
}

export interface GitLatestCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitChangeSummary {
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  totalChanged: number;
  isTruncated: boolean;
}

export interface GitStatusResult {
  isGitRepo: boolean;
  projectRoot: string;
  repositoryRoot: string | null;
  branch: string | null;
  isDetachedHead: boolean;
  dirty: boolean;
  staged: GitChangedFile[];
  unstaged: GitChangedFile[];
  untracked: GitChangedFile[];
  latestCommit: GitLatestCommit | null;
  summary: GitChangeSummary;
  warnings: string[];
}

export type GitDiffScope = "staged" | "unstaged" | "untracked";

export interface GitDiffFileSummary {
  path: string;
  originalPath?: string | null;
  status: GitFileChangeKind;
  scope: GitDiffScope;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface GitDiffTotals {
  filesChanged: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  isTruncated: boolean;
}

export interface GitDiffSummaryResult {
  isGitRepo: boolean;
  projectRoot: string;
  repositoryRoot: string | null;
  branch: string | null;
  dirty: boolean;
  files: GitDiffFileSummary[];
  totals: GitDiffTotals;
  warnings: string[];
  generatedAt: string;
}

export interface StorageAuditCount {
  key: string;
  label: string;
  count: number | null;
  status: "ready" | "planned" | "external" | "unknown";
  note: string;
}

export interface StorageAuditArtifact {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  role: string;
  migrationStatus: "primary" | "legacy" | "external" | "planned";
}

export interface StorageAuditGap {
  key: string;
  title: string;
  description: string;
  priority: "now" | "next" | "later";
}

export interface StorageAuditPlanStep {
  id: string;
  title: string;
  description: string;
  status: "done" | "current" | "next" | "later";
}

export interface StorageReleaseCheck {
  key: string;
  label: string;
  status: "pass" | "warning" | "fail";
  note: string;
}

export interface StorageReleaseReadiness {
  status: "ready" | "review" | "blocked";
  passed: number;
  warnings: number;
  failed: number;
  checks: StorageReleaseCheck[];
}

export interface StorageAuditSchema {
  currentVersion: number;
  latestVersion: number;
  status: "ready" | "needs_migration" | "unknown";
  pendingCount: number;
  appliedCount: number;
  latestMigration: {
    id: string;
    name: string;
    appliedAt: string;
  } | null;
}

export interface StorageAuditResult {
  generatedAt: string;
  driver: "sqlite" | "postgres";
  sqliteFirst: boolean;
  databasePath: string | null;
  databaseExists: boolean;
  databaseSizeBytes: number | null;
  workspaceRoot: string;
  schema: StorageAuditSchema | null;
  counts: StorageAuditCount[];
  artifacts: StorageAuditArtifact[];
  gaps: StorageAuditGap[];
  plan: StorageAuditPlanStep[];
  releaseReadiness: StorageReleaseReadiness;
  notes: string[];
}

export interface WorkspaceBackupExportResult {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  counts: {
    projects: number;
    taskPacks: number;
    projectMemories: number;
    ruleTemplates: number;
    settings: number;
  };
  included: string[];
  excluded: string[];
  warnings: string[];
}

export interface GitHubIssueTaskPackSource {
  type: "github-issue";
  owner: string;
  repo: string;
  fullName: string;
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  issueState: "open" | "closed";
  labels: string[];
  authorLogin: string | null;
  repositoryUrl: string;
  linkedAt: string;
}


export interface GitHubCreatedIssueLink {
  type: "github-created-issue";
  owner: string;
  repo: string;
  fullName: string;
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  issueState: "open" | "closed";
  labels: string[];
  repositoryUrl: string;
  createdAt: string;
  createdFromTaskPackId: number;
}

export interface TaskPackGenerationRecipe {
  template: {
    id: string;
    name: string;
    targetTool: string;
    taskType: string;
    isBuiltin: boolean;
  } | null;
  ruleProfile: {
    id: string;
    name: string;
    taskType: string;
    isBuiltin: boolean;
  } | null;
  enabledRules: Array<{
    id: string;
    title: string;
    category: string;
  }>;
  customRules: string[];
  acceptanceCriteriaPreset: {
    id: string;
    name: string;
    taskType: string;
    isBuiltin: boolean;
  } | null;
  acceptanceCriteria: string[];
  counts: {
    enabledRules: number;
    customRules: number;
    acceptanceCriteria: number;
  };
  githubIssue?: GitHubIssueTaskPackSource;
  githubCreatedIssue?: GitHubCreatedIssueLink;
  selectorDiagnostics?: SelectorPipelineDiagnostics;
}

export type SelectorPipelineMode = "legacy" | "shadow_compare" | "shadow_primary";
export type EffectiveSelectorPipeline = "legacy" | "shadow";
export type SelectorDecisionOutcome = "selected" | "abstained" | "blocked";
export type SelectorEvidenceStrength = "strong" | "supporting" | "reference";
export type SelectorAbstentionReasonCode =
  | "explicit_target_missing"
  | "no_grounded_candidates"
  | "no_ranked_candidates"
  | "ambiguous_target"
  | "legacy_empty_selection";

export interface SelectorSelectionSummary {
  pipeline: EffectiveSelectorPipeline;
  selectedFiles: Array<{
    path: string;
    usage: string;
    reason: string;
    evidenceStrength: SelectorEvidenceStrength;
  }>;
  primaryTarget: string | null;
  implementationArea: string;
  confidence: number;
  quality: number | null;
  blocked: boolean;
  manualReview: boolean;
  missingTarget: boolean;
  candidateCount: number;
  outcome: SelectorDecisionOutcome;
  abstention: {
    code: SelectorAbstentionReasonCode;
    message: string;
    nextActions: string[];
  } | null;
}

export interface SelectorPipelineDiagnostics {
  id: string;
  timestamp: string;
  projectRef: string;
  taskHash: string;
  requestedMode: SelectorPipelineMode;
  effectivePipeline: EffectiveSelectorPipeline;
  status: "success" | "fallback" | "blocked" | "manual-review";
  executionStatus?: "success" | "fallback";
  qualityStatus?: "ready" | "warning" | "blocked";
  selectionOrigin?: "pipeline" | "manual_override";
  fallback: { code: string; message: string } | null;
  shadowFailure?: { code: string; message: string } | null;
  timings: { totalMs: number; legacyMs: number | null; shadowMs: number | null };
  actual: SelectorSelectionSummary;
  legacy: SelectorSelectionSummary | null;
  shadow: SelectorSelectionSummary | null;
  comparison: {
    primaryTargetAgreement: boolean;
    implementationAreaAgreement: boolean;
    selectedPathOverlap: number;
    editTargetOverlap: number;
    legacyOnlyPaths: string[];
    shadowOnlyPaths: string[];
    safetyDecisionAgreement: boolean;
    manualReviewAgreement: boolean;
  } | null;
}

export interface TaskPack {
  id: number;
  projectId: number;
  projectName?: string;
  title: string;
  rawTask: string;
  taskType: string;
  targetTool: string;
  generatedPrompt: string;
  generationMode?: "template" | "ollama";
  generationModel?: string | null;
  generationMessage?: string | null;
  generationUsedFallback?: boolean;
  generationDurationMs?: number | null;
  generationCached?: boolean;
  generationRecipe?: TaskPackGenerationRecipe | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectMemoryCategory =
  | "architecture"
  | "do_not_change"
  | "style"
  | "verification"
  | "workflow"
  | "custom";

export interface ProjectMemory {
  id: number;
  projectId: number;
  title: string;
  content: string;
  category: ProjectMemoryCategory;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemoryInput {
  title: string;
  content: string;
  category: ProjectMemoryCategory;
  isEnabled?: boolean;
}

export interface ProjectContextFile {
  fileName: "AGENTS.md" | "AGENTS.generated.md";
  path: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

export interface AgentsPreview {
  projectId: number;
  projectName: string;
  markdown: string;
  generation?: GenerationMetadata;
  projectMemories?: ProjectMemory[];
  agentsFile?: {
    path: string;
    exists: boolean;
  };
}

export interface TaskPackDraft {
  projectId: number;
  projectName: string;
  rawTask: string;
  taskType: string;
  targetTool: string;

  templateId?: string;
  ruleProfileId?: string;
  enabledRuleIds?: string[];
  customRulesText?: string;
  acceptanceCriteriaPresetId?: string;
  acceptanceCriteriaText?: string;
}

export interface OllamaStatus {
  online: boolean;
  url: string;
  message: string;
}

export interface OllamaModel {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
}

export type AiProviderId =
  "ollama" | "openai-compatible" | "anthropic" | "gemini";

export interface AiProviderStatus {
  provider: AiProviderId;
  online: boolean;
  url: string;
  model: string | null;
  apiKeyConfigured: boolean;
  message: string;
}

export interface AiProviderModel {
  id: string;
  name: string;
  provider: AiProviderId;
  size?: number;
  modifiedAt?: string;
  description?: string;
}

export interface GitHubIntegrationStatus {
  configured: boolean;
  connected: boolean;
  login: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastCheckedAt: string | null;
  message: string;
}

export interface GitHubDeviceAuthStart {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  expiresAt: string;
}

export type GitHubAuthPollResult =
  | {
      state: "pending";
      interval: number;
      message: string;
    }
  | {
      state: "slow_down";
      interval: number;
      message: string;
    }
  | {
      state: "connected";
      status: GitHubIntegrationStatus;
      message: string;
    }
  | {
      state: "expired" | "denied" | "failed";
      message: string;
      code?: string;
    };

export interface GitHubRepositoryLink {
  projectId: number;
  projectName: string;
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string | null;
  currentBranch: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  private: boolean;
  visibility: string;
  description: string | null;
  language: string | null;
  fork: boolean;
  pushedAt: string | null;
  updatedAt: string | null;
  linkedAt: string;
  lastCheckedAt: string;
  source: "remote-origin" | "manual";
}

export interface GitHubRepositoryLinkCandidate {
  projectId: number;
  projectName: string;
  projectPath: string;
  connected: boolean;
  isGitRepo: boolean;
  currentBranch: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  detectedOwner: string | null;
  detectedRepo: string | null;
  detectedFullName: string | null;
  detectedHtmlUrl: string | null;
  linked: GitHubRepositoryLink | null;
  canLink: boolean;
  message: string;
  warnings: string[];
}

export interface GitHubIssueLabel {
  id: number | null;
  name: string;
  color: string | null;
  description: string | null;
}

export interface GitHubIssueUser {
  login: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
}

export interface GitHubIssueReference {
  id: number;
  nodeId: string | null;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  htmlUrl: string;
  apiUrl: string | null;
  labels: GitHubIssueLabel[];
  author: GitHubIssueUser | null;
  assignees: GitHubIssueUser[];
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  locked: boolean;
}

export interface GitHubIssuesListResult {
  projectId: number;
  projectName: string;
  repository: GitHubRepositoryLink;
  issues: GitHubIssueReference[];
  state: "open" | "closed" | "all";
  search: string;
  labels: string[];
  total: number;
  message: string;
}

export interface AppSettings {
  ollamaUrl: string;
  generationMode: "template" | "ollama";
  aiProvider: AiProviderId;
  defaultTargetTool: TargetTool;
  defaultTaskType:
    | "general"
    | "ui"
    | "backend"
    | "fullstack"
    | "build"
    | "bugfix"
    | "refactor"
    | "docs"
    | "tests";
  defaultOllamaModel: string | null;
  openAiCompatibleBaseUrl: string;
  openAiCompatibleModel: string | null;
  openAiCompatibleApiKeyConfigured: boolean;
  geminiBaseUrl: string;
  geminiModel: string | null;
  geminiApiKeyConfigured: boolean;
  anthropicBaseUrl: string;
  anthropicModel: string | null;
  anthropicApiKeyConfigured: boolean;
  language: "system" | "en" | "ru";
  theme: "system" | "dark" | "light";
  composerFileLimits: {
    default: number;
    ui: number;
    backend: number;
    fullstack: number;
    build: number;
    bugfix: number;
    refactor: number;
    docs: number;
    tests: number;
  };
  contextQualityMode: "advisory" | "balanced" | "strict";
  selectorPipelineMode: SelectorPipelineMode;
  sidebarShowDescriptions: boolean;
  onboardingEnabled: boolean;
  onboardingShowEveryLaunch: boolean;
  onboardingCompleted: boolean;
}

export interface UpdateAppSettingsInput extends Partial<AppSettings> {
  openAiCompatibleApiKey?: string | null;
  clearOpenAiCompatibleApiKey?: boolean;
  geminiApiKey?: string | null;
  clearGeminiApiKey?: boolean;
  anthropicApiKey?: string | null;
  clearAnthropicApiKey?: boolean;
}

export interface GenerationMetadata {
  content: string;
  mode: "template" | "ollama";
  model: string | null;
  usedFallback: boolean;
  message: string;
  durationMs?: number;
  cached?: boolean;
}

export type WorkspaceSearchResultType = "project" | "taskPack" | "file";

export interface WorkspaceSearchResult {
  id: string;
  type: WorkspaceSearchResultType;
  title: string;
  subtitle: string;
  projectId?: number;
  projectName?: string;
  taskPackId?: number;
  absolutePath?: string;
  relativePath?: string;
  line?: number;
  snippet?: string;
  score: number;
}

export interface WorkspaceSearchResponse {
  query: string;
  results: WorkspaceSearchResult[];
}

export interface ContextComposerFileReference {
  path: string;
  kind: string;
  usage: string;
  reason: string;
  confidence: number;
  canReadText: boolean;
  sizeBytes: number;
}

export interface ContextSelectionQuality {
  status: "ready" | "warning" | "blocked";
  score: number;
  warnings: string[];
  blockingReasons: string[];
  requiredManualReview: boolean;
  signals?: {
    targetConfidence: number;
    scopeSafety: number;
    contextCompleteness: number;
    protectedScopeRisk: number;
    manualReviewReason: string | null;
    nextActions: string[];
  };
}

export interface ContextComposerSnippet {
  relativePath: string;
  language: string;
  content: string;
  truncated: boolean;
}

export interface ContextComposerPreview {
  project: {
    id: number;
    name: string;
    localPath: string;
    packageManager: string | null;
    detectedStack: string[];
    readinessScore: number;
  };
  task: {
    rawTask: string;
    requestedTaskType: string;
    effectiveTaskArea: string;
    targetTool: string;
  };
  taskIntent: {
    source: string;
    taskArea: string;
    riskLevel: string;
    confidence: number;
    intentTags: string[];
    domainTerms: string[];
    fileRoleHints: string[];
    structuredIntent?: {
      schemaVersion: 1;
      primaryTargets: Array<{
        kind: string;
        value: string;
        path?: string;
        routePath?: string;
        name?: string;
        confidence: number;
        evidence: string;
      }>;
      positiveActions: string[];
      protectedScopes: string[];
      allowedEditScope: string;
      needsStyles: boolean | null;
      needsBackend: boolean | null;
      ambiguities: string[];
      modelNotes: string[];
    };
  };
  fileSelection: {
    source: string;
    usedFallback: boolean;
    durationMs: number;
    rejectedModelPaths: string[];
    notes: string[];
    diagnostics?: {
      selectorVersion: string;
      safetyProfile: string;
      generationMode: "template" | "ollama";
      model: string | null;
      requestedTaskType: string;
      effectiveTaskArea: string;
      usedFallback: boolean;
    };
  };
  selectionQuality: ContextSelectionQuality;
  selectedFiles: ContextComposerFileReference[];
  suggestedFileGroups?: ContextComposerSuggestedFileGroup[];
  clarifyingQuestions?: string[];
  snippets: ContextComposerSnippet[];
  inventorySummary: {
    totalFiles: number;
    scannedFiles: number;
    truncated: boolean;
    notes: string[];
  };
  notes: string[];
  selectorDiagnostics?: SelectorPipelineDiagnostics;
}

export interface ContextComposerFileSearchResult extends ContextComposerFileReference {
  score: number;
  alreadySelected: boolean;
}

export interface ContextComposerFileSearchResponse {
  project: {
    id: number;
    name: string;
    localPath: string;
  };
  query: string;
  results: ContextComposerFileSearchResult[];
}

export interface ContextComposerSuggestedFileGroup {
  id: string;
  title: string;
  caption: string;
  files: ContextComposerFileReference[];
}

export interface ContextComposerFileSnippetResponse {
  file: ContextComposerFileReference;
  snippet: ContextComposerSnippet | null;
}
