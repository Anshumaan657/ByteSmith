export type ContractRuleErrorCode =
  | "execution_input_invalid"
  | "rule_definition_invalid"
  | "rule_definition_duplicate"
  | "rule_output_invalid";

export class ContractRuleError extends Error {
  readonly code: ContractRuleErrorCode;

  constructor(code: ContractRuleErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ContractRuleError";
    this.code = code;
  }
}
