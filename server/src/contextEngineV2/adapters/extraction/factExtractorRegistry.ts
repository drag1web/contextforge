import type {
  ExtractionLimitation,
  ExtractionResult,
  FactExtractorPort,
} from "../../ports/index.js";
import { stableCompare, stableSerialize } from "./extractionSupport.js";

export class FactExtractionConflictError extends Error {
  readonly code = "extraction_conflict" as const;
  readonly stage = "CE2-02" as const;

  constructor(
    readonly recordKind: "extractor" | "entity" | "fact",
    readonly recordId: string,
  ) {
    super(`Conflicting ${recordKind} record for stable id ${recordId}.`);
    this.name = "FactExtractionConflictError";
  }
}

function sortLimitations(
  limitations: ExtractionLimitation[],
): ExtractionLimitation[] {
  return limitations.sort((left, right) =>
    stableCompare(
      `${left.extractorId}\0${left.extractorVersion}\0${left.code}\0${left.message}`,
      `${right.extractorId}\0${right.extractorVersion}\0${right.code}\0${right.message}`,
    ),
  );
}

function mergeById<T extends { id: string }>(
  values: readonly T[],
  recordKind: "entity" | "fact",
): T[] {
  const records = new Map<string, T>();
  for (const value of values) {
    const existing = records.get(value.id);
    if (!existing) {
      records.set(value.id, value);
    } else if (stableSerialize(existing) !== stableSerialize(value)) {
      throw new FactExtractionConflictError(recordKind, value.id);
    }
  }
  return [...records.values()].sort((left, right) =>
    stableCompare(left.id, right.id),
  );
}

export function createFactExtractorRegistry(
  registeredExtractors: readonly FactExtractorPort[],
): FactExtractorPort {
  const extractors = [...registeredExtractors].sort((left, right) =>
    stableCompare(`${left.id}\0${left.version}`, `${right.id}\0${right.version}`),
  );
  const extractorKeys = new Set<string>();
  for (const extractor of extractors) {
    const key = `${extractor.id}\0${extractor.version}`;
    if (extractorKeys.has(key)) {
      throw new FactExtractionConflictError("extractor", key);
    }
    extractorKeys.add(key);
  }

  return {
    id: "fact-extractor-registry",
    version: "1",

    supports(input) {
      return extractors.some((extractor) => {
        try {
          return extractor.supports(input);
        } catch {
          return false;
        }
      });
    },

    async extract(input) {
      const entities = [];
      const facts = [];
      const limitations: ExtractionLimitation[] = [];
      let supportedCount = 0;

      for (const extractor of extractors) {
        let supported = false;
        try {
          supported = extractor.supports(input);
        } catch {
          limitations.push({
            extractorId: extractor.id,
            extractorVersion: extractor.version,
            code: "extractor_failure",
            message: "Extractor support detection failed safely.",
          });
          continue;
        }
        if (!supported) {
          continue;
        }
        supportedCount += 1;
        try {
          const result = structuredClone(await extractor.extract(input));
          entities.push(...result.entities);
          facts.push(...result.facts);
          limitations.push(...result.limitations);
        } catch (error) {
          if (error instanceof FactExtractionConflictError) {
            throw error;
          }
          limitations.push({
            extractorId: extractor.id,
            extractorVersion: extractor.version,
            code: "extractor_failure",
            message: "Extractor execution failed safely.",
          });
        }
      }

      if (supportedCount === 0) {
        limitations.push({
          extractorId: "fact-extractor-registry",
          extractorVersion: "1",
          code: "unsupported_language",
          message: "No registered extractor supports this file.",
        });
      }

      const result: ExtractionResult = {
        entities: mergeById(entities, "entity"),
        facts: mergeById(facts, "fact"),
        limitations: sortLimitations(limitations),
      };
      return result;
    },
  };
}
