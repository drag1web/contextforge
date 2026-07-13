import assert from "node:assert/strict";

import {
  beginPerformanceAiCall,
  finishPerformanceAiCall,
  measurePerformanceStage,
  recordPerformanceCacheEvent,
  runWithPerformanceTrace,
  setPerformanceMetadata,
} from "./performanceTrace.js";

async function main() {
  const sessionId = `performance-smoke-${Date.now()}`;

  const first = await runWithPerformanceTrace(
    {
      operation: "task_understanding_preflight",
      sessionId,
      metadata: { rawTaskChars: 42 },
    },
    async () => {
      await measurePerformanceStage(
        "project_inventory",
        "Scan project inventory",
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return 224;
        },
        { scannedFiles: 224 },
      );
      setPerformanceMetadata({ understandingReadiness: "review" });

      const call = beginPerformanceAiCall({
        purpose: "task_understanding_initial",
        provider: "ollama",
        model: "smoke-model",
        promptChars: 1200,
        responseFormat: "json",
        numPredict: 800,
      });
      finishPerformanceAiCall(call, {
        success: true,
        responseChars: 240,
        httpStatus: 200,
        modelLoadMs: 1200,
        promptEvalMs: 40,
        generationMs: 80,
        promptTokens: 120,
        responseTokens: 30,
      });
      recordPerformanceCacheEvent({
        layer: "task_understanding",
        outcome: "miss",
      });
      return "preflight-ok";
    },
  );

  assert.equal(first.value, "preflight-ok");
  assert.equal(first.requestDiagnostics.summary.aiCallCount, 1);
  assert.equal(first.requestDiagnostics.summary.coldAiCalls, 1);
  assert.equal(first.requestDiagnostics.stages.length, 1);
  assert.equal(first.sessionDiagnostics.requestCount, 1);
  assert.equal(first.sessionDiagnostics.summary.inventoryScans, 1);
  assert.equal(first.sessionDiagnostics.summary.cacheMisses, 1);
  assert.equal(first.sessionDiagnostics.summary.totalPromptChars, 1200);
  assert.equal(first.sessionDiagnostics.privacy.rawPromptsStored, false);

  const second = await runWithPerformanceTrace(
    {
      operation: "task_pack_generation",
      sessionId,
    },
    async () => {
      recordPerformanceCacheEvent({
        layer: "task_pack_refinement",
        outcome: "hit",
      });
      await measurePerformanceStage(
        "task_pack_refinement",
        "Generate validated Task Pack refinement",
        () => "cached",
      );
      return "generation-ok";
    },
  );

  assert.equal(second.value, "generation-ok");
  assert.equal(second.sessionDiagnostics.requestCount, 2);
  assert.equal(second.sessionDiagnostics.summary.aiCallCount, 1);
  assert.equal(second.sessionDiagnostics.summary.cacheHits, 1);
  assert.equal(second.sessionDiagnostics.summary.cacheMisses, 1);
  assert.equal(
    second.sessionDiagnostics.requests[0]?.metadata.rawTaskChars,
    42,
  );
  assert.equal(
    second.sessionDiagnostics.requests[0]?.metadata.understandingReadiness,
    "review",
  );

  const outsideStage = await measurePerformanceStage(
    "outside",
    "Outside trace",
    () => 7,
  );
  assert.equal(outsideStage, 7);

  console.log("performance trace smoke passed: 6 scenarios");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
