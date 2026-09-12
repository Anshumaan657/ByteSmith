import type { Command, ParsedArguments } from "./types.js";

const commands = new Set<Command>([
  "init",
  "doctor",
  "analyze",
  "contracts",
  "test-plan",
  "verify-impact",
  "benchmark",
]);

const valueOptions = new Set([
  "repository",
  "base",
  "head",
  "manifest",
  "config",
  "database",
  "output",
  "format",
  "fixtures",
  "schemas",
  "case",
  "repeat",
]);

const booleanOptions = new Set(["no-color", "no-cache"]);

function usageError(message: string): never {
  const error = new Error(`Invalid CLI configuration: ${message}`);
  Object.assign(error, { code: "invalid_configuration" });
  throw error;
}

function positiveInteger(value: string, option: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    usageError(`--${option} must be a positive integer.`);
  }
  return number;
}

export function parseArguments(
  argv: readonly string[],
  currentDirectory = process.cwd(),
): ParsedArguments {
  const commandValue = argv[0] ?? "";
  if (!commands.has(commandValue as Command)) {
    usageError(
      "a command is required: init, doctor, analyze, contracts, test-plan, verify-impact, or benchmark.",
    );
  }
  const result: ParsedArguments = {
    command: commandValue as Command,
    repository: currentDirectory,
    format: "text",
    noColor: false,
    noCache: false,
    repeat: 2,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      usageError(`unexpected argument ${argument}.`);
    }
    const name = argument.slice(2);
    if (booleanOptions.has(name)) {
      if (name === "no-color") result.noColor = true;
      else result.noCache = true;
      continue;
    }
    if (!valueOptions.has(name)) usageError(`unknown option --${name}.`);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) {
      usageError(`--${name} requires a value.`);
    }
    if (name === "repository") result.repository = value;
    else if (name === "base") result.base = value;
    else if (name === "head") result.head = value;
    else if (name === "manifest") result.manifest = value;
    else if (name === "config") result.config = value;
    else if (name === "database") result.database = value;
    else if (name === "output") result.output = value;
    else if (name === "fixtures") result.fixtures = value;
    else if (name === "schemas") result.schemas = value;
    else if (name === "case") result.cases = [...(result.cases ?? []), value];
    else if (name === "repeat") result.repeat = positiveInteger(value, name);
    else if (name === "format") {
      if (value !== "text" && value !== "json") {
        usageError("--format must be text or json.");
      }
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
