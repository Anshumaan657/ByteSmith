export type GitErrorCode =
  | "git_unavailable"
  | "command_failed"
  | "not_a_repository"
  | "bare_repository_unsupported"
  | "revision_invalid"
  | "revision_not_found"
  | "revision_ambiguous"
  | "merge_base_not_found"
  | "multiple_merge_bases"
  | "repository_identity_unavailable"
  | "head_unborn"
  | "stale_revision"
  | "diff_failed"
  | "diff_parse_error"
  | "diff_status_unsupported"
  | "diff_path_invalid"
  | "diff_path_collision"
  | "diff_duplicate_path"
  | "diff_metadata_mismatch";

export interface GitErrorOptions {
  operation: string;
  exitCode?: number;
  cause?: unknown;
}

export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly operation: string;
  readonly exitCode?: number;

  constructor(code: GitErrorCode, message: string, options: GitErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "GitError";
    this.code = code;
    this.operation = options.operation;
    if (options.exitCode !== undefined) this.exitCode = options.exitCode;
  }
}

export function isGitError(error: unknown): error is GitError {
  return error instanceof GitError;
}
