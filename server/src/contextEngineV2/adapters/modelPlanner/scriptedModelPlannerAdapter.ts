import type { ModelPlannerContext } from "../../contracts/index.js";
import type {
  ModelPlannerPort,
  ModelPlannerProviderResult,
} from "../../ports/index.js";

export type ScriptedModelPlannerStep =
  | { type: "proposal"; value: unknown }
  | { type: "reject" }
  | { type: "timeout" }
  | { type: "never_settle" };

export function createScriptedModelPlannerAdapter(
  steps: readonly ScriptedModelPlannerStep[],
): ModelPlannerPort & { calls(): number; contexts(): readonly ModelPlannerContext[] } {
  let index = 0;
  const contexts: ModelPlannerContext[] = [];
  return Object.freeze({
    calls: () => index,
    contexts: () => Object.freeze([...contexts]),
    async propose(context: ModelPlannerContext, signal?: AbortSignal): Promise<ModelPlannerProviderResult> {
      contexts.push(context);
      const step = steps[Math.min(index, Math.max(0, steps.length - 1))];
      index += 1;
      if (!step || step.type === "reject") throw new Error("scripted_provider_error");
      if (step.type === "never_settle") return new Promise(() => undefined);
      if (step.type === "timeout") {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      const outputBytes = Buffer.byteLength(JSON.stringify(step.value), "utf8");
      return {
        proposal: step.value,
        outputBytes,
        providerIdentifier: "scripted",
        modelIdentifier: "scripted-v1",
      };
    },
  });
}

export function createRecordedModelProposalAdapter(
  proposals: readonly unknown[],
): ModelPlannerPort & { calls(): number } {
  let calls = 0;
  return Object.freeze({
    calls: () => calls,
    async propose(): Promise<ModelPlannerProviderResult> {
      const proposal = proposals[Math.min(calls, Math.max(0, proposals.length - 1))];
      calls += 1;
      return {
        proposal,
        outputBytes: Buffer.byteLength(JSON.stringify(proposal ?? null), "utf8"),
        providerIdentifier: "recorded",
        modelIdentifier: "recorded-proposal-v1",
      };
    },
  });
}
