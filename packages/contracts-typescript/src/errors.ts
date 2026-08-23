export type TypeScriptDiscoveryErrorCode =
  | "repository_unreadable"
  | "repository_path_invalid"
  | "repository_identity_invalid"
  | "revision_invalid"
  | "discovery_identity_mismatch"
  | "analysis_comparison_invalid";

export class TypeScriptDiscoveryError extends Error {
  readonly code: TypeScriptDiscoveryErrorCode;

  constructor(
    code: TypeScriptDiscoveryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "TypeScriptDiscoveryError";
    this.code = code;
  }
}
