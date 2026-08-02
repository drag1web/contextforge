import fs from "node:fs/promises";
import path from "node:path";

import { assertPortableIdentifier } from "../domain/investigationDomainSupport.js";
import { assertGoldenTraceExportPrivacy, validateGoldenTraceSummary } from "./goldenTraceSummary.js";
import { validatePrivacySafeReviewReason } from "./validationPrivacy.js";
import type { GoldenStore, GoldenTraceSummary } from "./validationTypes.js";

export function createFileGoldenStore(directory: string): GoldenStore {
  const goldenPath = (caseId: string) => {
    assertPortableIdentifier(caseId, "Golden case id");
    return path.join(directory, `${caseId}.json`);
  };
  return {
    async read(caseId) {
      try {
        const raw = JSON.parse(await fs.readFile(goldenPath(caseId), "utf8")) as GoldenTraceSummary;
        return validateGoldenTraceSummary(raw);
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    async write(caseId, summary, reason) {
      const validatedReason = validatePrivacySafeReviewReason(reason);
      const validated = validateGoldenTraceSummary(summary);
      const serialized = `${JSON.stringify(validated, null, 2)}\n`;
      assertGoldenTraceExportPrivacy(JSON.stringify(validated));
      await fs.mkdir(directory, { recursive: true });
      const golden = goldenPath(caseId);
      const review = path.join(directory, `${caseId}.review.json`);
      const nonce = `${process.pid}-${Date.now()}`;
      const goldenTemp = `${golden}.${nonce}.tmp`;
      const reviewTemp = `${review}.${nonce}.tmp`;
      await fs.writeFile(goldenTemp, serialized, "utf8");
      await fs.rename(goldenTemp, golden);
      await fs.writeFile(reviewTemp, `${JSON.stringify({ reason: validatedReason }, null, 2)}\n`, "utf8");
      await fs.rename(reviewTemp, review);
    },
  };
}
