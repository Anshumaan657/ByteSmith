#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeRepository,
  DEFAULT_CONFIG_RELATIVE_PATH,
  DEFAULT_DATABASE_RELATIVE_PATH,
  loadConfiguration,
  writeDefaultConfiguration,
} from "@bytesmith/analysis-engine";
import {
  verifySemanticDigest,
  type ImpactManifest,
} from "@bytesmith/impact-manifest";
import { validateImpactManifest } from "@bytesmith/manifest-validator";
import { SQLiteStore } from "@bytesmith/storage-sqlite";
import { discoverGitRepository } from "@bytesmith/vcs-git";

export const EXIT_CODES = {
  pass: 0,
  warn: 1,
  fail: 2,
  incomplete: 3,
  error: 4,
  invalidConfiguration: 5,
  unsupportedSchema: 6,
} as const;

type OutputFormat = "text" | "json";
type Command =
  "init" | "doctor" | "analyze" | "contracts" | "test-plan" | "verify-impact";

interface ParsedArguments {
  command: Command;
  repository: string;
  base?: string;
  head?: string;
  manifest?: string;
  config?: string;
  database?: string;
  output?: string;
  format: OutputFormat;
  noColor: boolean;
  noCache: boolean;
}

interface ErrorEnvelope {
  schemaVersion: "1.0.0";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

const commands = new Set<Command>([
  "init",
  "doctor",
  "analyze",
  "contracts",
  "test-plan",
  "verify-impact",
]);
const options = new Set([
  "repository",
  "base",
  "head",
  "manifest",
  "config",
  "database",
  "output",
  "format",
  "no-color",
  "no-cache",
]);

function usageError(message: string): never {
  throw new Error(`Invalid CLI configuration: ${message}`);
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const commandValue = argv[0] ?? "";
  if (!commands.has(commandValue as Command)) {
    usageError(
      "a command is required: init, doctor, analyze, contracts, test-plan, or verify-impact.",
    );
  }
  const result: ParsedArguments = {
    command: commandValue as Command,
    repository: process.cwd(),
    format: "text",
    noColor: false,
    noCache: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--"))
      usageError(`unexpected argument ${argument}.`);
    const name = argument.slice(2);
    if (!options.has(name)) usageError(`unknown option --${name}.`);
    if (name === "no-color") {
      result.noColor = true;
      continue;
    }
    if (name === "no-cache") {
      result.noCache = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--"))
      usageError(`--${name} requires a value.`);
    if (name === "repository") result.repository = value;
    else if (name === "base") result.base = value;
    else if (name === "head") result.head = value;
    else if (name === "manifest") result.manifest = value;
    else if (name === "config") result.config = value;
    else if (name === "database") result.database = value;
    else if (name === "output") result.output = value;
    else if (name === "format") {
      if (value !== "text" && value !== "json")
        usageError("--format must be text or json.");
      result.format = value;
    }
  }
  if (result.command === "analyze" && (!result.base || !result.head)) {
    usageError("analyze requires explicit --base and --head revisions.");
  }
  if (
    ["contracts", "test-plan", "verify-impact"].includes(result.command) &&
    !result.manifest
  ) {
    usageError(`${result.command} requires explicit --manifest path.`);
  }
  return result;
}

function errorEnvelope(
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    schemaVersion: "1.0.0",
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
}

function exitForConclusion(
  conclusion: ImpactManifest["status"]["conclusion"],
): number {
  return EXIT_CODES[conclusion];
}

function terminalManifest(manifest: ImpactManifest): string {
  const reasons =
    manifest.status.reasons.length === 0
      ? "No warnings or findings."
      : manifest.status.reasons
          .map((reason) => `- ${reason.code}: ${reason.summary}`)
          .join("\n");
  return (
    [
      `ByteSmith ${manifest.status.conclusion}`,
      `comparison ${manifest.comparison.baseRevision}..${manifest.comparison.headRevision}`,
      `scope ${manifest.scope.coverage.analyzed}/${manifest.scope.coverage.totalChangedFiles} changed files analyzed`,
      reasons,
    ].join("\n") + "\n"
  );
}

function projection(manifest: ImpactManifest, command: Command): unknown {
  if (command === "contracts") {
    return {
      schemaVersion: "1.0.0",
      manifestId: manifest.manifestId,
      comparison: manifest.comparison,
      status: manifest.status,
      changes: manifest.changes,
      impacts: manifest.impacts,
      unknowns: manifest.unknowns,
    };
  }
  if (command === "test-plan") {
    return {
      schemaVersion: "1.0.0",
      manifestId: manifest.manifestId,
      comparison: manifest.comparison,
      status: manifest.status,
      tests: manifest.tests,
      unknowns: manifest.unknowns,
    };
  }
  return {
    schemaVersion: "1.0.0",
    manifestId: manifest.manifestId,
    comparison: manifest.comparison,
    status: manifest.status,
    scope: manifest.scope,
    analyzers: manifest.analyzers,
    integrity: manifest.integrity,
  };
}

async function emit(
  value: unknown,
  format: OutputFormat,
  output: string | undefined,
  manifest?: ImpactManifest,
): Promise<void> {
  const text =
    format === "json"
      ? `${JSON.stringify(value, undefined, 2)}\n`
      : manifest
        ? terminalManifest(manifest)
        : typeof value === "string"
          ? `${value}\n`
          : `${JSON.stringify(value, undefined, 2)}\n`;
  if (output) await writeFile(path.resolve(output), text, "utf8");
  else process.stdout.write(text);
}

async function readManifest(file: string): Promise<ImpactManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.resolve(file), "utf8")) as unknown;
  } catch (cause) {
    throw new Error(
      `Manifest could not be read: ${cause instanceof Error ? cause.message : "invalid JSON"}.`,
      { cause },
    );
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "schemaVersion" in parsed &&
    parsed.schemaVersion !== "1.0.0"
  ) {
    const version = String(parsed.schemaVersion);
    const error = new Error(
      `Unsupported Impact Manifest schema version ${version}.`,
    );
    Object.assign(error, { code: "unsupported_schema" });
    throw error;
  }
  const validation = await validateImpactManifest(parsed);
  if (!validation.valid) {
    const error = new Error("Impact Manifest is invalid.");
    Object.assign(error, {
      code: "invalid_manifest",
      details: {
        structural: validation.structural.errors,
        semantic: validation.semantic,
      },
    });
    throw error;
  }
  const manifest = parsed as ImpactManifest;
  if (!verifySemanticDigest(manifest))
    throw new Error("Impact Manifest semantic digest is invalid.");
  return manifest;
}

async function main(argv: readonly string[]): Promise<number> {
  let args: ParsedArguments;
  try {
    args = parseArguments(argv);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Invalid command arguments.";
    await emit(
      errorEnvelope("invalid_configuration", message),
      "json",
      undefined,
    );
    return EXIT_CODES.invalidConfiguration;
  }

  try {
    const repository = await discoverGitRepository(args.repository);
    if (args.command === "init") {
      const configuration = await writeDefaultConfiguration(
        repository.rootPath,
      );
      const database = await SQLiteStore.open(
        path.join(repository.rootPath, DEFAULT_DATABASE_RELATIVE_PATH),
      );
      database.close();
      const result = {
        schemaVersion: "1.0.0",
        repository: repository.rootPath,
        configuration: configuration.path,
        database: path.join(
          repository.rootPath,
          DEFAULT_DATABASE_RELATIVE_PATH,
        ),
      };
      await emit(result, args.format, args.output);
      return EXIT_CODES.pass;
    }
    const configuration = await loadConfiguration(
      repository.rootPath,
      args.config
        ? path.resolve(args.config)
        : path.join(repository.rootPath, DEFAULT_CONFIG_RELATIVE_PATH),
    );
    if (args.command === "doctor") {
      const configuredDatabase = configuration.config.cache.databasePath;
      const databasePath =
        args.database ??
        (path.isAbsolute(configuredDatabase)
          ? configuredDatabase
          : path.join(repository.rootPath, configuredDatabase));
      const database = await SQLiteStore.open(databasePath);
      const result = database.doctor();
      database.close();
      await emit(result, args.format, args.output);
      return result.ok ? EXIT_CODES.pass : EXIT_CODES.error;
    }
    if (args.command === "analyze") {
      const result = await analyzeRepository({
        repositoryPath: repository.rootPath,
        base: args.base!,
        head: args.head!,
        config: configuration,
        ...(args.database ? { databasePath: args.database } : {}),
        useCache: !args.noCache,
      });
      await emit(
        args.format === "json" ? result.manifest : result.manifest,
        args.format,
        args.output,
        result.manifest,
      );
      return exitForConclusion(result.manifest.status.conclusion);
    }
    const manifest = await readManifest(args.manifest!);
    const value = projection(manifest, args.command);
    await emit(
      value,
      args.format,
      args.output,
      args.format === "text" ? manifest : undefined,
    );
    return exitForConclusion(manifest.status.conclusion);
  } catch (cause) {
    const object = cause as { code?: unknown; details?: unknown };
    const code =
      object.code === "unsupported_schema"
        ? "unsupported_schema"
        : object.code === "invalid_manifest"
          ? "invalid_manifest"
          : object.code === "invalid_configuration"
            ? "invalid_configuration"
            : "error";
    const message =
      cause instanceof Error ? cause.message : "ByteSmith failed.";
    const exitCode =
      code === "unsupported_schema"
        ? EXIT_CODES.unsupportedSchema
        : code === "invalid_manifest" || code === "invalid_configuration"
          ? EXIT_CODES.invalidConfiguration
          : EXIT_CODES.error;
    await emit(errorEnvelope(code, message, object.details), "json", undefined);
    return exitCode;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      process.stderr.write(
        `${cause instanceof Error ? cause.message : "ByteSmith failed."}\n`,
      );
      process.exitCode = EXIT_CODES.error;
    });
}
