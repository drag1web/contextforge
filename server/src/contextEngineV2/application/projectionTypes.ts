import type {
  ContextProjection,
  ContextProjectionResult,
  ExplicitTargetConstraint,
  NegativeConstraint,
  ProjectionDiagnostic,
  ProjectionEntityDecision,
  ProjectionReasonCode,
  RepositorySnapshot,
} from "../contracts/index.js";
import type { InvestigationRunnerResult } from "./investigationRunnerTypes.js";

export type ProjectionPurpose = ContextProjection["purpose"];

export type {
  ContextProjectionResult,
  ProjectionDiagnostic,
  ProjectionEntityDecision,
  ProjectionReasonCode,
};

export interface ContextProjectionInput {
  result: InvestigationRunnerResult;
  snapshot: RepositorySnapshot;
  purpose: ProjectionPurpose;
  explicitTargets: readonly ExplicitTargetConstraint[];
  negativeConstraints: readonly NegativeConstraint[];
}

export interface ContextProjectionService {
  project(input: ContextProjectionInput): ContextProjectionResult;
}

export type ContextProjectionErrorCode =
  | "invalid_input"
  | "snapshot_mismatch";

export class ContextProjectionError extends Error {
  readonly stage = "CE2-05" as const;

  constructor(
    readonly code: ContextProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContextProjectionError";
  }
}
