import { executeGit, type GitCommandResult } from "./command.js";
import { GitError, isGitError } from "./errors.js";
import type {
  GitObjectId,
  GitRepository,
  ResolvedGitComparison,
  ResolvedGitRevision,
  ResolveGitComparisonOptions,
  RevisionRole,
} from "./types.js";
import { createRepositoryIdentity } from "./identity.js";
import { discoverGitRepository } from "./repository.js";

const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function validateRevisionInput(revision: string, role: RevisionRole): void {
  if (
    revision.length === 0 ||
    revision.length > 1024 ||
    /[\0\r\n]/u.test(revision)
  ) {
    throw new GitError(
      "revision_invalid",
      `The ${role} revision is not a valid Git revision expression.`,
      {
        operation: "resolve_revision",
      },
    );
  }
}

function revisionFailure(
  result: GitCommandResult,
  role: RevisionRole,
): GitError {
  const ambiguous = /ambiguous|short object ID .* is ambiguous/iu.test(
    result.stderr,
  );
  return new GitError(
    ambiguous ? "revision_ambiguous" : "revision_not_found",
    ambiguous
      ? `The ${role} revision is ambiguous.`
      : `The ${role} revision could not be resolved to a commit.`,
    { operation: "resolve_revision", exitCode: result.exitCode },
  );
}

export async function resolveGitRevision(
  repository: GitRepository,
  revision: string,
  role: RevisionRole = "revision",
): Promise<ResolvedGitRevision> {
  validateRevisionInput(revision, role);
  let result: GitCommandResult;
  try {
    result = await executeGit(repository.rootPath, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${revision}^{commit}`,
    ]);
  } catch (cause) {
    if (isGitError(cause)) throw cause;
    throw new GitError(
      "git_unavailable",
      "Git is required but could not be executed.",
      {
        operation: "resolve_revision",
        cause,
      },
    );
  }
  if (result.exitCode !== 0) throw revisionFailure(result, role);
  const commit = result.stdout.trim().toLowerCase();
  if (!objectIdPattern.test(commit)) {
    throw new GitError(
      "command_failed",
      "Git returned an invalid commit identifier.",
      {
        operation: "resolve_revision",
      },
    );
  }
  return { requested: revision, commit };
}

export async function resolveMergeBase(
  repository: GitRepository,
  baseCommit: GitObjectId,
  headCommit: GitObjectId,
): Promise<GitObjectId> {
  const result = await executeGit(repository.rootPath, [
    "merge-base",
    "--all",
    baseCommit,
    headCommit,
  ]);
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    throw new GitError(
      "merge_base_not_found",
      "The selected revisions do not have a merge base.",
      {
        operation: "resolve_merge_base",
        exitCode: result.exitCode,
      },
    );
  }
  const candidates = [
    ...new Set(
      result.stdout
        .trim()
        .split(/\s+/u)
        .map((value) => value.toLowerCase()),
    ),
  ].sort();
  if (candidates.length !== 1) {
    throw new GitError(
      "multiple_merge_bases",
      "The selected revisions have multiple merge bases.",
      {
        operation: "resolve_merge_base",
      },
    );
  }
  const mergeBase = candidates[0];
  if (!mergeBase || !objectIdPattern.test(mergeBase)) {
    throw new GitError(
      "command_failed",
      "Git returned an invalid merge-base identifier.",
      {
        operation: "resolve_merge_base",
      },
    );
  }
  return mergeBase;
}

export async function assertRevisionUnchanged(
  repository: GitRepository,
  requestedRevision: string,
  expectedCommit: GitObjectId,
  role: RevisionRole = "revision",
): Promise<void> {
  const current = await resolveGitRevision(repository, requestedRevision, role);
  if (current.commit !== expectedCommit) {
    throw new GitError(
      "stale_revision",
      `The resolved ${role} revision changed during analysis.`,
      {
        operation: "assert_revision_unchanged",
      },
    );
  }
}

export async function assertHeadMatches(
  repository: GitRepository,
  expectedCommit: GitObjectId,
): Promise<void> {
  const current = await resolveGitRevision(repository, "HEAD", "head");
  if (current.commit !== expectedCommit) {
    throw new GitError(
      "stale_revision",
      "Repository HEAD does not match the expected commit.",
      {
        operation: "assert_head_matches",
      },
    );
  }
}

export async function resolveGitComparison(
  options: ResolveGitComparisonOptions,
): Promise<ResolvedGitComparison> {
  const repository = await discoverGitRepository(options.repositoryPath);
  const [identity, base, head] = await Promise.all([
    createRepositoryIdentity(repository),
    resolveGitRevision(repository, options.base, "base"),
    resolveGitRevision(repository, options.head, "head"),
  ]);
  const mergeBase = await resolveMergeBase(
    repository,
    base.commit,
    head.commit,
  );
  await Promise.all([
    assertRevisionUnchanged(repository, options.base, base.commit, "base"),
    assertRevisionUnchanged(repository, options.head, head.commit, "head"),
  ]);
  return { repository, identity, base, head, mergeBase };
}
