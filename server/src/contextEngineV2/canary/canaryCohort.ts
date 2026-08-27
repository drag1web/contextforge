import { createHash } from "node:crypto";

import type {
  ContextEngineCanaryConfiguration,
  TaskPackCanaryCohortDecision,
} from "./canaryTypes.js";

const PROJECT_ID = /^[a-z0-9][a-z0-9_.:-]{0,79}$/iu;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeContextEngineCanaryPercent(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100
    ? value as number
    : 0;
}

export function normalizeContextEngineCanaryProjectIds(value: unknown): string[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) return [];
  const normalized = value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const projectId = entry.trim();
    return PROJECT_ID.test(projectId) ? [projectId] : [];
  });
  return Object.freeze([...new Set(normalized)].sort((left, right) => left.localeCompare(right))) as string[];
}

export function normalizeContextEngineCanaryConfiguration(input: {
  percent: unknown;
  projectIds: unknown;
}): ContextEngineCanaryConfiguration {
  return Object.freeze({
    percent: normalizeContextEngineCanaryPercent(input.percent),
    projectIds: normalizeContextEngineCanaryProjectIds(input.projectIds),
  });
}

export function decideTaskPackCanaryCohort(input: {
  projectId: string;
  taskFingerprint: string;
  snapshotFingerprint: string;
  configuration: ContextEngineCanaryConfiguration;
}): TaskPackCanaryCohortDecision {
  const configuration = normalizeContextEngineCanaryConfiguration(input.configuration);
  const basis = JSON.stringify({
    projectId: input.projectId,
    taskFingerprint: input.taskFingerprint,
    snapshotFingerprint: input.snapshotFingerprint,
  });
  const digest = sha256(basis);
  const decisionBasisDigest = sha256(JSON.stringify({
    samplingBasis: basis,
    configuredPercent: configuration.percent,
    projectIds: configuration.projectIds,
  }));
  const bucket = Number.parseInt(digest.slice(0, 8), 16) % 10_000;
  const allowlisted = configuration.projectIds.includes(input.projectId);
  return Object.freeze({
    allowlisted,
    bucket,
    configuredPercent: configuration.percent,
    included: allowlisted || bucket < configuration.percent * 100,
    basisFingerprint: `sha256:${decisionBasisDigest}`,
  });
}
