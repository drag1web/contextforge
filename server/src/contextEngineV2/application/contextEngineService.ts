import type {
  InvestigationRequest,
  InvestigationResult,
} from "../contracts/index.js";
import {
  validateInvestigationRequest,
  type ContractValidationIssue,
} from "../domain/index.js";
import type {
  ClockPort,
  IdGeneratorPort,
  TraceSinkPort,
} from "../ports/index.js";

export interface ContextEngineV2 {
  investigate(request: InvestigationRequest): Promise<InvestigationResult>;
}

export interface ContextEngineServiceDependencies {
  clock: ClockPort;
  ids: IdGeneratorPort;
  traceSink?: TraceSinkPort;
}

export class InvalidInvestigationRequestError extends Error {
  readonly code = "invalid_contract";

  constructor(readonly issues: ContractValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "InvalidInvestigationRequestError";
  }
}

export class ContextEngineNotImplementedError extends Error {
  readonly code = "not_implemented" as const;
  readonly stage = "CE2-00" as const;

  constructor() {
    super("Context Engine v2 execution path is not implemented at CE2-00.");
    this.name = "ContextEngineNotImplementedError";
  }
}

export function createContextEngineV2(
  _dependencies: ContextEngineServiceDependencies,
): ContextEngineV2 {
  return {
    async investigate(request) {
      const validation = validateInvestigationRequest(request);
      if (!validation.valid) {
        throw new InvalidInvestigationRequestError(validation.issues);
      }
      throw new ContextEngineNotImplementedError();
    },
  };
}
