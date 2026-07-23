import path from "node:path";

import type { ProjectInventory } from "../scanner/projectInventoryScanner.js";
import {
  classifyFileMentionSemanticRole,
  isExplicitFileCreationForbidden,
  resolveExplicitFileMentions,
} from "./explicitFileMentions.js";

export type ExplicitCreateWiringCoverageStatus =
  | "not-applicable"
  | "complete"
  | "incomplete";

export interface ExplicitCreateWiringRequirement {
  path: string;
  role: "create-target" | "wiring-target";
  expectedUsage: "create-and-edit" | "inspect-and-edit";
  inventoryStatus: "missing" | "existing" | "ambiguous";
}

export interface ExplicitCreateWiringGap {
  path: string;
  role: ExplicitCreateWiringRequirement["role"];
  expectedUsage: ExplicitCreateWiringRequirement["expectedUsage"];
  actualUsage: string | null;
  reason: string;
}

export interface ExplicitCreateWiringCoverageResult {
  status: ExplicitCreateWiringCoverageStatus;
  requirements: ExplicitCreateWiringRequirement[];
  gaps: ExplicitCreateWiringGap[];
  reasons: string[];
}

interface SelectedFileLike {
  path: string;
  usage: string;
}

interface VerifyExplicitCreateWiringCoverageInput {
  rawTask: string;
  inventory: ProjectInventory;
  selectedFiles: SelectedFileLike[];
}

function normalizePath(value: string) {
  return value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^["'`]+|["'`.,;:!?]+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function normalizeForCompare(value: string) {
  return normalizePath(value).toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueRequirements(values: ExplicitCreateWiringRequirement[]) {
  const seen = new Set<string>();
  const result: ExplicitCreateWiringRequirement[] = [];

  for (const value of values) {
    const key = `${value.role}:${normalizeForCompare(value.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function getMentionContexts(rawTask: string, rawMention: string) {
  const normalizedMention = normalizePath(rawMention);
  const fileName = path.basename(normalizedMention);
  const candidates = normalizedMention.includes("/")
    ? [normalizedMention, normalizedMention.replace(/\//g, "\\")]
    : [fileName];
  const contexts: Array<{ before: string; after: string }> = [];

  for (const candidate of candidates) {
    const matcher = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])(${escapeRegExp(candidate)})(?=$|[^\\p{L}\\p{N}_])`,
      "giu",
    );
    for (const match of rawTask.matchAll(matcher)) {
      const matched = match[1] ?? candidate;
      const start = (match.index ?? 0) + match[0].indexOf(matched);
      const end = start + matched.length;
      contexts.push({
        before: rawTask.slice(Math.max(0, start - 220), start),
        after: rawTask.slice(end, Math.min(rawTask.length, end + 220)),
      });
    }
    if (contexts.length > 0 && normalizedMention.includes("/")) break;
  }

  return contexts;
}

const CREATE_BEFORE =
  /(?:\b(?:create|add|introduce|generate|write|make|build|extract)\b|(?:созда|добав|введ|сгенерир|напиш|сдела|вынес)\p{L}*)[^.!?\n—]{0,90}$/iu;
const WIRING_BEFORE =
  /(?:(?:\b(?:render|wire|mount|register|import|connect|include|attach|plug)\b)[^.!?\n—]{0,130}\b(?:in|into|on|inside|within|to)\b|(?:отрендер|рендер|подключ|зарегистрир|импортир|встав|добав)\p{L}*[^.!?\n—]{0,130}(?:в|на|внутрь|к))\s*$/iu;
const WIRING_AFTER =
  /^\s*(?:,|;|—|-)?\s*(?:to\s+)?(?:render|wire|mount|register|import|connect|include|attach|plug|отрендер|рендер|подключ|зарегистрир|импортир|встав|добав)\p{L}*/iu;

function isExplicitCreateMention(rawTask: string, rawMention: string) {
  if (!normalizePath(rawMention).includes("/")) return false;
  if (isExplicitFileCreationForbidden(rawTask, rawMention)) return false;
  return getMentionContexts(rawTask, rawMention).some(({ before }) =>
    CREATE_BEFORE.test(before),
  );
}

function isExplicitWiringMention(rawTask: string, rawMention: string) {
  return getMentionContexts(rawTask, rawMention).some(
    ({ before, after }) =>
      WIRING_BEFORE.test(before) || WIRING_AFTER.test(after),
  );
}

function resolveExistingMentionPath(
  rawMention: string,
  matchedPath: string | undefined,
  inventory: ProjectInventory,
) {
  const normalized = normalizePath(rawMention);
  if (normalized.includes("/")) {
    return matchedPath
      ? { path: matchedPath, status: "existing" as const }
      : { path: normalized, status: "missing" as const };
  }

  const fileName = path.basename(normalized).toLowerCase();
  const matches = inventory.files.filter(
    (file) => path.basename(normalizePath(file.path)).toLowerCase() === fileName,
  );
  if (matches.length === 1) {
    return { path: matches[0]!.path, status: "existing" as const };
  }
  if (matches.length > 1) {
    return { path: normalized, status: "ambiguous" as const };
  }
  return { path: normalized, status: "missing" as const };
}

export function verifyExplicitCreateWiringCoverage(
  input: VerifyExplicitCreateWiringCoverageInput,
): ExplicitCreateWiringCoverageResult {
  const resolution = resolveExplicitFileMentions(
    input.rawTask,
    input.inventory,
  );
  const createRequirements: ExplicitCreateWiringRequirement[] = [];
  const wiringRequirements: ExplicitCreateWiringRequirement[] = [];

  for (const mention of resolution.mentions) {
    if (
      classifyFileMentionSemanticRole(input.rawTask, mention.raw) ===
      "artifact-reference"
    ) {
      continue;
    }

    if (isExplicitCreateMention(input.rawTask, mention.raw)) {
      if (!mention.matchedPath) {
        createRequirements.push({
          path: normalizePath(mention.raw),
          role: "create-target",
          expectedUsage: "create-and-edit",
          inventoryStatus: "missing",
        });
      }
      continue;
    }

    if (isExplicitWiringMention(input.rawTask, mention.raw)) {
      const resolved = resolveExistingMentionPath(
        mention.raw,
        mention.matchedPath,
        input.inventory,
      );
      wiringRequirements.push({
        path: resolved.path,
        role: "wiring-target",
        expectedUsage: "inspect-and-edit",
        inventoryStatus: resolved.status,
      });
    }
  }

  const requirements = uniqueRequirements([
    ...createRequirements,
    ...wiringRequirements,
  ]);
  if (createRequirements.length === 0 || wiringRequirements.length === 0) {
    return {
      status: "not-applicable",
      requirements,
      gaps: [],
      reasons: [
        "No narrow explicit create-plus-wiring contract was proven from named file targets.",
      ],
    };
  }

  const selectedByPath = new Map(
    input.selectedFiles.map((file) => [normalizeForCompare(file.path), file]),
  );
  const gaps: ExplicitCreateWiringGap[] = [];

  for (const requirement of requirements) {
    if (requirement.inventoryStatus === "ambiguous") {
      gaps.push({
        path: requirement.path,
        role: requirement.role,
        expectedUsage: requirement.expectedUsage,
        actualUsage: null,
        reason:
          "The explicitly named wiring filename resolves to more than one real inventory path.",
      });
      continue;
    }
    if (
      requirement.role === "wiring-target" &&
      requirement.inventoryStatus === "missing"
    ) {
      gaps.push({
        path: requirement.path,
        role: requirement.role,
        expectedUsage: requirement.expectedUsage,
        actualUsage: null,
        reason:
          "The explicitly named wiring target is absent from the real project inventory.",
      });
      continue;
    }

    const selected = selectedByPath.get(normalizeForCompare(requirement.path));
    if (!selected || selected.usage !== requirement.expectedUsage) {
      gaps.push({
        path: requirement.path,
        role: requirement.role,
        expectedUsage: requirement.expectedUsage,
        actualUsage: selected?.usage ?? null,
        reason: selected
          ? `The explicit ${requirement.role} is selected as ${selected.usage}, not ${requirement.expectedUsage}.`
          : `The explicit ${requirement.role} is missing from the final selection.`,
      });
    }
  }

  return {
    status: gaps.length === 0 ? "complete" : "incomplete",
    requirements,
    gaps,
    reasons:
      gaps.length === 0
        ? [
            "Every explicitly named create target and wiring target is retained with the required editable usage.",
          ]
        : [
            "Explicit create-plus-wiring coverage is incomplete; implementation authorization must remain investigative.",
            ...gaps.map((gap) => `${gap.path}: ${gap.reason}`),
          ],
  };
}
