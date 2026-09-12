import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCli } from "../dist/index.js";

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

async function copyFixture(name, snapshot, destination) {
  const source = path.join(
    repositoryRoot,
    "changebench",
    "fixtures",
    name,
    snapshot,
  );
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    await fs.cp(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      { recursive: true, force: true },
    );
  }
}

async function writeJson(directory, relativePath, value) {
  const target = path.join(directory, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, undefined, 2)}\n`);
}

async function commitAll(directory, message) {
  await git(directory, "add", "--all");
  await git(
    directory,
    "-c",
    "user.name=ByteSmith CLI Test",
    "-c",
    "user.email=cli@bytesmith.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  );
  return git(directory, "rev-parse", "HEAD");
}

async function makeRepository(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bytesmith-cli-"));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--quiet");
  await git(
    directory,
    "remote",
    "add",
    "origin",
    "https://github.com/bytesmith/cli-e2e.git",
  );
  await copyFixture("relevant-test-selected", "before", directory);
  await writeJson(directory, "package.json", {
    name: "bytesmith-cli-e2e",
    private: true,
    scripts: { test: "vitest run" },
    devDependencies: { vitest: "4.0.0" },
  });
  await writeJson(directory, "tsconfig.json", {
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
  await copyFixture("relevant-test-selected", "after", directory);
  const head = await commitAll(directory, "after");
  return { directory, base, head };
}

async function invoke(arguments_) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(arguments_, {
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { exitCode, stdout, stderr };
}

test("the public CLI initializes, diagnoses, analyzes, inspects, and rejects stale or corrupt manifests", async (t) => {
  const repository = await makeRepository(t);
  const manifestPath = path.join(
    repository.directory,
    "reports",
    "impact.json",
  );

  const initialized = await invoke([
    "init",
    "--repository",
    repository.directory,
    "--format",
    "json",
  ]);
  assert.equal(initialized.exitCode, 0);
  assert.equal(JSON.parse(initialized.stdout).configurationCreated, true);
  const configPath = path.join(
    repository.directory,
    ".bytesmith",
    "config.json",
  );
  const originalConfig = await fs.readFile(configPath, "utf8");

  const initializedAgain = await invoke([
    "init",
    "--repository",
    repository.directory,
    "--format",
    "json",
  ]);
  assert.equal(initializedAgain.exitCode, 0);
  assert.equal(JSON.parse(initializedAgain.stdout).configurationCreated, false);
  assert.equal(await fs.readFile(configPath, "utf8"), originalConfig);

  const doctor = await invoke([
    "doctor",
    "--repository",
    repository.directory,
    "--format",
    "json",
  ]);
  assert.equal(doctor.exitCode, 0);
  const doctorReport = JSON.parse(doctor.stdout);
  assert.equal(doctorReport.ok, true);
  assert.ok(doctorReport.checks.some((check) => check.id === "sqlite"));
  assert.ok(doctorReport.checks.some((check) => check.id === "typescript"));

  const analysis = await invoke([
    "analyze",
    "--repository",
    repository.directory,
    "--base",
    repository.base,
    "--head",
    repository.head,
    "--format",
    "json",
    "--output",
    manifestPath,
  ]);
  assert.equal(analysis.stdout, "");
  assert.equal(analysis.stderr, "");
  assert.ok([0, 1, 2, 3].includes(analysis.exitCode));
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.comparison.baseRevision, repository.base);
  assert.equal(manifest.comparison.headRevision, repository.head);

  const contracts = await invoke([
    "contracts",
    "--repository",
    repository.directory,
    "--manifest",
    manifestPath,
    "--no-color",
  ]);
  assert.match(contracts.stdout, /Contract changes/u);
  assert.match(contracts.stdout, /calculateTax/u);
  const plan = await invoke([
    "test-plan",
    "--repository",
    repository.directory,
    "--manifest",
    manifestPath,
    "--no-color",
  ]);
  assert.match(plan.stdout, /checkout\.test\.ts/u);

  const verified = await invoke([
    "verify-impact",
    "--repository",
    repository.directory,
    "--manifest",
    manifestPath,
    "--no-color",
  ]);
  assert.equal(verified.stderr, "");
  assert.equal(verified.exitCode, analysis.exitCode);

  await fs.writeFile(path.join(repository.directory, "later.txt"), "later\n");
  await commitAll(repository.directory, "later");
  const stale = await invoke([
    "verify-impact",
    "--repository",
    repository.directory,
    "--manifest",
    manifestPath,
  ]);
  assert.equal(stale.exitCode, 4);
  assert.equal(JSON.parse(stale.stderr).error.code, "stale_revision");

  const corruptPath = path.join(
    repository.directory,
    "reports",
    "corrupt.json",
  );
  await fs.writeFile(corruptPath, "{}\n");
  const corrupt = await invoke([
    "contracts",
    "--repository",
    repository.directory,
    "--manifest",
    corruptPath,
  ]);
  assert.equal(corrupt.exitCode, 5);
  assert.equal(JSON.parse(corrupt.stderr).error.code, "invalid_manifest");
});
