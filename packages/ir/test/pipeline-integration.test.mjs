import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createRepositoryIdentity,
  discoverGitRepository,
  readGitDiff,
} from "../../vcs-git/dist/index.js";
import { createRepositoryInventory } from "../../repository-inventory/dist/index.js";
import { createEvidence } from "../../evidence/dist/index.js";
import { createCanonicalIr, createIrFile, createIrGap } from "../dist/index.js";

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

async function write(directory, relativePath, content) {
  const target = path.join(directory, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function commitAll(directory, message) {
  await git(directory, "add", "-A");
  await git(directory, "commit", "-m", message);
  return git(directory, "rev-parse", "HEAD");
}

test("Git diff, exhaustive inventory, evidence, and canonical IR share one exact denominator", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bytesmith-ir-"));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--initial-branch=main");
  await git(directory, "config", "user.name", "ByteSmith Test");
  await git(directory, "config", "user.email", "test@bytesmith.dev");
  await write(directory, "src/app.ts", "export const value = 1;\n");
  await write(directory, "README.md", "before\n");
  const baseRevision = await commitAll(directory, "base");
  await write(directory, "src/app.ts", "export const value = 2;\n");
  await write(directory, "README.md", "after\n");
  await write(directory, "src/new.ts", "export const added = true;\n");
  const headRevision = await commitAll(directory, "head");

  const repository = await discoverGitRepository(directory);
  const identity = await createRepositoryIdentity(repository);
  const diff = await readGitDiff(repository, baseRevision, headRevision);
  const inventory = createRepositoryInventory(diff, {
    analyzerClaims: [
      { analyzerId: "typescript", matcher: { extensions: [".ts"] } },
    ],
  });
  const context = {
    repositoryId: identity.id,
    baseRevision,
    headRevision,
  };
  const evidenceContext = {
    ...context,
    producer: { id: "repository-inventory", version: "0.1.0" },
  };
  const evidence = inventory.files.map((file) =>
    createEvidence(evidenceContext, {
      kind: "coverage",
      revision: headRevision,
      path: file.path,
      summary: `${file.coverageClass}: ${file.reason ?? "analyzer completed"}`,
    }),
  );
  const evidenceByPath = new Map(
    evidence.map((record) => [record.location.path, record]),
  );
  const files = inventory.files.map((file) =>
    createIrFile(context, {
      revision: headRevision,
      path: file.path,
      evidenceIds: [evidenceByPath.get(file.path).id],
    }),
  );
  const unsupported = inventory.files.filter(
    (file) => file.coverageClass === "unsupported",
  );
  const gaps = unsupported.map((file) =>
    createIrGap(context, {
      revision: headRevision,
      type: "unsupported_file",
      summary: file.reason,
      locations: [{ revision: headRevision, path: file.path }],
      evidenceIds: [evidenceByPath.get(file.path).id],
      blockingRelevance: "possible",
    }),
  );
  const ir = createCanonicalIr(context, {
    evidence,
    files,
    symbols: [],
    contracts: [],
    relationships: [],
    tests: [],
    gaps,
  });

  assert.equal(diff.totalChangedFiles, 3);
  assert.equal(inventory.coverage.totalChangedFiles, diff.totalChangedFiles);
  assert.equal(ir.files.length, diff.totalChangedFiles);
  assert.equal(ir.evidence.length, diff.totalChangedFiles);
  assert.equal(ir.gaps.length, inventory.coverage.unsupported);
  assert.deepEqual(
    ir.files.map((file) => file.location.path).sort(),
    diff.files.map((file) => file.path).sort(),
  );
});
