export interface ContractValidationIssue {
  path: string;
  code:
    | "required"
    | "invalid_type"
    | "invalid_value"
    | "invalid_range"
    | "duplicate"
    | "unknown_reference"
    | "snapshot_mismatch"
    | "unsafe_path"
    | "not_json_safe"
    | "stale_evidence";
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  issues: ContractValidationIssue[];
}
