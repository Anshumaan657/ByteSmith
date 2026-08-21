import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  runPhase3Pipeline,
  serializeImpactManifest,
  verifySemanticDigest,
} from "../../impact-manifest/dist/index.js";
import {
  canonicalManifestJson,
  computeSemanticDigest,
} from "../../canonicalization/dist/index.js";
import {
  loadChangeBenchCases,
  matchUnknown,
} from "../../changebench/dist/index.js";
import { validateImpactManifest } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

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

async function commitAll(directory, message) {
  await git(directory, "add", "-A");
  await git(directory, "commit", "-m", message);
  return git(directory, "rev-parse", "HEAD");
}

test("Phase 3E produces valid deterministic manifests and reuses exact snapshots", async (t) => {
  const cases = await loadChangeBenchCases({
    fixturesDirectory: path.join(repositoryRoot, "changebench/fixtures"),
    schemaDirectory: path.join(repositoryRoot, "schemas"),
  });
  const fixture = cases.find(
    (item) => item.definition.id === "unsupported-file-counted",
  );
  assert.ok(fixture);

  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-phase3e-"),
  );
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--initial-branch=main");
  await git(directory, "config", "user.name", "ByteSmith Test");
  await git(directory, "config", "user.email", "test@bytesmith.dev");
  await git(
    directory,
    "remote",
    "add",
    "origin",
    "https://github.com/bytesmith/changebench.git",
  );
  await fs.cp(fixture.beforeDirectory, directory, { recursive: true });
  const baseRevision = await commitAll(directory, "before");
  await fs.cp(fixture.afterDirectory, directory, {
    recursive: true,
    force: true,
  });
  const headRevision = await commitAll(directory, "after");

  const options = {
    repositoryPath: directory,
    base: baseRevision,
    head: headRevision,
    inventoryPolicy: {
      analyzerClaims: [
        { analyzerId: "typescript", matcher: { extensions: [".ts", ".js"] } },
      ],
    },
    analyzers: [
      {
        id: "typescript",
        version: "0.1.0",
        required: true,
        status: "completed",
        diagnostics: [],
      },
    ],
    producer: { id: "repository-inventory", version: "0.1.0" },
    engineVersion: "0.1.0",
    ruleSetVersion: "0.1.0",
    generatedAt: "2026-08-22T08:00:00.000Z",
    expectedBaseRevision: baseRevision,
    expectedHeadRevision: headRevision,
  };
  const clean = await runPhase3Pipeline(options);
  const incremental = await runPhase3Pipeline({
    ...options,
    generatedAt: "2026-08-22T09:00:00.000Z",
    incrementalSeed: clean.snapshot,
  });

  assert.equal(clean.execution, "clean");
  assert.equal(incremental.execution, "incremental");
  assert.equal(clean.manifest.scope.coverage.totalChangedFiles, 2);
  assert.deepEqual(
    clean.manifest.scope.coverage,
    fixture.definition.expected.coverage,
  );
  assert.equal(clean.manifest.status.conclusion, "warn");
  assert.equal(clean.manifest.unknowns.length, 1);
  assert.equal(
    matchUnknown(
      fixture.definition.expected.requiredUnknowns[0],
      clean.manifest.unknowns[0],
    ),
    true,
  );
  assert.equal(verifySemanticDigest(clean.manifest), true);
  assert.equal(
    clean.manifest.integrity.semanticDigest.value,
    incremental.manifest.integrity.semanticDigest.value,
  );
  assert.equal(
    canonicalManifestJson(clean.manifest),
    canonicalManifestJson(incremental.manifest),
  );

  const validation = await validateImpactManifest(clean.manifest);
  assert.deepEqual(validation, {
    valid: true,
    structural: { valid: true, errors: [] },
    semantic: [],
  });
  const serialized = serializeImpactManifest(clean.manifest);
  assert.deepEqual(JSON.parse(serialized), clean.manifest);

  const tampered = structuredClone(clean.manifest);
  const unsupportedFile = tampered.scope.files.find(
    (file) => file.coverageClass === "unsupported",
  );
  assert.ok(unsupportedFile);
  unsupportedFile.coverageClass = "analyzed";
  const tamperedValidation = await validateImpactManifest(tampered);
  assert.equal(tamperedValidation.valid, false);
  assert.ok(
    tamperedValidation.semantic.some(
      (error) =>
        error.code === "coverage-bucket" || error.code === "digest-mismatch",
    ),
  );
  assert.notEqual(
    computeSemanticDigest(tampered),
    computeSemanticDigest(clean.manifest),
  );
});

test("Phase 3E rejects an event bound to a different head revision", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-stale-"),
  );
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--initial-branch=main");
  await git(directory, "config", "user.name", "ByteSmith Test");
  await git(directory, "config", "user.email", "test@bytesmith.dev");
  await fs.writeFile(
    path.join(directory, "file.ts"),
    "export const value = 1;\n",
  );
  const base = await commitAll(directory, "base");
  await fs.writeFile(
    path.join(directory, "file.ts"),
    "export const value = 2;\n",
  );
  const head = await commitAll(directory, "head");
  await assert.rejects(
    runPhase3Pipeline({
      repositoryPath: directory,
      base,
      head,
      expectedHeadRevision: "f".repeat(40),
      inventoryPolicy: { analyzerClaims: [] },
      analyzers: [],
      producer: { id: "repository-inventory", version: "0.1.0" },
      engineVersion: "0.1.0",
      ruleSetVersion: "0.1.0",
    }),
    /stale_revision/u,
  );
});

test("Phase 3E uses merge-base to head and excludes base-only changes", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-merge-base-"),
  );
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--initial-branch=main");
  await git(directory, "config", "user.name", "ByteSmith Test");
  await git(directory, "config", "user.email", "test@bytesmith.dev");
  await fs.writeFile(path.join(directory, "common.txt"), "common\n");
  const mergeBase = await commitAll(directory, "common");
  await git(directory, "switch", "-c", "feature");
  await fs.writeFile(path.join(directory, "feature.txt"), "feature\n");
  const featureHead = await commitAll(directory, "feature");
  await git(directory, "switch", "main");
  await fs.writeFile(path.join(directory, "base-only.txt"), "base only\n");
  const baseHead = await commitAll(directory, "base advances");

  const result = await runPhase3Pipeline({
    repositoryPath: directory,
    base: "main",
    head: "feature",
    expectedBaseRevision: baseHead,
    expectedHeadRevision: featureHead,
    inventoryPolicy: { analyzerClaims: [] },
    analyzers: [],
    producer: { id: "repository-inventory", version: "0.1.0" },
    engineVersion: "0.1.0",
    ruleSetVersion: "0.1.0",
    generatedAt: "2026-08-22T08:00:00.000Z",
  });
  assert.equal(result.snapshot.mergeBaseRevision, mergeBase);
  assert.equal(result.snapshot.diff.fromCommit, mergeBase);
  assert.deepEqual(
    result.manifest.scope.files.map((file) => file.path),
    ["feature.txt"],
  );
});
