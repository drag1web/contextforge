import type { SelectedTaskFileUsage } from "../ollama/taskFileSelector.js";
import type { CandidateRetrievalResult, RetrievedCandidate } from "./candidateRetrieval.js";
import { assembleContextCandidates } from "./contextAssemblyEngine.js";

export interface CandidateRankingSelection {
  candidateId: string;
  usage: SelectedTaskFileUsage;
  reason: string;
  confidence: number;
}

export interface CandidateRankingPayload {
  selected: CandidateRankingSelection[];
  manualReview: boolean;
  reason: string;
}

export interface CandidateUsageAdjustment {
  candidateId: string;
  requestedUsage: SelectedTaskFileUsage;
  appliedUsage: SelectedTaskFileUsage;
  reason: string;
}

export interface ValidatedCandidateRanking {
  selected: Array<CandidateRankingSelection & { path: string }>;
  manualReview: boolean;
  reason: string;
  unknownCandidateIds: string[];
  usageAdjustments: CandidateUsageAdjustment[];
  valid: boolean;
}

interface CandidateRankingValidationOptions {
  trustedEditCandidateIds?: ReadonlySet<string>;
}

const VALID_USAGES = new Set<SelectedTaskFileUsage>([
  "inspect-and-edit", "create-and-edit", "inspect-only", "asset-reference", "config-reference",
]);

function clampUsageToCandidate(
  candidate: RetrievedCandidate,
  requestedUsage: SelectedTaskFileUsage,
  trustedEdit = false,
): { usage: SelectedTaskFileUsage; adjustment?: CandidateUsageAdjustment } {
  const proposed = candidate.proposedUsage;
  const trustedEditable =
    trustedEdit &&
    candidate.file.kind !== "asset" &&
    candidate.file.kind !== "runtime" &&
    candidate.file.kind !== "data" &&
    requestedUsage === "inspect-and-edit";
  const roleCappedUsage = trustedEditable
    ? "inspect-and-edit"
    : candidate.proposedTechnicalRole === "primary" || candidate.explicit
      ? proposed
      : proposed === "config-reference" || proposed === "asset-reference"
        ? proposed
        : "inspect-only";
  const isEscalation =
    requestedUsage === "create-and-edit" ||
    (requestedUsage === "inspect-and-edit" && roleCappedUsage !== "inspect-and-edit");

  if (isEscalation) {
    return {
      usage: roleCappedUsage,
      adjustment: {
        candidateId: candidate.candidateId,
        requestedUsage,
        appliedUsage: roleCappedUsage,
        reason: `Usage escalation was capped by retrieval evidence (${roleCappedUsage}).`,
      },
    };
  }

  if (candidate.file.kind === "asset" && requestedUsage !== "asset-reference") {
    return {
      usage: "asset-reference",
      adjustment: {
        candidateId: candidate.candidateId,
        requestedUsage,
        appliedUsage: "asset-reference",
        reason: "Asset candidates cannot be promoted to editable text context.",
      },
    };
  }

  if (roleCappedUsage === "config-reference" && requestedUsage !== "config-reference" && requestedUsage !== "inspect-only") {
    return {
      usage: "config-reference",
      adjustment: {
        candidateId: candidate.candidateId,
        requestedUsage,
        appliedUsage: "config-reference",
        reason: "Configuration reference candidates require explicit retrieval evidence before editing.",
      },
    };
  }

  if (!trustedEditable && candidate.proposedTechnicalRole !== "primary" && !candidate.explicit && requestedUsage === "inspect-and-edit") {
    return {
      usage: "inspect-only",
      adjustment: {
        candidateId: candidate.candidateId,
        requestedUsage,
        appliedUsage: "inspect-only",
        reason: "Supporting candidates cannot become edit targets without primary retrieval evidence.",
      },
    };
  }

  return { usage: requestedUsage };
}

function normalizeConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

export function validateCandidateRanking(
  value: unknown,
  candidates: RetrievedCandidate[],
  options: CandidateRankingValidationOptions = {},
): ValidatedCandidateRanking {
  const candidateMap = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rows = Array.isArray(data.selected) ? data.selected : [];
  const selected: ValidatedCandidateRanking["selected"] = [];
  const unknownCandidateIds: string[] = [];
  const usageAdjustments: CandidateUsageAdjustment[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const candidateId = String(record.candidateId ?? "").trim();
    if (!candidateId || seen.has(candidateId)) continue;
    seen.add(candidateId);
    const candidate = candidateMap.get(candidateId);
    if (!candidate) {
      unknownCandidateIds.push(candidateId);
      continue;
    }
    const requestedUsage = String(record.usage ?? candidate.proposedUsage) as SelectedTaskFileUsage;
    const normalizedUsage = VALID_USAGES.has(requestedUsage) ? requestedUsage : candidate.proposedUsage;
    const constrained = clampUsageToCandidate(
      candidate,
      normalizedUsage,
      options.trustedEditCandidateIds?.has(candidateId) ?? false,
    );
    if (constrained.adjustment) usageAdjustments.push(constrained.adjustment);
    selected.push({
      candidateId,
      path: candidate.path,
      usage: constrained.usage,
      reason: String(record.reason ?? candidate.evidence.join("; ")).slice(0, 500),
      confidence: normalizeConfidence(record.confidence),
    });
  }

  return {
    selected,
    manualReview: Boolean(data.manualReview) || (selected.length === 0 && candidates.length > 0),
    reason: String(data.reason ?? "").slice(0, 500),
    unknownCandidateIds,
    usageAdjustments,
    valid: unknownCandidateIds.length === 0 && usageAdjustments.length === 0 && Array.isArray(data.selected),
  };
}

function defaultSelectionLimit(retrieval: CandidateRetrievalResult) {
  if (retrieval.reviewOnly) return 5;
  if (retrieval.implementationArea === "docs") return 5;
  if (retrieval.implementationArea === "tests") return 6;
  if (retrieval.implementationArea === "ui") return 6;
  if (retrieval.implementationArea === "backend") return 7;
  if (retrieval.implementationArea === "fullstack") return 8;
  return 7;
}

const FRONTEND_ROLES = new Set([
  "page", "component", "ui-component", "layout", "style", "hook", "client-api", "app-entry",
]);

const BACKEND_ROLES = new Set([
  "api-route", "service", "repository", "db-schema", "store", "server-entry",
]);

const BACKEND_ENTRY_ROLES = new Set(["api-route", "server-entry"]);
const BACKEND_LOGIC_ROLES = new Set(["service"]);
const PERSISTENCE_ROLES = new Set(["repository", "db-schema", "store"]);
const FRONTEND_PRIMARY_ROLES = new Set([
  "page", "component", "ui-component", "hook", "client-api", "app-entry",
]);

function isTestCandidate(candidate: RetrievedCandidate) {
  return candidate.file.kind === "test" || candidate.file.role === "test";
}

function isPageCandidate(candidate: RetrievedCandidate) {
  return candidate.file.role === "page";
}

function evidencePriority(candidate: RetrievedCandidate) {
  return (
    Number(candidate.explicit) * 100_000 +
    Number(candidate.roleIntentMatch) * 10_000 +
    candidate.filenameMatchCount * 3_000 +
    candidate.identityMatchCount * 1_000 +
    Number(candidate.channels.includes("exact-filename")) * 800 +
    Number(candidate.channels.includes("lexical-path")) * 400 +
    candidate.graphRelationships.length * 40 +
    candidate.score
  );
}

function isRelatedToAny(candidate: RetrievedCandidate, anchorPaths: Set<string>) {
  return candidate.graphRelationships.some((relationship) =>
    anchorPaths.has(relationship.relatedPath.toLowerCase()),
  );
}

function sharedPathPrefixDepth(pathValue: string, anchorPaths: Set<string>) {
  const parts = pathValue.toLowerCase().split("/").filter(Boolean);
  let best = 0;
  for (const anchorPath of anchorPaths) {
    const anchorParts = anchorPath.toLowerCase().split("/").filter(Boolean);
    let depth = 0;
    while (depth < parts.length && depth < anchorParts.length && parts[depth] === anchorParts[depth]) {
      depth += 1;
    }
    best = Math.max(best, depth);
  }
  return best;
}

function parentDirectory(pathValue: string) {
  const normalized = pathValue.toLowerCase().replace(/\\/g, "/").replace(/^\.\//, "");
  const separator = normalized.lastIndexOf("/");
  return separator >= 0 ? normalized.slice(0, separator) : "";
}

function isInSameDirectoryAsAny(pathValue: string, anchorPaths: Set<string>) {
  const directory = parentDirectory(pathValue);
  for (const anchorPath of anchorPaths) {
    if (directory === parentDirectory(anchorPath)) return true;
  }
  return false;
}

function supportPriority(candidate: RetrievedCandidate, anchorPaths: Set<string>) {
  return (
    Number(isRelatedToAny(candidate, anchorPaths)) * 20_000 +
    Number(isInSameDirectoryAsAny(candidate.path, anchorPaths)) * 4_000 +
    sharedPathPrefixDepth(candidate.path, anchorPaths) * 900 +
    Number(candidate.channels.includes("exact-filename")) * 11_000 +
    candidate.filenameMatchCount * 4_500 +
    candidate.identityMatchCount * 2_200 +
    Number(candidate.channels.includes("lexical-path")) * 600 +
    candidate.graphRelationships.length * 80 +
    candidate.score
  );
}

function sortByEvidence(candidates: RetrievedCandidate[]) {
  return [...candidates].sort((a, b) =>
    evidencePriority(b) - evidencePriority(a) ||
    b.score - a.score ||
    a.path.localeCompare(b.path),
  );
}

function isGroundedSelectionCandidate(
  candidate: RetrievedCandidate,
  retrieval: CandidateRetrievalResult,
  topScore: number,
) {
  if (candidate.explicit) return true;
  const relativeThreshold = Math.max(32, topScore * 0.62);
  const hasGraphEvidence = candidate.graphRelationships.length > 0;
  const hasLexicalEvidence =
    candidate.channels.includes("exact-filename") ||
    candidate.channels.includes("lexical-path");
  const primary = candidate.proposedTechnicalRole === "primary";

  if (retrieval.implementationArea !== "tests" && isTestCandidate(candidate)) {
    const supportsChange =
      ["bugfix", "refactor"].includes(retrieval.implementationArea) &&
      hasGraphEvidence &&
      candidate.score >= 36;
    return supportsChange;
  }
  if (retrieval.implementationArea === "docs") {
    return (
      candidate.channels.includes("docs-config") ||
      (hasLexicalEvidence && candidate.score >= 42) ||
      (hasGraphEvidence && candidate.score >= 56)
    );
  }
  if (retrieval.implementationArea === "tests") {
    return (
      isTestCandidate(candidate) ||
      candidate.filenameMatchCount > 0 ||
      candidate.identityMatchCount > 0 ||
      (hasGraphEvidence && candidate.score >= 54)
    );
  }
  if (primary) return candidate.score >= Math.max(34, topScore * 0.44);
  return candidate.score >= relativeThreshold || (hasGraphEvidence && candidate.score >= 58);
}

function choosePrimaryAnchors(
  grounded: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
) {
  const primary = sortByEvidence(
    grounded.filter((candidate) =>
      candidate.explicit || candidate.proposedTechnicalRole === "primary",
    ),
  );

  if (retrieval.implementationArea === "tests") {
    const tests = primary.filter(isTestCandidate);
    return tests.slice(0, Math.max(2, tests.filter((candidate) => candidate.explicit).length));
  }

  if (retrieval.implementationArea === "ui") {
    const pages = primary.filter(isPageCandidate);
    const anchors: RetrievedCandidate[] = [];
    if (pages[0]) anchors.push(pages[0]);

    const anchorPaths = new Set(anchors.map((candidate) => candidate.path.toLowerCase()));
    const nonPage = primary.filter((candidate) => {
      if (isPageCandidate(candidate)) return false;
      if (candidate.explicit || candidate.roleIntentMatch) return true;
      if (candidate.filenameMatchCount > 0 || candidate.identityMatchCount >= 2) return true;
      return isRelatedToAny(candidate, anchorPaths);
    });
    anchors.push(...nonPage.slice(0, Math.max(0, 3 - anchors.length)));
    return anchors;
  }

  if (retrieval.implementationArea === "fullstack") {
    const backend = primary.find((candidate) => BACKEND_ROLES.has(candidate.file.role));
    const frontend = primary.find((candidate) => FRONTEND_ROLES.has(candidate.file.role));
    const anchors = [backend, frontend].filter(
      (candidate): candidate is RetrievedCandidate => Boolean(candidate),
    );
    const seen = new Set(anchors.map((candidate) => candidate.candidateId));
    for (const candidate of primary) {
      if (anchors.length >= 4) break;
      if (seen.has(candidate.candidateId)) continue;
      anchors.push(candidate);
      seen.add(candidate.candidateId);
    }
    return anchors;
  }

  if (retrieval.implementationArea === "backend") {
    const backendPrimary = primary.filter((candidate) => BACKEND_ROLES.has(candidate.file.role));
    const anchors: RetrievedCandidate[] = [];
    const seen = new Set<string>();
    const add = (candidate: RetrievedCandidate | undefined) => {
      if (!candidate || seen.has(candidate.candidateId) || anchors.length >= 4) return;
      anchors.push(candidate);
      seen.add(candidate.candidateId);
    };

    add(backendPrimary.find((candidate) => BACKEND_ENTRY_ROLES.has(candidate.file.role)));
    add(backendPrimary.find((candidate) => BACKEND_LOGIC_ROLES.has(candidate.file.role)));
    add(backendPrimary.find((candidate) => PERSISTENCE_ROLES.has(candidate.file.role)));

    const hasStrongIdentityAnchor = anchors.some((candidate) =>
      candidate.explicit ||
      candidate.identityMatchCount > 0
    );
    if (!hasStrongIdentityAnchor) {
      add(backendPrimary.find((candidate) => !seen.has(candidate.candidateId)));
    }

    for (const candidate of backendPrimary) {
      if (anchors.length >= 2) break;
      add(candidate);
    }
    return anchors;
  }

  if (retrieval.implementationArea === "docs") {
    const docs = primary.filter((candidate) => candidate.file.kind === "docs");
    const explicitDocs = docs.filter((candidate) => candidate.explicit);
    if (explicitDocs.length > 1) return explicitDocs.slice(0, 2);
    return docs.slice(0, 1);
  }

  return primary.slice(0, 3);
}

function bestCoverageCandidate(
  candidates: RetrievedCandidate[],
  roles: Set<string>,
  anchorPaths: Set<string>,
  minimumScore: number,
) {
  const coverageResponsibilityPriority = (candidate: RetrievedCandidate) => {
    const pathValue = candidate.path.toLowerCase();
    if (/(?:^|\/)(?:queries?|repositories?|services?|types?)(?:[./]|$)/.test(pathValue)) return 1_200;
    if (/(?:^|\/)(?:database|storage|schema)(?:[./]|$)/.test(pathValue)) return 600;
    if (/(?:^|\/)(?:migrate|migrations?)(?:[./]|$)/.test(pathValue)) return -800;
    return 0;
  };
  return [...candidates]
    .filter((candidate) => roles.has(candidate.file.role))
    .filter((candidate) =>
      candidate.explicit ||
      candidate.roleIntentMatch ||
      candidate.filenameMatchCount > 0 ||
      candidate.identityMatchCount > 0 ||
      candidate.graphRelationships.length > 0 ||
      candidate.score >= minimumScore
    )
    .sort((a, b) =>
      coverageResponsibilityPriority(b) - coverageResponsibilityPriority(a) ||
      supportPriority(b, anchorPaths) - supportPriority(a, anchorPaths) ||
      b.score - a.score ||
      a.path.localeCompare(b.path)
    )[0];
}

function addCoverageCandidate(
  result: RetrievedCandidate[],
  selectedIds: Set<string>,
  candidate: RetrievedCandidate | undefined,
  selectionLimit: number,
) {
  if (!candidate || result.length >= selectionLimit || selectedIds.has(candidate.candidateId)) return;
  result.push(candidate);
  selectedIds.add(candidate.candidateId);
}

function docsSupportResponsibilityPriority(candidate: RetrievedCandidate) {
  const fileName = candidate.file.name.toLowerCase();
  if (/^(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|composer\.json|gemfile|requirements(?:-dev)?\.txt)$/.test(fileName)) {
    return 5_000;
  }
  if (/^(?:\.env|env)[._-](?:example|sample|template)$/.test(fileName)) return 4_500;
  if (/^docker-compose(?:\.[^.]+)?\.ya?ml$/.test(fileName)) return 2_500;
  if (/(?:lock|lockb)$/.test(fileName)) return -1_000;
  return 0;
}

function bestDocsSupportCandidates(
  candidates: RetrievedCandidate[],
  anchorPaths: Set<string>,
  limit: number,
) {
  return [...candidates]
    .filter((candidate) => candidate.file.kind === "config" || candidate.file.role === "config")
    .sort((a, b) =>
      Number(isInSameDirectoryAsAny(b.path, anchorPaths)) * 20_000 -
      Number(isInSameDirectoryAsAny(a.path, anchorPaths)) * 20_000 ||
      docsSupportResponsibilityPriority(b) - docsSupportResponsibilityPriority(a) ||
      supportPriority(b, anchorPaths) - supportPriority(a, anchorPaths) ||
      b.score - a.score ||
      a.path.localeCompare(b.path)
    )
    .slice(0, limit);
}

function retainLayerCoverage(
  result: RetrievedCandidate[],
  selectedIds: Set<string>,
  retrieval: CandidateRetrievalResult,
  selectionLimit: number,
) {
  const anchorPaths = new Set(result.map((candidate) => candidate.path.toLowerCase()));
  const pool = retrieval.candidates.filter((candidate) => !selectedIds.has(candidate.candidateId));
  const selectedRoles = new Set(result.map((candidate) => candidate.file.role));
  const topScore = retrieval.candidates[0]?.score ?? 0;
  const supportFloor = Math.max(30, topScore * 0.38);

  if (retrieval.implementationArea === "docs") {
    for (const candidate of bestDocsSupportCandidates(pool, anchorPaths, 2)) {
      addCoverageCandidate(result, selectedIds, candidate, selectionLimit);
    }
  }

  if (retrieval.implementationArea === "backend") {
    const hasEntry = result.some((candidate) => BACKEND_ENTRY_ROLES.has(candidate.file.role));
    const hasLogic = result.some((candidate) => BACKEND_LOGIC_ROLES.has(candidate.file.role));
    const hasPersistence = result.some((candidate) => PERSISTENCE_ROLES.has(candidate.file.role));

    if (hasEntry && !hasLogic) {
      addCoverageCandidate(
        result,
        selectedIds,
        bestCoverageCandidate(pool, BACKEND_LOGIC_ROLES, anchorPaths, supportFloor),
        selectionLimit,
      );
    }

    if (hasEntry && !hasPersistence) {
      const persistence = bestCoverageCandidate(pool, PERSISTENCE_ROLES, anchorPaths, supportFloor + 8);
      if (persistence?.roleIntentMatch || persistence?.graphRelationships.length || persistence?.identityMatchCount) {
        addCoverageCandidate(result, selectedIds, persistence, selectionLimit);
      }
    }

    if (hasPersistence && !hasEntry) {
      addCoverageCandidate(
        result,
        selectedIds,
        bestCoverageCandidate(pool, BACKEND_ENTRY_ROLES, anchorPaths, supportFloor),
        selectionLimit,
      );
    }
  }

  if (retrieval.implementationArea === "fullstack") {
    if (![...selectedRoles].some((role) => BACKEND_ENTRY_ROLES.has(role))) {
      addCoverageCandidate(
        result,
        selectedIds,
        bestCoverageCandidate(pool, BACKEND_ENTRY_ROLES, anchorPaths, supportFloor),
        selectionLimit,
      );
    }

    if (![...selectedRoles].some((role) => FRONTEND_PRIMARY_ROLES.has(role))) {
      addCoverageCandidate(
        result,
        selectedIds,
        bestCoverageCandidate(pool, FRONTEND_PRIMARY_ROLES, anchorPaths, supportFloor),
        selectionLimit,
      );
    }

    addCoverageCandidate(
      result,
      selectedIds,
      bestCoverageCandidate(pool, PERSISTENCE_ROLES, anchorPaths, supportFloor),
      selectionLimit,
    );
  }

  if (retrieval.implementationArea === "tests") {
    addCoverageCandidate(
      result,
      selectedIds,
      [...pool]
        .filter((candidate) => !isTestCandidate(candidate))
        .sort((a, b) =>
          supportPriority(b, anchorPaths) - supportPriority(a, anchorPaths) ||
          b.score - a.score ||
          a.path.localeCompare(b.path)
        )[0],
      selectionLimit,
    );
  }
}

function chooseAreaAwareCandidates(
  grounded: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
  selectionLimit: number,
) {
  const anchors = choosePrimaryAnchors(grounded, retrieval);
  const selectedIds = new Set(anchors.map((candidate) => candidate.candidateId));
  const anchorPaths = new Set(anchors.map((candidate) => candidate.path.toLowerCase()));

  let supportPool = grounded.filter((candidate) => !selectedIds.has(candidate.candidateId));

  if (retrieval.implementationArea === "ui" && anchors.some(isPageCandidate)) {
    supportPool = supportPool.filter((candidate) =>
      !isPageCandidate(candidate) ||
      candidate.explicit ||
      isRelatedToAny(candidate, anchorPaths),
    );
  }

  if (retrieval.implementationArea === "tests") {
    supportPool.sort((a, b) =>
      supportPriority(b, anchorPaths) - supportPriority(a, anchorPaths) ||
      b.score - a.score ||
      a.path.localeCompare(b.path),
    );
  } else {
    supportPool.sort((a, b) =>
      supportPriority(b, anchorPaths) - supportPriority(a, anchorPaths) ||
      b.score - a.score ||
      a.path.localeCompare(b.path),
    );
  }

  const result = [...anchors];
  retainLayerCoverage(result, selectedIds, retrieval, selectionLimit);
  for (const candidate of supportPool) {
    if (result.length >= selectionLimit) break;
    if (selectedIds.has(candidate.candidateId)) continue;
    result.push(candidate);
    selectedIds.add(candidate.candidateId);
  }
  return {
    candidates: result,
    anchorIds: new Set(anchors.map((candidate) => candidate.candidateId)),
  };
}

function effectiveCandidateRole(candidate: RetrievedCandidate) {
  const pathValue = candidate.path.toLowerCase().replace(/\\/g, "/");
  const fileName = candidate.file.name.toLowerCase();
  const fileStem = fileName.replace(/\.[^.]+$/, "");
  if (/^layout\.(?:tsx|jsx|ts|js)$/.test(fileName)) return "layout";
  if (/(?:^|\/)(?:types?|contracts?|models?)(?:\/|$)/.test(pathValue)) return "types";
  if (/(?:^|\/)(?:utils|utilities|helpers|lib)(?:\/|$)/.test(pathValue)) {
    if (/(?:api|client)$/.test(fileStem)) return "client-api";
    return "utility";
  }
  if (/(?:^|\/)services?(?:\/|$)/.test(pathValue)) {
    if (/(?:^|\/)(?:web|client|frontend|renderer)(?:\/|$)/.test(pathValue)) return "client-api";
    return "service";
  }
  if (
    (pathValue.startsWith("server/") || pathValue.includes("/server/")) &&
    /^(?:auth|session|queue|worker|processor|provider|manager|ai)$/.test(fileStem)
  ) return "service";
  if (
    /(?:^|\/)(?:db|database|storage|repositories?|persistence)(?:\/|$)/.test(pathValue) &&
    /(?:quer(?:y|ies)|repository|database|storage|schema|model|adapter)/.test(fileName)
  ) return "repository";
  return candidate.file.role;
}

function anchorCanEdit(candidate: RetrievedCandidate, retrieval: CandidateRetrievalResult) {
  if (["asset", "runtime", "data", "unknown"].includes(candidate.file.kind)) return false;
  const role = effectiveCandidateRole(candidate);
  if (retrieval.implementationArea === "ui") return FRONTEND_ROLES.has(role);
  if (retrieval.implementationArea === "backend") return BACKEND_ROLES.has(role) || role === "types";
  if (retrieval.implementationArea === "fullstack") return FRONTEND_ROLES.has(role) || BACKEND_ROLES.has(role) || role === "types";
  if (retrieval.implementationArea === "tests") return isTestCandidate(candidate);
  if (retrieval.implementationArea === "docs") return candidate.file.kind === "docs" || role === "docs";
  if (retrieval.implementationArea === "build") return candidate.file.kind === "config" || role === "config" || role === "app-entry" || role === "server-entry";
  if (retrieval.implementationArea === "bugfix" || retrieval.implementationArea === "refactor") return candidate.file.kind === "source" || candidate.file.kind === "style";
  return candidate.file.kind === "source" || candidate.file.kind === "style";
}

function deterministicUsage(
  candidate: RetrievedCandidate,
  retrieval: CandidateRetrievalResult,
  anchorIds: Set<string>,
): SelectedTaskFileUsage {
  if (retrieval.reviewOnly) return "inspect-only";
  if (anchorIds.has(candidate.candidateId) && anchorCanEdit(candidate, retrieval)) {
    return "inspect-and-edit";
  }
  if (!anchorIds.has(candidate.candidateId) && !candidate.explicit) {
    if (
      candidate.proposedUsage === "config-reference" ||
      candidate.proposedUsage === "asset-reference"
    ) {
      return candidate.proposedUsage;
    }
    return "inspect-only";
  }
  if (candidate.proposedTechnicalRole !== "primary" && !candidate.explicit) {
    if (
      candidate.proposedUsage === "config-reference" ||
      candidate.proposedUsage === "asset-reference"
    ) {
      return candidate.proposedUsage;
    }
    return "inspect-only";
  }
  return candidate.proposedUsage;
}

function roleLabel(candidate: RetrievedCandidate) {
  const role = effectiveCandidateRole(candidate);
  if (role === "page") return "page";
  if (role === "component" || role === "ui-component") return "UI component";
  if (role === "layout") return "layout";
  if (role === "style") return "style file";
  if (role === "hook") return "hook";
  if (role === "client-api") return "client API module";
  if (role === "api-route") return "API route";
  if (role === "service") return "service";
  if (role === "repository") return "repository";
  if (role === "db-schema" || role === "store") return "storage module";
  if (role === "types") return "shared types file";
  if (role === "test") return "test file";
  if (role === "docs") return "documentation file";
  if (role === "config") return "configuration file";
  return "project file";
}

function hasDirectSupportRelationship(candidate: RetrievedCandidate, anchorPaths: ReadonlySet<string>) {
  return candidate.graphRelationships.some((relationship) => anchorPaths.has(relationship.relatedPath.toLowerCase()) && [
    "service-import",
    "utility-import",
    "storage-import",
    "types-import",
    "client-api-import",
    "hook-import",
    "component-import",
    "style-import",
    "route-local",
    "test-target",
    "proposed-test",
    "import",
  ].includes(relationship.kind));
}

function humanSelectionReason(
  candidate: RetrievedCandidate,
  usage: SelectedTaskFileUsage,
  anchorIds: Set<string>,
  anchorPaths: ReadonlySet<string>,
) {
  const label = roleLabel(candidate);
  if (candidate.explicit) {
    return `Explicitly named in the task and confirmed as a real ${label} in the project inventory.`;
  }
  if (anchorIds.has(candidate.candidateId)) {
    if (candidate.filenameMatchCount > 0 || candidate.identityMatchCount > 0) {
      return `Primary ${label} whose path, name, or symbols directly match the task target.`;
    }
    if (candidate.roleIntentMatch) {
      return `Primary ${label} whose technical responsibility matches the requested change.`;
    }
    return `Primary ${label} selected from the strongest grounded project evidence.`;
  }
  if (hasDirectSupportRelationship(candidate, anchorPaths)) {
    return `Supporting ${label} directly connected to the primary target through project imports or structural relationships.`;
  }
  if (candidate.filenameMatchCount > 0 || candidate.identityMatchCount > 0) {
    return `Supporting ${label} that shares task-specific names or symbols with the requested change.`;
  }
  if (usage === "config-reference" || usage === "asset-reference") {
    return `Reference ${label} included only to preserve relevant project configuration or asset context.`;
  }
  return `Supporting ${label} retained as contextual evidence for the selected implementation target.`;
}

export function deterministicCandidateRanking(
  retrieval: CandidateRetrievalResult,
  maxSelected?: number,
): ValidatedCandidateRanking {
  if (retrieval.blocked || retrieval.manualReview) {
    return {
      selected: [],
      manualReview: retrieval.manualReview,
      reason: retrieval.warnings.join(" "),
      unknownCandidateIds: [],
      usageAdjustments: [],
      valid: true,
    };
  }

  const topScore = retrieval.candidates[0]?.score ?? 0;
  const selectionLimit = maxSelected ?? defaultSelectionLimit(retrieval);
  const grounded = retrieval.candidates.filter((candidate) =>
    isGroundedSelectionCandidate(candidate, retrieval, topScore),
  );
  const ranked = assembleContextCandidates(grounded, retrieval, selectionLimit);
  const anchorPaths = new Set(
    ranked.candidates
      .filter((candidate) => ranked.anchorIds.has(candidate.candidateId))
      .map((candidate) => candidate.path.toLowerCase()),
  );
  const payload: CandidateRankingPayload = {
    selected: ranked.candidates.map((candidate) => {
      const usage = deterministicUsage(candidate, retrieval, ranked.anchorIds);
      return {
        candidateId: candidate.candidateId,
        usage,
        reason: humanSelectionReason(candidate, usage, ranked.anchorIds, anchorPaths),
        confidence: Math.max(0.25, Math.min(0.92, candidate.score / 180)),
      };
    }),
    manualReview: ranked.candidates.length === 0,
    reason:
      ranked.candidates.length > 0
        ? "Deterministic shadow ranking from grounded evidence, area coverage, and role caps."
        : "No candidate passed the deterministic ranking threshold.",
  };
  return validateCandidateRanking(payload, retrieval.candidates, {
    trustedEditCandidateIds: ranked.anchorIds,
  });
}
