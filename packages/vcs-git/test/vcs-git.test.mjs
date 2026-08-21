import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  assertHeadMatches,
  assertRevisionUnchanged,
  createRepositoryIdentity,
  discoverGitRepository,
  GitError,
  inspectWorkingTree,
  normalizeRemoteUrl,
  resolveGitComparison,
  resolveGitRevision,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

async function git(directory, ...arguments_) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", directory, ...arguments_],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    },
  );
  return stdout.trim();
}

async function createRepository(t, prefix = "bytesmith-git-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--initial-branch=main");
  await git(directory, "config", "user.name", "ByteSmith Test");
  await git(directory, "config", "user.email", "test@bytesmith.dev");
  await fs.writeFile(path.join(directory, "README.md"), "initial\n", "utf8");
  await git(directory, "add", "README.md");
  await git(directory, "commit", "-m", "initial");
  return directory;
}

async function commitFile(directory, relativePath, content, message) {
  const filePath = path.join(directory, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  await git(directory, "add", "--", relativePath);
  await git(directory, "commit", "-m", message);
  return git(directory, "rev-parse", "HEAD");
}

test("repository discovery resolves nested paths and credential-free remote identity", async (t) => {
  const directory = await createRepository(t);
  const nested = path.join(directory, "src", "nested");
  await fs.mkdir(nested, { recursive: true });
  await git(
    directory,
    "remote",
    "add",
    "origin",
    "https://user:secret@Example.COM/Team/ByteSmith.git",
  );

  const repository = await discoverGitRepository(nested);
  const repositoryFromFile = await discoverGitRepository(
    path.join(directory, "README.md"),
  );
  const identity = await createRepositoryIdentity(repository);
  assert.equal(repository.rootPath, await fs.realpath(directory));
  assert.equal(repositoryFromFile.rootPath, repository.rootPath);
  assert.equal(repository.bare, false);
  assert.equal(identity.source, "remote");
  assert.equal(identity.name, "ByteSmith");
  assert.equal(identity.remote?.name, "origin");
  assert.equal(identity.remote?.url, "https://example.com/Team/ByteSmith");
  assert.doesNotMatch(JSON.stringify(identity), /user|secret/u);
  assert.match(identity.id, /^repository\.[a-f0-9]{64}$/u);
});

test("remote normalization handles HTTPS and SCP-style SSH without retaining credentials", () => {
  assert.equal(
    normalizeRemoteUrl("https://token@example.com/Org/Repo.git"),
    "https://example.com/Org/Repo",
  );
  assert.equal(
    normalizeRemoteUrl("git@GitHub.com:Org/Repo.git"),
    "ssh://github.com/Org/Repo",
  );
  assert.equal(normalizeRemoteUrl("/local/repository.git"), undefined);
  assert.equal(normalizeRemoteUrl("file:///local/repository.git"), undefined);
});

test("revision comparison binds branches and tags to exact commits and one merge base", async (t) => {
  const directory = await createRepository(t);
  const initial = await git(directory, "rev-parse", "HEAD");
  await git(directory, "tag", "v0.1.0");
  await git(directory, "switch", "-c", "feature");
  const feature = await commitFile(
    directory,
    "feature.txt",
    "feature\n",
    "feature",
  );
  await git(directory, "switch", "main");
  const main = await commitFile(directory, "main.txt", "main\n", "main");

  const comparison = await resolveGitComparison({
    repositoryPath: directory,
    base: "main",
    head: "feature",
  });
  assert.equal(comparison.base.commit, main);
  assert.equal(comparison.head.commit, feature);
  assert.equal(comparison.mergeBase, initial);
  assert.equal(
    (await resolveGitRevision(comparison.repository, "v0.1.0")).commit,
    initial,
  );
  assert.equal(
    (await resolveGitRevision(comparison.repository, initial)).commit,
    initial,
  );
});

test("repositories with unrelated histories fail merge-base resolution explicitly", async (t) => {
  const directory = await createRepository(t);
  await git(directory, "switch", "--orphan", "unrelated");
  await fs.rm(path.join(directory, "README.md"), { force: true });
  await git(directory, "rm", "--cached", "--ignore-unmatch", "README.md");
  await commitFile(directory, "unrelated.txt", "unrelated\n", "unrelated root");

  await assert.rejects(
    resolveGitComparison({
      repositoryPath: directory,
      base: "main",
      head: "unrelated",
    }),
    (error) =>
      error instanceof GitError && error.code === "merge_base_not_found",
  );
});

test("linked worktrees retain distinct Git directories and one shared common directory", async (t) => {
  const directory = await createRepository(t);
  const worktreeParent = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-worktree-parent-"),
  );
  const worktreeDirectory = path.join(worktreeParent, "linked");
  t.after(async () => fs.rm(worktreeParent, { recursive: true, force: true }));
  await git(
    directory,
    "worktree",
    "add",
    "--quiet",
    "-b",
    "linked",
    worktreeDirectory,
  );

  const primary = await discoverGitRepository(directory);
  const linked = await discoverGitRepository(worktreeDirectory);
  assert.notEqual(linked.gitDirectory, primary.gitDirectory);
  assert.equal(linked.commonDirectory, primary.commonDirectory);
});

test("working-tree inspection reports branch, dirtiness, and detached HEAD without changing bindings", async (t) => {
  const directory = await createRepository(t);
  const repository = await discoverGitRepository(directory);
  const clean = await inspectWorkingTree(repository);
  assert.equal(clean.branch, "main");
  assert.equal(clean.detached, false);
  assert.equal(clean.dirty, false);

  await fs.writeFile(path.join(directory, "untracked.txt"), "dirty\n", "utf8");
  const dirty = await inspectWorkingTree(repository);
  assert.equal(dirty.headCommit, clean.headCommit);
  assert.equal(dirty.dirty, true);
  await fs.rm(path.join(directory, "untracked.txt"));

  await git(directory, "switch", "--detach", clean.headCommit);
  const detached = await inspectWorkingTree(repository);
  assert.equal(detached.detached, true);
  assert.equal(detached.branch, undefined);
});

test("stale branch and HEAD checks fail explicitly after references move", async (t) => {
  const directory = await createRepository(t);
  const repository = await discoverGitRepository(directory);
  const original = await resolveGitRevision(repository, "main", "head");
  await commitFile(directory, "next.txt", "next\n", "next");

  await assert.rejects(
    assertRevisionUnchanged(repository, "main", original.commit, "head"),
    (error) => error instanceof GitError && error.code === "stale_revision",
  );
  await assert.rejects(
    assertHeadMatches(repository, original.commit),
    (error) => error instanceof GitError && error.code === "stale_revision",
  );
});

test("invalid and shell-like revisions fail safely without executing user text", async (t) => {
  const directory = await createRepository(t);
  const repository = await discoverGitRepository(directory);
  const injectedPath = path.join(directory, "should-not-exist");

  await assert.rejects(
    resolveGitRevision(repository, "missing-revision", "base"),
    (error) =>
      error instanceof GitError &&
      error.code === "revision_not_found" &&
      error.message === "The base revision could not be resolved to a commit.",
  );
  await assert.rejects(
    resolveGitRevision(repository, "HEAD;touch should-not-exist", "head"),
    (error) => error instanceof GitError && error.code === "revision_not_found",
  );
  await assert.rejects(fs.access(injectedPath));
  await assert.rejects(
    resolveGitRevision(repository, "HEAD\nmalicious", "head"),
    (error) => error instanceof GitError && error.code === "revision_invalid",
  );
});

test("non-repositories and bare repositories are rejected with structured errors", async (t) => {
  const plainDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-plain-"),
  );
  const bareDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-bare-"),
  );
  t.after(async () => {
    await fs.rm(plainDirectory, { recursive: true, force: true });
    await fs.rm(bareDirectory, { recursive: true, force: true });
  });
  await git(bareDirectory, "init", "--bare");

  await assert.rejects(
    discoverGitRepository(plainDirectory),
    (error) => error instanceof GitError && error.code === "not_a_repository",
  );
  await assert.rejects(
    discoverGitRepository(bareDirectory),
    (error) =>
      error instanceof GitError && error.code === "bare_repository_unsupported",
  );
});

test("repositories without a network remote derive stable identity from committed history", async (t) => {
  const directory = await createRepository(t);
  const cloneDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-clone-"),
  );
  t.after(async () => fs.rm(cloneDirectory, { recursive: true, force: true }));
  await execFileAsync("git", ["clone", "--quiet", directory, cloneDirectory], {
    encoding: "utf8",
  });

  const originalIdentity = await createRepositoryIdentity(
    await discoverGitRepository(directory),
  );
  const cloneIdentity = await createRepositoryIdentity(
    await discoverGitRepository(cloneDirectory),
  );
  assert.equal(originalIdentity.source, "history");
  assert.equal(cloneIdentity.source, "history");
  assert.equal(originalIdentity.id, cloneIdentity.id);
  assert.equal(
    originalIdentity.canonicalLocator,
    cloneIdentity.canonicalLocator,
  );
});

test("an unborn repository cannot produce a working-tree head or stable identity", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-unborn-"),
  );
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--initial-branch=main");
  const repository = await discoverGitRepository(directory);

  await assert.rejects(
    inspectWorkingTree(repository),
    (error) => error instanceof GitError && error.code === "head_unborn",
  );
  await assert.rejects(
    createRepositoryIdentity(repository),
    (error) =>
      error instanceof GitError &&
      error.code === "repository_identity_unavailable",
  );
});
