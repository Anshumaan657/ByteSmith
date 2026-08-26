export type TestDiscoveryErrorCode =
  | "discovery_options_invalid"
  | "phase6_input_invalid"
  | "recommendation_binding_invalid"
  | "recommendation_evidence_missing"
  | "recommendation_input_invalid"
  | "recommendation_limit_invalid"
  | "repository_unreadable"
  | "snapshot_binding_invalid";

export class TestDiscoveryError extends Error {
  readonly code: TestDiscoveryErrorCode;

  constructor(code: TestDiscoveryErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TestDiscoveryError";
    this.code = code;
  }
}
