import { generateWithConfiguredAi } from "../../../ai/providerService.js";
import type { ModelPlannerContext } from "../../contracts/index.js";
import type {
  ModelPlannerPort,
  ModelPlannerProviderResult,
} from "../../ports/index.js";
import { ModelPlannerPortError } from "../../ports/modelPlannerPort.js";

export interface ConfiguredAiModelPlannerAdapterOptions {
  timeoutMs: number;
  maxOutputBytes: number;
  maxProviderResponseBytes?: number;
  generate?: typeof generateWithConfiguredAi;
}

function promptFor(context: ModelPlannerContext): string {
  return [
    "Return one JSON object matching the supplied closed action protocol.",
    "Do not return reasoning, prose, facts, findings, confidence, authorization, or file roles.",
    "Allowed action kinds: search_symbol, search_text, read_file, read_range, parse_file, inspect_relationship, stop.",
    JSON.stringify(context),
  ].join("\n");
}

export function createConfiguredAiModelPlannerAdapter(
  options: ConfiguredAiModelPlannerAdapterOptions,
): ModelPlannerPort {
  const generate = options.generate ?? generateWithConfiguredAi;
  return Object.freeze({
    async propose(
      context: ModelPlannerContext,
      signal?: AbortSignal,
    ): Promise<ModelPlannerProviderResult> {
      let result: Awaited<ReturnType<typeof generate>>;
      try {
        result = await generate({
          prompt: promptFor(context),
          temperature: 0,
          numPredict: 500,
          responseFormat: "json",
          timeoutMs: options.timeoutMs,
          purpose: "context_engine_v2_model_planner",
          signal,
          maxResponseBytes: options.maxOutputBytes,
          maxProviderResponseBytes:
            options.maxProviderResponseBytes ?? Math.max(16_384, options.maxOutputBytes * 4),
        });
      } catch {
        throw new ModelPlannerPortError("provider_error");
      }
      const outputBytes = Buffer.byteLength(result.content, "utf8");
      if (outputBytes > options.maxOutputBytes) {
        throw new ModelPlannerPortError("privacy_rejected");
      }
      let proposal: unknown;
      try {
        proposal = JSON.parse(result.content);
      } catch {
        throw new ModelPlannerPortError("malformed_output");
      }
      return {
        proposal,
        outputBytes,
        providerIdentifier: result.provider,
        modelIdentifier: result.model,
      };
    },
  });
}
