import ts from "typescript";
import type { ClockPort, FactExtractorPort } from "../../ports/index.js";
import { createTypeScriptJavaScriptFactExtractorCore } from "./typescriptJavaScriptFactExtractorCore.js";

export function createTypeScriptJavaScriptFactExtractor(
  clock: ClockPort,
): FactExtractorPort {
  return createTypeScriptJavaScriptFactExtractorCore(clock, ts);
}
