import {
  assertHeadMatches,
  resolveGitComparison,
  type ResolvedGitComparison,
} from "@bytesmith/vcs-git";

const EXACT_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface PullRequestContext {
  number: number;
  baseRevision: string;
  headRevision: string;
  mergeBaseRevision: string;
  headRepository: string;
  fork: boolean;
  comparison: ResolvedGitComparison;
}

export class PullRequestContextError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PullRequestContextError";
    this.code = code;
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PullRequestContextError(
      "invalid_pull_request_event",
      `${name} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function commit(value: unknown, name: string): string {
  if (typeof value !== "string" || !EXACT_COMMIT.test(value.toLowerCase())) {
    throw new PullRequestContextError(
      "invalid_pull_request_event",
      `${name} must be an exact Git commit identifier.`,
    );
  }
  return value.toLowerCase();
}

function repositoryName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)
  ) {
    throw new PullRequestContextError(
      "invalid_pull_request_event",
      "pull_request.head.repo.full_name must identify a GitHub repository.",
    );
  }
  return value;
}

export async function resolvePullRequestContext(options: {
  event: Record<string, unknown>;
  repositoryPath: string;
  repository: string;
  baseInput?: string;
  headInput?: string;
}): Promise<PullRequestContext> {
  const pullRequest = object(options.event.pull_request, "pull_request");
  const base = object(pullRequest.base, "pull_request.base");
  const head = object(pullRequest.head, "pull_request.head");
  const headRepository = object(head.repo, "pull_request.head.repo");
  const number = pullRequest.number;
  if (!Number.isSafeInteger(number) || (number as number) <= 0) {
    throw new PullRequestContextError(
      "invalid_pull_request_event",
      "pull_request.number must be a positive integer.",
    );
  }
  const eventBase = commit(base.sha, "pull_request.base.sha");
  const eventHead = commit(head.sha, "pull_request.head.sha");
  const baseRevision = options.baseInput
    ? commit(options.baseInput, "base input")
    : eventBase;
  const headRevision = options.headInput
    ? commit(options.headInput, "head input")
    : eventHead;
  if (baseRevision !== eventBase || headRevision !== eventHead) {
    throw new PullRequestContextError(
      "stale_revision",
      "Action revision inputs must exactly match the current pull-request event.",
    );
  }
  const name = repositoryName(headRepository.full_name);
  const comparison = await resolveGitComparison({
    repositoryPath: options.repositoryPath,
    base: baseRevision,
    head: headRevision,
  });
  await assertHeadMatches(comparison.repository, headRevision);
  return {
    number: number as number,
    baseRevision: comparison.base.commit,
    headRevision: comparison.head.commit,
    mergeBaseRevision: comparison.mergeBase,
    headRepository: name,
    fork: name.toLowerCase() !== options.repository.toLowerCase(),
    comparison,
  };
}
