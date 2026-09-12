import path from "node:path";
import type { LoadedConfiguration } from "@bytesmith/analysis-engine";
import { analyzeOpenApiRevision } from "@bytesmith/contracts-openapi";
import { discoverTypeScriptProjects } from "@bytesmith/contracts-typescript";
import { SQLiteStore } from "@bytesmith/storage-sqlite";
import { discoverTestsAtRevision } from "@bytesmith/test-intelligence";
import {
  createRepositoryIdentity,
  inspectWorkingTree,
  type GitRepository,
} from "@bytesmith/vcs-git";

export interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  details?: unknown;
}

export interface DoctorReport {
  schemaVersion: "1.0.0";
  ok: boolean;
  repository: string;
  checks: DoctorCheck[];
}

function nodeCheck(): DoctorCheck {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((value) => Number(value));
  const supported = major > 22 || (major === 22 && minor >= 13);
  return {
    id: "node",
    status: supported ? "pass" : "fail",
    summary: supported
      ? `Node.js ${process.versions.node} is supported.`
      : `Node.js ${process.versions.node} is unsupported; ByteSmith requires 22.13.0 or newer.`,
  };
}

function diagnosticStatus(
  completed: boolean,
  diagnostics: readonly unknown[],
): "pass" | "warn" {
  return completed && diagnostics.length === 0 ? "pass" : "warn";
}

export async function runDoctor(input: {
  repository: GitRepository;
  configuration: LoadedConfiguration;
  databasePath?: string;
}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [nodeCheck()];
  const [identity, workingTree] = await Promise.all([
    createRepositoryIdentity(input.repository),
    inspectWorkingTree(input.repository),
  ]);
  checks.push({
    id: "git",
    status: "pass",
    summary: `Git repository and HEAD ${workingTree.headCommit} are readable.`,
    details: {
      repositoryId: identity.id,
      branch: workingTree.branch,
      detached: workingTree.detached,
      dirty: workingTree.dirty,
    },
  });
  checks.push({
    id: "configuration",
    status: input.configuration.exists ? "pass" : "warn",
    summary: input.configuration.exists
      ? `Configuration is valid at ${input.configuration.path}.`
      : `No configuration exists at ${input.configuration.path}; safe defaults are active.`,
    details: { digest: input.configuration.digest.value },
  });

  const databasePath =
    input.databasePath ??
    (path.isAbsolute(input.configuration.config.cache.databasePath)
      ? input.configuration.config.cache.databasePath
      : path.join(
          input.repository.rootPath,
          input.configuration.config.cache.databasePath,
        ));
  const database = await SQLiteStore.open(databasePath);
  try {
    const storage = database.doctor();
    checks.push({
      id: "sqlite",
      status: storage.ok ? "pass" : "fail",
      summary: storage.ok
        ? `SQLite schema ${storage.schemaVersion} passed integrity checks.`
        : "SQLite integrity checks failed.",
      details: storage,
    });
  } finally {
    database.close();
  }

  if (input.configuration.config.analyzers.typescript.enabled) {
    const typescript = await discoverTypeScriptProjects({
      repositoryRoot: input.repository.rootPath,
      repositoryId: identity.id,
    });
    checks.push({
      id: "typescript",
      status: diagnosticStatus(
        typescript.status === "completed",
        typescript.diagnostics,
      ),
      summary: `TypeScript discovery found ${typescript.projects.length} project(s) and ${typescript.diagnostics.length} diagnostic(s).`,
      details: typescript.diagnostics,
    });
  }
  if (input.configuration.config.analyzers.openapi.enabled) {
    const openapi = await analyzeOpenApiRevision(identity.id, {
      directory: input.repository.rootPath,
      revision: workingTree.headCommit,
    });
    checks.push({
      id: "openapi",
      status: openapi.gaps.length === 0 ? "pass" : "warn",
      summary: `OpenAPI discovery found ${openapi.documents.length} document(s) and ${openapi.gaps.length} gap(s).`,
      details: openapi.gaps,
    });
  }
  if (input.configuration.config.analyzers.tests.enabled) {
    const tests = await discoverTestsAtRevision({
      repositoryRoot: input.repository.rootPath,
      repositoryId: identity.id,
      revision: workingTree.headCommit,
    });
    checks.push({
      id: "tests",
      status: diagnosticStatus(tests.status === "completed", tests.diagnostics),
      summary: `Jest/Vitest discovery found ${tests.projects.length} project(s), ${tests.testFiles.length} file(s), and ${tests.diagnostics.length} diagnostic(s).`,
      details: tests.diagnostics,
    });
  }
  return {
    schemaVersion: "1.0.0",
    ok: checks.every((check) => check.status !== "fail"),
    repository: input.repository.rootPath,
    checks,
  };
}

export function renderDoctor(report: DoctorReport, useColor: boolean): string {
  const color = (status: DoctorCheck["status"], value: string) => {
    if (!useColor) return value;
    const code = status === "pass" ? 32 : status === "warn" ? 33 : 31;
    return `\u001b[${code}m${value}\u001b[0m`;
  };
  return `${[
    `ByteSmith doctor: ${report.ok ? "ready" : "not ready"}`,
    `Repository: ${report.repository}`,
    ...report.checks.map(
      (check) =>
        `${color(check.status, check.status.toUpperCase().padEnd(4))} ${check.id}: ${check.summary}`,
    ),
  ].join("\n")}\n`;
}
