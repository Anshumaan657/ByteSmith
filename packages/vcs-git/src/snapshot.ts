import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { executeGit } from "./command.js";
import { GitError } from "./errors.js";
import { resolveGitRevision } from "./revision.js";
import type { GitRepository, GitSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const exactRevision = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

async function extractArchive(
  archive: string,
  directory: string,
): Promise<void> {
  try {
    await execFileAsync("tar", ["-xf", archive, "-C", directory], {
      maxBuffer: 1024 * 1024,
    });
  } catch (cause) {
    throw new GitError(
      "snapshot_materialization_failed",
      "The exact Git snapshot archive could not be extracted.",
      { operation: "materialize_git_snapshot", cause },
    );
  }
}

/**
 * Materialize an immutable revision using `git archive`, never by checking out
 * or changing the caller's working tree. The returned directory is suitable
 * for analyzers that require a filesystem and must be cleaned up by callers.
 */
export async function materializeGitSnapshot(
  repository: GitRepository,
  revision: string,
): Promise<GitSnapshot> {
  const resolved = await resolveGitRevision(repository, revision, "revision");
  if (!exactRevision.test(resolved.commit)) {
    throw new GitError(
      "snapshot_materialization_failed",
      "Git did not return an exact commit for snapshot materialization.",
      { operation: "materialize_git_snapshot" },
    );
  }
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "bytesmith-snapshot-"),
  );
  const archive = path.join(directory, ".snapshot.tar");
  let cleaned = false;
  try {
    const result = await executeGit(repository.rootPath, [
      "archive",
      "--format=tar",
      `--output=${archive}`,
      resolved.commit,
    ]);
    if (result.exitCode !== 0) {
      throw new GitError(
        "snapshot_materialization_failed",
        "Git could not create the exact revision archive.",
        { operation: "materialize_git_snapshot", exitCode: result.exitCode },
      );
    }
    await extractArchive(archive, directory);
    return {
      directory,
      revision: resolved.commit,
      async cleanup(): Promise<void> {
        if (cleaned) return;
        cleaned = true;
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (cause) {
    await rm(directory, { recursive: true, force: true });
    if (cause instanceof GitError) throw cause;
    throw new GitError(
      "snapshot_materialization_failed",
      "The exact Git revision could not be materialized.",
      { operation: "materialize_git_snapshot", cause },
    );
  }
}

export async function withGitSnapshots<T>(
  repository: GitRepository,
  revisions: { base: string; head: string },
  callback: (snapshots: { base: GitSnapshot; head: GitSnapshot }) => Promise<T>,
): Promise<T> {
  const base = await materializeGitSnapshot(repository, revisions.base);
  try {
    const head = await materializeGitSnapshot(repository, revisions.head);
    try {
      return await callback({ base, head });
    } finally {
      await head.cleanup();
    }
  } finally {
    await base.cleanup();
  }
}
