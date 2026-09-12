import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { analyzeRepository, defaultByteSmithConfig } from "../dist/index.js";
import { validateImpactManifest } from "../../manifest-validator/dist/index.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function git(directory, ...arguments_) {
  const result = await execFileAsync("git", arguments_, {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
  });
  return result.stdout.trim();
}

async function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    typeof contents === "string"
      ? contents
      : `${JSON.stringify(contents, undefined, 2)}\n`,
  );
}

async function copyContents(source, destination) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    await fs.cp(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      {
        recursive: true,
        force: true,
      },
    );
  }
}

async function commitAll(repository, message) {
  await git(repository, "add", "--all");
  await git(
    repository,
    "-c",
    "user.name=ByteSmith Test",
    "-c",
    "user.email=test@bytesmith.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  );
  return git(repository, "rev-parse", "HEAD");
}

async function typescriptRepository(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-engine-"),
  );
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--quiet");
  await git(
    directory,
    "remote",
    "add",
    "origin",
    "https://github.com/bytesmith/engine-test.git",
  );
  await copyContents(
    path.join(
      repositoryRoot,
      "changebench/fixtures/relevant-test-selected/before",
    ),
    directory,
  );
  await write(directory, "package.json", {
    name: "engine-test",
    private: true,
    packageManager: "pnpm@11.19.0",
    scripts: { test: "vitest run" },
    devDependencies: { vitest: "4.0.0" },
  });
  await write(directory, "tsconfig.json", {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["**/*.ts"],
  });
  const base = await commitAll(directory, "before");
  await copyContents(
    path.join(
      repositoryRoot,
      "changebench/fixtures/relevant-test-selected/after",
    ),
    directory,
  );
  const head = await commitAll(directory, "after");
  return { directory, base, head };
}

async function openApiRepository(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-openapi-engine-"),
  );
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--quiet");
  await git(
    directory,
    "remote",
    "add",
    "origin",
    "https://github.com/bytesmith/openapi-engine-test.git",
  );
  await copyContents(
    path.join(
      repositoryRoot,
      "changebench/fixtures/openapi-request-field-changed/before",
    ),
    directory,
  );
  const base = await commitAll(directory, "before");
  await copyContents(
    path.join(
      repositoryRoot,
      "changebench/fixtures/openapi-request-field-changed/after",
    ),
    directory,
  );
  const head = await commitAll(directory, "after");
  return { directory, base, head };
}

test("the engine assembles, validates, persists, and reuses an exact TypeScript impact", async (t) => {
  const repository = await typescriptRepository(t);
  await write(
    repository.directory,
    "do-not-analyze.txt",
    "working tree only\n",
  );
  const config = defaultByteSmithConfig();
  config.cache.databasePath = ".bytesmith/engine-test.sqlite";
  const first = await analyzeRepository({
    repositoryPath: repository.directory,
    base: repository.base,
    head: repository.head,
    config,
    generatedAt: "2026-01-01T00:00:00Z",
  });
  const second = await analyzeRepository({
    repositoryPath: repository.directory,
    base: repository.base,
    head: repository.head,
    config,
    generatedAt: "2030-01-01T00:00:00Z",
  });

  assert.equal(first.execution.cache, "miss");
  assert.equal(first.execution.snapshots, "materialized");
  assert.equal(second.execution.cache, "hit");
  assert.equal(second.execution.snapshots, "not_materialized");
  assert.equal(
    first.manifest.integrity.semanticDigest.value,
    second.manifest.integrity.semanticDigest.value,
  );
  assert.equal(first.manifest.comparison.baseRevision, repository.base);
  assert.equal(first.manifest.comparison.headRevision, repository.head);
  assert.ok(first.manifest.changes.length >= 1);
  assert.ok(
    first.manifest.impacts.some((impact) =>
      impact.affectedComponents.some(
        (component) => component.name === "checkoutTotal",
      ),
    ),
    JSON.stringify(
      {
        changes: first.manifest.changes,
        impacts: first.manifest.impacts,
        unknowns: first.manifest.unknowns,
        analyzers: first.manifest.analyzers,
      },
      undefined,
      2,
    ),
  );
  assert.ok(
    first.manifest.tests.recommended.some(
      (recommendation) => recommendation.test.name === "checkout total test",
    ),
  );
  assert.deepEqual(await validateImpactManifest(first.manifest), {
    valid: true,
    structural: { valid: true, errors: [] },
    semantic: [],
  });
  assert.equal(
    await fs.readFile(
      path.join(repository.directory, "do-not-analyze.txt"),
      "utf8",
    ),
    "working tree only\n",
  );
});

test("an already-cancelled analysis stops before materializing snapshots", async (t) => {
  const repository = await typescriptRepository(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    analyzeRepository({
      repositoryPath: repository.directory,
      base: repository.base,
      head: repository.head,
      config: defaultByteSmithConfig(),
      signal: controller.signal,
    }),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
});

test("the engine projects an OpenAPI schema change into the final manifest", async (t) => {
  const repository = await openApiRepository(t);
  const config = defaultByteSmithConfig();
  config.analyzers.typescript.enabled = false;
  config.analyzers.tests.enabled = false;
  config.analyzers.openapi.required = true;
  config.inventoryPolicy.analyzerClaims =
    config.inventoryPolicy.analyzerClaims.filter(
      (claim) => claim.analyzerId === "bytesmith.openapi",
    );
  config.cache.enabled = false;
  const result = await analyzeRepository({
    repositoryPath: repository.directory,
    base: repository.base,
    head: repository.head,
    config,
    useCache: false,
  });
  assert.ok(
    result.manifest.changes.some(
      (change) =>
        change.kind === "schema" &&
        change.compatibility === "breaking" &&
        change.component.name === "CreateOrderRequest.quantity",
    ),
  );
  assert.deepEqual(await validateImpactManifest(result.manifest), {
    valid: true,
    structural: { valid: true, errors: [] },
    semantic: [],
  });
});
