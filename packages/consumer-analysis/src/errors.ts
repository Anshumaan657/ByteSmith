export type ConsumerAnalysisErrorCode =
  | "input_invalid"
  | "binding_mismatch"
  | "limit_invalid"
  | "repository_unreadable";

export class ConsumerAnalysisError extends Error {
  readonly code: ConsumerAnalysisErrorCode;

  constructor(
    code: ConsumerAnalysisErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ConsumerAnalysisError";
    this.code = code;
  }
}
