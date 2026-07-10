import type { SelectedTaskFileUsage } from "../ollama/taskFileSelector.js";
import type { CandidateRetrievalResult, RetrievedCandidate } from "./candidateRetrieval.js";

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

const VALID_USAGES = new Set<SelectedTaskFileUsage>([
  "inspect-and-edit", "create-and-edit", "inspect-only", "asset-reference", "config-reference",
]);

function clampUsageToCandidate(
  candidate: RetrievedCandidate,
  requestedUsage: SelectedTaskFileUsage,
): { usage: SelectedTaskFileUsage; adjustment?: CandidateUsageAdjustment } {
  const proposed = candidate.proposedUsage;
  const roleCappedUsage =
    candidate.proposedTechnicalRole === "primary" || candidate.explicit
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

  if (candidate.proposedTechnicalRole !== "primary" && !candidate.explicit && requestedUsage === "inspect-and-edit") {
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
    const constrained = clampUsageToCandidate(candidate, normalizedUsage);
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

function supportPriority(candidate: RetrievedCandidate, anchorPaths: Set<string>) {
  return (
    Number(isRelatedToAny(candidate, anchorPaths)) * 20_000 +
    Number(candidate.channels.includes("exact-filename")) * 8_000 +
    candidate.filenameMatchCount * 3_000 +
    candidate.identityMatchCount * 1_200 +
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
    return primary.filter((candidate) => BACKEND_ROLES.has(candidate.file.role)).slice(0, 4);
  }

  if (retrieval.implementationArea === "docs") {
    return primary.filter((candidate) => candidate.file.kind === "docs").slice(0, 2);
  }

  return primary.slice(0, 3);
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
  for (const candidate of supportPool) {
    if (result.length >= selectionLimit) break;
    result.push(candidate);
  }
  return result;
}

function deterministicUsage(
  candidate: RetrievedCandidate,
  retrieval: CandidateRetrievalResult,
): SelectedTaskFileUsage {
  if (retrieval.reviewOnly) return "inspect-only";
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
  const ranked = chooseAreaAwareCandidates(grounded, retrieval, selectionLimit);
  const payload: CandidateRankingPayload = {
    selected: ranked.map((candidate) => ({
      candidateId: candidate.candidateId,
      usage: deterministicUsage(candidate, retrieval),
      reason:
        candidate.evidence.join("; ") ||
        "Grounded deterministic retrieval candidate.",
      confidence: Math.max(0.25, Math.min(0.92, candidate.score / 180)),
    })),
    manualReview: ranked.length === 0,
    reason:
      ranked.length > 0
        ? "Deterministic shadow ranking from grounded evidence, area coverage, and role caps."
        : "No candidate passed the deterministic ranking threshold.",
  };
  return validateCandidateRanking(payload, retrieval.candidates);
}
