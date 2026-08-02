import type { ContextEngineMode } from "./shadowTypes.js";

export function normalizeContextEngineMode(value: unknown): ContextEngineMode {
  return value === "shadow" ? "shadow" : "disabled";
}
