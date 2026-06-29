import path from "node:path";

import type { ProjectInventory, ProjectInventoryFile } from "../scanner/projectInventoryScanner.js";

export interface ExplicitFileMention {
  raw: string;
  normalized: string;
  matchedPath?: string;
  matchKind?: "exact" | "absolute-suffix" | "relative-suffix" | "file-name" | "loose-src";
}

export interface ExplicitFileMentionResolution {
  mentions: ExplicitFileMention[];
  existingPaths: string[];
  missingPaths: string[];
}

const FILE_EXTENSION_PATTERN = "ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|json|md|mdx|txt|yml|yaml|toml|sql|prisma|graphql|gql|xml|svg";
const PATH_CHARS = "A-Za-z0-9_ .@()\\[\\]{}+~$!#%&=,;:'`^-";

function normalizePath(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
    .replace(/^['"`]+|['"`.,;:!?]+$/g, "")
    .replace(/\/+/g, "/");
}

function normalizeForCompare(value: string) {
  return normalizePath(value).toLowerCase();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = normalizeForCompare(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalizePath(value));
  }

  return out;
}

function looksLikeFilePath(value: string) {
  const normalized = normalizePath(value);
  if (!normalized) return false;
  if (!new RegExp(`\\.(${FILE_EXTENSION_PATTERN})$`, "i").test(normalized)) return false;
  // Avoid treating plain prose with spaces as a file path unless it has a slash.
  if (normalized.includes(" ") && !normalized.includes("/")) return false;
  return true;
}

function extractStrictPathMentions(rawTask: string) {
  const mentions: string[] = [];

  // Explicit slash/backslash paths, including Windows absolute paths.
  const slashPathRegex = new RegExp(
    `(?:^|[\\s(\\[{'\"\`])((?:[A-Za-z]:)?[${PATH_CHARS}]+(?:[\\\\/][${PATH_CHARS}]+)+\\.(?:${FILE_EXTENSION_PATTERN}))(?=$|[\\s)\\]}'\"\`,;:!?])`,
    "gi"
  );

  for (const match of rawTask.matchAll(slashPathRegex)) {
    if (match[1]) mentions.push(match[1]);
  }

  // Standalone filenames with extensions: App.js, README.md, package.json.
  const fileNameRegex = new RegExp(`\\b([A-Za-z0-9_@()\\[\\].-]+\\.(?:${FILE_EXTENSION_PATTERN}))\\b`, "gi");
  for (const match of rawTask.matchAll(fileNameRegex)) {
    if (match[1]) mentions.push(match[1]);
  }

  return mentions;
}

function extractLoosePathMentions(rawTask: string) {
  const mentions: string[] = [];

  // Human shorthand: "src app.js", "src app js", "components button.tsx".
  const looseRegex = new RegExp(
    `\\b(src|app|apps|client|server|components|component|pages|page|shared|lib|utils|styles|style|api)\\s+([A-Za-z0-9_@()\\[\\].-]+)(?:\\s+(${FILE_EXTENSION_PATTERN}))?\\b`,
    "gi"
  );

  for (const match of rawTask.matchAll(looseRegex)) {
    const folder = match[1];
    const name = match[2];
    const ext = match[3];
    if (!folder || !name) continue;

    const candidateName = name.includes(".") ? name : ext ? `${name}.${ext}` : name;
    if (!looksLikeFilePath(candidateName)) continue;
    mentions.push(`${folder}/${candidateName}`);
  }

  return mentions;
}

function getFileName(filePath: string) {
  return normalizePath(filePath).split("/").pop() ?? filePath;
}

function scoreFileNameMatch(file: ProjectInventoryFile) {
  const normalizedPath = normalizeForCompare(file.path);
  let score = 0;

  // Prefer app/source files over tests when a user names App.js.
  if (normalizedPath.includes(".test.") || normalizedPath.includes(".spec.")) score -= 50;
  if (normalizedPath.startsWith("src/")) score += 12;
  if (normalizedPath.includes("/components/")) score += 5;
  if (normalizedPath.endsWith("package.json")) score += 8;
  if (file.kind === "source") score += 10;
  if (file.kind === "docs") score += 7;
  if (file.kind === "config") score += 4;
  score -= Math.min(20, normalizePath(file.path).split("/").length);

  return score;
}

function findBestInventoryMatch(inventory: ProjectInventory, rawMention: string): ExplicitFileMention {
  const normalized = normalizePath(rawMention);
  const comparable = normalizeForCompare(normalized);
  const files = inventory.files;

  const exact = files.find((file) => normalizeForCompare(file.path) === comparable);
  if (exact) {
    return { raw: rawMention, normalized, matchedPath: exact.path, matchKind: "exact" };
  }

  const absoluteSuffix = files.find((file) => comparable.endsWith(`/${normalizeForCompare(file.path)}`));
  if (absoluteSuffix) {
    return { raw: rawMention, normalized, matchedPath: absoluteSuffix.path, matchKind: "absolute-suffix" };
  }

  const relativeSuffix = files.find((file) => normalizeForCompare(file.path).endsWith(`/${comparable}`));
  if (relativeSuffix) {
    return { raw: rawMention, normalized, matchedPath: relativeSuffix.path, matchKind: "relative-suffix" };
  }

  const mentionName = path.basename(normalized).toLowerCase();
  const sameFileName = files
    .filter((file) => getFileName(file.path).toLowerCase() === mentionName)
    .map((file) => ({ file, score: scoreFileNameMatch(file) }))
    .sort((a, b) => b.score - a.score)[0]?.file;

  if (sameFileName) {
    return { raw: rawMention, normalized, matchedPath: sameFileName.path, matchKind: "file-name" };
  }

  return { raw: rawMention, normalized };
}

export function resolveExplicitFileMentions(rawTask: string, inventory: ProjectInventory): ExplicitFileMentionResolution {
  const rawMentions = uniqueStrings([
    ...extractStrictPathMentions(rawTask),
    ...extractLoosePathMentions(rawTask)
  ]).filter(looksLikeFilePath);

  const mentions = rawMentions.map((mention) => findBestInventoryMatch(inventory, mention));

  return {
    mentions,
    existingPaths: uniqueStrings(mentions.map((mention) => mention.matchedPath ?? "").filter(Boolean)),
    missingPaths: uniqueStrings(mentions.filter((mention) => !mention.matchedPath).map((mention) => mention.raw))
  };
}
