import type { ModelPlannerContext } from "../contracts/planner.js";

export interface ModelPlannerProviderResult {
  proposal: unknown;
  outputBytes: number;
  providerIdentifier: string;
  modelIdentifier: string;
}

export interface ModelPlannerPort {
  propose(
    context: ModelPlannerContext,
    signal?: AbortSignal,
  ): Promise<ModelPlannerProviderResult>;
}

export class ModelPlannerPortError extends Error {
  constructor(
    readonly code:
      | "malformed_output"
      | "provider_error"
      | "privacy_rejected"
      | "unavailable",
  ) {
    super(code);
    this.name = "ModelPlannerPortError";
  }
}
