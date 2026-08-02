import type { ContextComposerEngineMode } from "./composerTypes.js";

export function normalizeContextComposerEngineMode(
  value: unknown,
): ContextComposerEngineMode {
  return value === "shadow_compare" || value === "v2_primary" ? value : "legacy";
}
