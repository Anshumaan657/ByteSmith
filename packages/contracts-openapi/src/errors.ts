export type OpenApiAnalyzerErrorCode =
  | "analyzer_options_invalid"
  | "repository_unreadable"
  | "document_invalid"
  | "analysis_comparison_invalid";

export class OpenApiAnalyzerError extends Error {
  readonly code: OpenApiAnalyzerErrorCode;

  constructor(
    code: OpenApiAnalyzerErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "OpenApiAnalyzerError";
    this.code = code;
  }
}
