import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  discoverGitRepository,
  GitError,
  normalizeGitPath,
  normalizeParsedDiff,
  readComparisonDiff,
  readGitDiff,
  resolveGitComparison,
} from "../dist/index.js";
import { parseNumstat, parseRawDiff } from "../dist/diff-parser.js";

const execFileAsync = promisify(execFile);
const zeroId = "0".repeat(40);
const oldId = "a".repeat(40);
const newId = "b".repeat(40);

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

async function createRepository(t, prefix = "bytesmith-diff-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--initial-branch=main");
  await git(directory, "config", "user.name", "ByteSmith Test");
  await git(directory, "config", "user.email", "test@bytesmith.dev");
  await git(directory, "config", "core.fileMode", "true");
  return directory;
}

async function commitAll(directory, message) {
  await git(directory, "add", "-A");
  await git(directory, "commit", "-m", message);
  return git(directory, "rev-parse", "HEAD");
}

async function write(directory, relativePath, content) {
  const filePath = path.join(directory, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function byPath(diff) {
  return new Map(diff.files.map((file) => [file.path, file]));
}

test("exact commit diff normalizes every supported change and ignores the working tree", async (t) => {
  const directory = await createRepository(t);
  await write(directory, "binary.bin", Buffer.from([0, 1, 2, 3]));
  await write(directory, "copy-source.txt", "copy source unique\n");
  await write(directory, "deleted.txt", "delete me unique\n");
  await write(directory, "mode.sh", "#!/bin/sh\necho mode\n");
  await write(directory, "modified.txt", "before modified\n");
  await write(
    directory,
    "old name.txt",
    Array.from({ length: 40 }, (_, index) => `rename line ${index}\n`).join(""),
  );
  await write(directory, "symlink.txt", "regular before link\n");
  const base = await commitAll(directory, "base");

  await write(directory, "binary.bin", Buffer.from([0, 9, 8, 7]));
  await fs.copyFile(
    path.join(directory, "copy-source.txt"),
    path.join(directory, "copied.txt"),
  );
  await fs.rm(path.join(directory, "deleted.txt"));
  await fs.chmod(path.join(directory, "mode.sh"), 0o755);
  await write(directory, "modified.txt", "after modified\n");
  await git(directory, "mv", "old name.txt", "new name.txt");
  await fs.appendFile(
    path.join(directory, "new name.txt"),
    "one changed rename line\n",
    "utf8",
  );
  await fs.rm(path.join(directory, "symlink.txt"));
  await fs.symlink("modified.txt", path.join(directory, "symlink.txt"));
  await write(directory, "space name.txt", "space\n");
  await write(directory, 'quote"name.txt', "quote\n");
  await write(directory, "tab\tname.txt", "tab\n");
  await write(directory, "line\nname.txt", "newline\n");
  await write(directory, "café.txt", "unicode\n");
  await git(directory, "add", "-A");
  await git(
    directory,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${base},modules/demo`,
  );
  await git(directory, "commit", "-m", "all diff forms");
  const head = await git(directory, "rev-parse", "HEAD");

  const repository = await discoverGitRepository(directory);
  const first = await readGitDiff(repository, base, head);
  const second = await readGitDiff(repository, base, head);
  assert.deepEqual(second, first);
  assert.equal(first.fromCommit, base);
  assert.equal(first.toCommit, head);
  assert.equal(first.totalChangedFiles, 13);
  assert.deepEqual(
    first.files.map((file) => file.path),
    [
      "binary.bin",
      "café.txt",
      "copied.txt",
      "deleted.txt",
      "line\nname.txt",
      "mode.sh",
      "modified.txt",
      "modules/demo",
      "new name.txt",
      'quote"name.txt',
      "space name.txt",
      "symlink.txt",
      "tab\tname.txt",
    ].sort(),
  );

  const files = byPath(first);
  assert.equal(files.get("binary.bin").binary, true);
  assert.equal(files.get("binary.bin").changeType, "modified");
  assert.equal(files.get("copied.txt").changeType, "copied");
  assert.equal(files.get("copied.txt").previousPath, "copy-source.txt");
  assert.equal(files.get("copied.txt").similarity, 100);
  assert.equal(files.get("deleted.txt").changeType, "deleted");
  assert.equal(files.get("deleted.txt").newObjectId, undefined);
  assert.equal(files.get("mode.sh").changeType, "modified");
  assert.equal(files.get("mode.sh").oldMode, "100644");
  assert.equal(files.get("mode.sh").newMode, "100755");
  assert.equal(files.get("mode.sh").fileKind, "executable");
  assert.equal(files.get("modified.txt").changeType, "modified");
  assert.equal(files.get("modules/demo").changeType, "added");
  assert.equal(files.get("modules/demo").fileKind, "submodule");
  assert.equal(files.get("new name.txt").changeType, "renamed");
  assert.equal(files.get("new name.txt").previousPath, "old name.txt");
  assert.ok(files.get("new name.txt").similarity >= 50);
  assert.ok(files.get("new name.txt").similarity < 100);
  assert.equal(files.get("symlink.txt").changeType, "type_changed");
  assert.equal(files.get("symlink.txt").fileKind, "symlink");

  await write(directory, "modified.txt", "uncommitted content\n");
  await write(directory, "untracked.txt", "untracked\n");
  assert.deepEqual(await readGitDiff(repository, base, head), first);
});

test("empty exact-commit diff is explicit and valid", async (t) => {
  const directory = await createRepository(t);
  await write(directory, "README.md", "empty diff\n");
  const commit = await commitAll(directory, "initial");
  const diff = await readGitDiff(
    await discoverGitRepository(directory),
    commit,
    commit,
  );
  assert.deepEqual(diff, {
    fromCommit: commit,
    toCommit: commit,
    totalChangedFiles: 0,
    files: [],
  });
});

test("comparison diff uses merge-base to head and excludes base-only changes", async (t) => {
  const directory = await createRepository(t);
  await write(directory, "README.md", "initial\n");
  const initial = await commitAll(directory, "initial");
  await git(directory, "switch", "-c", "feature");
  await write(directory, "feature.txt", "feature\n");
  const featureHead = await commitAll(directory, "feature");
  await git(directory, "switch", "main");
  await write(directory, "base-only.txt", "base only\n");
  await commitAll(directory, "base advances");

  const comparison = await resolveGitComparison({
    repositoryPath: directory,
    base: "main",
    head: "feature",
  });
  const diff = await readComparisonDiff(comparison);
  assert.equal(diff.fromCommit, initial);
  assert.equal(diff.toCommit, featureHead);
  assert.deepEqual(
    diff.files.map((file) => file.path),
    ["feature.txt"],
  );

  await git(directory, "switch", "feature");
  await write(directory, "moved.txt", "new head\n");
  await commitAll(directory, "move feature ref");
  await assert.rejects(
    readComparisonDiff(comparison),
    (error) => error instanceof GitError && error.code === "stale_revision",
  );
});

test("diff acquisition requires exact commit IDs", async (t) => {
  const directory = await createRepository(t);
  await write(directory, "README.md", "initial\n");
  const commit = await commitAll(directory, "initial");
  const repository = await discoverGitRepository(directory);
  await assert.rejects(
    readGitDiff(repository, "main", commit),
    (error) => error instanceof GitError && error.code === "revision_invalid",
  );
});

test("raw and numstat parsers reject truncation, malformed metadata, and invalid UTF-8", () => {
  assert.throws(
    () => parseRawDiff(Buffer.from("not terminated")),
    (error) => error instanceof GitError && error.code === "diff_parse_error",
  );
  assert.throws(
    () => parseRawDiff(Buffer.from("malformed\0path\0")),
    (error) => error instanceof GitError && error.code === "diff_parse_error",
  );
  const header = Buffer.from(`:000000 100644 ${zeroId} ${newId} A\0`, "ascii");
  assert.throws(
    () => parseRawDiff(Buffer.concat([header, Buffer.from([0xff, 0x00])])),
    (error) => error instanceof GitError && error.code === "diff_path_invalid",
  );
  assert.throws(
    () => parseNumstat(Buffer.from("1\t-\tfile\0")),
    (error) => error instanceof GitError && error.code === "diff_parse_error",
  );
});

test("normalization rejects unsupported statuses, duplicate paths, and metadata disagreement", () => {
  const baseRecord = {
    oldMode: "100644",
    newMode: "100644",
    oldObjectId: oldId,
    newObjectId: newId,
    status: "M",
    path: "file.ts",
  };
  assert.throws(
    () =>
      normalizeParsedDiff(
        [{ ...baseRecord, status: "X" }],
        [{ path: "file.ts", binary: false }],
      ),
    (error) =>
      error instanceof GitError && error.code === "diff_status_unsupported",
  );
  assert.throws(
    () =>
      normalizeParsedDiff(
        [baseRecord, baseRecord],
        [{ path: "file.ts", binary: false }],
      ),
    (error) =>
      error instanceof GitError && error.code === "diff_duplicate_path",
  );
  assert.throws(
    () =>
      normalizeParsedDiff([baseRecord], [{ path: "other.ts", binary: false }]),
    (error) =>
      error instanceof GitError && error.code === "diff_metadata_mismatch",
  );
  assert.throws(
    () =>
      normalizeParsedDiff(
        [
          {
            ...baseRecord,
            status: "A",
            oldMode: "000000",
            oldObjectId: zeroId,
            path: "café.ts",
          },
          {
            ...baseRecord,
            status: "A",
            oldMode: "000000",
            oldObjectId: zeroId,
            path: "cafe\u0301.ts",
          },
        ],
        [
          { path: "café.ts", binary: false },
          { path: "cafe\u0301.ts", binary: false },
        ],
      ),
    (error) =>
      error instanceof GitError && error.code === "diff_path_collision",
  );
});

test("path normalization preserves supported names and rejects traversal or ambiguous separators", () => {
  assert.equal(
    normalizeGitPath("src/space name/cafe\u0301.ts"),
    "src/space name/café.ts",
  );
  for (const invalid of [
    "",
    "/absolute.ts",
    "../escape.ts",
    "src/../escape.ts",
    "src\\file.ts",
    "src//file.ts",
  ]) {
    assert.throws(
      () => normalizeGitPath(invalid),
      (error) =>
        error instanceof GitError && error.code === "diff_path_invalid",
    );
  }
});
