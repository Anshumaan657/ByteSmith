export type TypeScriptDiscoveryErrorCode =
  | "repository_unreadable"
  | "repository_path_invalid"
  | "repository_identity_invalid";

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
