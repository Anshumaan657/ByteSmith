#!/usr/bin/env node

import { parseArguments } from "./arguments.js";
import { executeCommand, serializeExecution } from "./commands.js";
import { writeOutputFile } from "./manifest-io.js";
import { errorEnvelope } from "./reporting.js";
import { EXIT_CODES, type OutputWriter } from "./types.js";

export * from "./arguments.js";
export * from "./benchmark.js";
export * from "./commands.js";
export * from "./doctor.js";
export * from "./manifest-io.js";
export * from "./reporting.js";
export * from "./types.js";

function errorDetails(value: unknown): {
  code?: unknown;
  details?: unknown;
} {
  return typeof value === "object" && value !== null
    ? (value as { code?: unknown; details?: unknown })
    : {};
}

function errorResult(cause: unknown) {
  const object = errorDetails(cause);
  const code =
    object.code === "unsupported_schema"
      ? "unsupported_schema"
      : object.code === "invalid_manifest"
        ? "invalid_manifest"
        : object.code === "invalid_configuration"
          ? "invalid_configuration"
          : object.code === "stale_revision"
            ? "stale_revision"
            : "error";
  const message = cause instanceof Error ? cause.message : "ByteSmith failed.";
  const exitCode =
    code === "unsupported_schema"
      ? EXIT_CODES.unsupportedSchema
      : code === "invalid_manifest" || code === "invalid_configuration"
        ? EXIT_CODES.invalidConfiguration
        : EXIT_CODES.error;
  return {
    envelope: errorEnvelope(code, message, object.details),
    exitCode,
  };
}

export async function runCli(
  argv: readonly string[],
  writer: OutputWriter = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  try {
    const args = parseArguments(argv);
    const execution = await executeCommand(args);
    const output = serializeExecution(execution, args.format);
    if (args.output) await writeOutputFile(args.output, output);
    else writer.stdout(output);
    return execution.exitCode;
  } catch (cause) {
    const result = errorResult(cause);
    writer.stderr(`${JSON.stringify(result.envelope, undefined, 2)}\n`);
    return result.exitCode;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
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
