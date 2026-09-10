import type { TFunction } from "i18next";

const FILE_KIND_KEYS: Readonly<Record<string, string>> = {
  source: "source",
  style: "style",
  test: "test",
  docs: "docs",
  config: "config",
  data: "data",
  asset: "asset",
  explicit_file: "explicitFile",
  unknown: "unknown",
};

const FILE_USAGE_KEYS: Readonly<Record<string, string>> = {
  "inspect-and-edit": "inspectAndEdit",
  "create-and-edit": "createAndEdit",
  "inspect-only": "inspectOnly",
  "asset-reference": "assetReference",
  "config-reference": "configReference",
};

const CONTEXT_ROLE_KEYS: Readonly<Record<string, string>> = {
  target: "target",
  test: "test",
  supporting: "supporting",
  reference: "reference",
};

export function formatContextFileKind(kind: string, t: TFunction) {
  const key = FILE_KIND_KEYS[kind];
  return key ? t(`contextFile.kind.${key}`) : kind;
}

export function formatContextFileUsage(usage: string, t: TFunction) {
  const key = FILE_USAGE_KEYS[usage];
  return key ? t(`contextFile.usage.${key}`) : usage;
}

export function formatContextFileRole(role: string, t: TFunction) {
  const key = CONTEXT_ROLE_KEYS[role];
  return key ? t(`contextFile.role.${key}`) : role;
}

export function formatContextFileSource(source: string, t: TFunction) {
  if (source === "legacy" || source === "v2" || source === "manual") {
    return t(`settings.composerEngineSource_${source}`);
  }
  return source;
}

export function formatEvidenceRole(role: string, t: TFunction) {
  if (role === "supports" || role === "contradicts" || role === "context_only") {
    return t(`settings.composerEngineEvidenceRole_${role}`);
  }
  return role;
}

export function formatEvidenceStrength(strength: string, t: TFunction) {
  if (
    strength === "lead"
    || strength === "corroborating"
    || strength === "substantial"
    || strength === "conclusive"
  ) {
    return t(`settings.composerEngineStrength_${strength}`);
  }
  return strength;
}
