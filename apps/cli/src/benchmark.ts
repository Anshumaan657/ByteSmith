import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  analyzeRepository,
  defaultByteSmithConfig,
} from "@bytesmith/analysis-engine";
import {
  loadChangeBenchCases,
  runChangeBench,
  validateMvpCoverage,
  type ChangeBenchActual,
  type ChangeBenchExecutor,
  type ChangeBenchReport,
} from "@bytesmith/changebench";

const execFileAsync = promisify(execFile);
const fixedDate = "2026-01-01T00:00:00.000Z";

async function git(repository: string, arguments_: readonly string[]) {
  try {
    await execFileAsync("git", arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: fixedDate,
        GIT_COMMITTER_DATE: fixedDate,
      },
      maxBuffer: 1024 * 1024,
    });
  } catch (cause) {
    throw new Error(
      `ChangeBench could not run git ${arguments_[0] ?? "command"}.`,
      { cause },
    );
  }
}

async function copyContents(source: string, destination: string) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      {
        recursive: true,
      },
    );
  }
}

async function clearWorktree(repository: string) {
  for (const entry of await readdir(repository, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    await rm(path.join(repository, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

async function ensureFixtureScaffolding(repository: string) {
  const entries = new Set(await readdir(repository));
  if (!entries.has("package.json")) {
    await writeFile(
      path.join(repository, "package.json"),
      `${JSON.stringify(
        {
          name: "bytesmith-changebench-fixture",
          private: true,
          packageManager: "pnpm@11.19.0",
          scripts: { test: "vitest run" },
          devDependencies: { vitest: "4.0.0" },
        },
        undefined,
        2,
      )}\n`,
      "utf8",
    );
  }
  if (!entries.has("tsconfig.json")) {
    await writeFile(
      path.join(repository, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
          },
          include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
        },
        undefined,
        2,
      )}\n`,
      "utf8",
    );
  }
}

async function commitSnapshot(repository: string, message: string) {
  await git(repository, ["add", "--all"]);
  await git(repository, [
    "-c",
    "user.name=ByteSmith ChangeBench",
    "-c",
    "user.email=changebench@bytesmith.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  });
  return result.stdout.trim();
}

export const executeAnalysisBenchmarkCase: ChangeBenchExecutor = async (
  context,
) => {
  const repository = await mkdtemp(
    path.join(os.tmpdir(), "bytesmith-changebench-analysis-"),
  );
  try {
    await git(repository, ["init", "--quiet"]);
    await copyContents(context.beforeDirectory, repository);
    await ensureFixtureScaffolding(repository);
    const base = await commitSnapshot(repository, "before");
    await clearWorktree(repository);
    await copyContents(context.afterDirectory, repository);
    await ensureFixtureScaffolding(repository);
    const head = await commitSnapshot(repository, "after");
    const config = defaultByteSmithConfig();
    config.analyzers.typescript.required = false;
    config.analyzers.openapi.required = false;
    config.analyzers.tests.required = false;
    config.cache.enabled = false;
    const result = await analyzeRepository({
      repositoryPath: repository,
      base,
      head,
      config,
      useCache: false,
      generatedAt: fixedDate,
    });
    return result.manifest as unknown as ChangeBenchActual;
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
};

export interface BenchmarkGates {
  contractPrecision: boolean;
  directConsumerPrecision: boolean;
  testSelectionRecall: boolean;
  determinism: boolean;
  crashFree: boolean;
}

export interface BenchmarkExecution {
  report: ChangeBenchReport;
  gates: BenchmarkGates;
  passed: boolean;
}

export async function runBenchmark(options: {
  fixturesDirectory: string;
  schemaDirectory: string;
  repeat?: number;
  cases?: readonly string[];
  executor?: ChangeBenchExecutor;
  validateCoverage?: boolean;
}): Promise<BenchmarkExecution> {
  const loaded = await loadChangeBenchCases({
    fixturesDirectory: options.fixturesDirectory,
    schemaDirectory: options.schemaDirectory,
  });
  if (options.validateCoverage !== false) validateMvpCoverage(loaded);
  const requested = new Set(options.cases ?? []);
  const selected =
    requested.size === 0
      ? loaded
      : loaded.filter((item) => requested.has(item.definition.id));
  const missing = [...requested].filter(
    (id) => !selected.some((item) => item.definition.id === id),
  );
  if (missing.length > 0) {
    throw new Error(`Unknown ChangeBench case: ${missing.sort()[0]}.`);
  }
  if (selected.length === 0) {
    throw new Error("ChangeBench requires at least one selected case.");
  }
  const report = await runChangeBench({
    cases: selected,
    executor: options.executor ?? executeAnalysisBenchmarkCase,
    repeat: options.repeat ?? 2,
  });
  const gates = {
    contractPrecision: report.metrics.contractPrecision >= 0.95,
    directConsumerPrecision: report.metrics.directConsumerPrecision >= 0.9,
    testSelectionRecall: report.metrics.testSelectionRecall >= 0.8,
    determinism: report.metrics.determinismRate === 1,
    crashFree: report.metrics.crashRate === 0,
  };
  return {
    report,
    gates,
    passed: Object.values(gates).every(Boolean) && report.metrics.failed === 0,
  };
}

export function defaultBenchmarkPaths(repository: string) {
  const root = path.resolve(repository);
  return {
    fixturesDirectory: path.join(root, "changebench", "fixtures"),
    schemaDirectory: path.join(root, "schemas"),
  };
}
