import fs from "node:fs/promises";
import path from "node:path";
import { executeGit, type GitCommandResult } from "./command.js";
import { GitError, isGitError } from "./errors.js";
import { resolveGitRevision } from "./revision.js";
import type { GitObjectId, GitRepository, WorkingTreeState } from "./types.js";

async function startingDirectory(inputPath: string): Promise<string> {
  try {
    const resolved = await fs.realpath(path.resolve(inputPath));
    const stat = await fs.stat(resolved);
    return stat.isDirectory() ? resolved : path.dirname(resolved);
  } catch (cause) {
    throw new GitError(
      "not_a_repository",
      "The repository path does not exist or cannot be read.",
      {
        operation: "discover_repository",
        cause,
      },
    );
  }
}

async function successful(
  directory: string,
  arguments_: readonly string[],
  operation: string,
): Promise<GitCommandResult> {
  let result: GitCommandResult;
  try {
    result = await executeGit(directory, arguments_);
  } catch (cause) {
    if (isGitError(cause)) throw cause;
    throw new GitError(
      "git_unavailable",
      "Git is required but could not be executed.",
      {
        operation,
        cause,
      },
    );
  }
  if (result.exitCode !== 0) {
    throw new GitError(
      "not_a_repository",
      "The selected path is not inside a supported Git repository.",
      {
        operation,
        exitCode: result.exitCode,
      },
    );
  }
  return result;
}

async function resolveGitDirectory(
  baseDirectory: string,
  value: string,
): Promise<string> {
  const candidate = path.isAbsolute(value)
    ? value
    : path.resolve(baseDirectory, value);
  return fs.realpath(candidate);
}

export async function discoverGitRepository(
  inputPath: string,
): Promise<GitRepository> {
  const directory = await startingDirectory(inputPath);
  const inside = await successful(
    directory,
    ["rev-parse", "--is-inside-work-tree"],
    "discover_repository",
  );
  if (inside.stdout.trim() !== "true") {
    throw new GitError(
      "bare_repository_unsupported",
      "Bare Git repositories are not supported by the MVP.",
      {
        operation: "discover_repository",
      },
    );
  }

  const [rootResult, gitDirectoryResult, commonDirectoryResult] =
    await Promise.all([
      successful(
        directory,
        ["rev-parse", "--show-toplevel"],
        "discover_repository",
      ),
      successful(
        directory,
        ["rev-parse", "--absolute-git-dir"],
        "discover_repository",
      ),
      successful(
        directory,
        ["rev-parse", "--git-common-dir"],
        "discover_repository",
      ),
    ]);
  const rootPath = await fs.realpath(rootResult.stdout.trim());
  return {
    rootPath,
    gitDirectory: await resolveGitDirectory(
      directory,
      gitDirectoryResult.stdout.trim(),
    ),
    commonDirectory: await resolveGitDirectory(
      directory,
      commonDirectoryResult.stdout.trim(),
    ),
    bare: false,
  };
}

export async function inspectWorkingTree(
  repository: GitRepository,
): Promise<WorkingTreeState> {
  let headCommit: GitObjectId;
  try {
    headCommit = (await resolveGitRevision(repository, "HEAD", "head")).commit;
  } catch (cause) {
    if (isGitError(cause) && cause.code !== "revision_not_found") throw cause;
    throw new GitError(
      "head_unborn",
      "The repository does not have a committed HEAD revision.",
      {
        operation: "inspect_working_tree",
        cause,
      },
    );
  }

  const [branchResult, statusResult] = await Promise.all([
    executeGit(repository.rootPath, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]),
    executeGit(repository.rootPath, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
    ]),
  ]);
  if (statusResult.exitCode !== 0) {
    throw new GitError(
      "command_failed",
      "Git could not inspect the working-tree state.",
      {
        operation: "inspect_working_tree",
        exitCode: statusResult.exitCode,
      },
    );
  }
  const branch =
    branchResult.exitCode === 0 ? branchResult.stdout.trim() : undefined;
  return {
    headCommit,
    ...(branch ? { branch } : {}),
    detached: branch === undefined,
    dirty: statusResult.stdout.length > 0,
  };
}
