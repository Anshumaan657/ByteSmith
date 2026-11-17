import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createReleaseAudit } from "./lib/release-audit.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a file path.`);
  }
  return value;
}

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function benchmark() {
  const cli = path.join(root, "apps", "cli", "dist", "index.js");
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cli,
        "benchmark",
        "--repository",
        root,
        "--format",
        "json",
        "--no-color",
      ],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } catch (cause) {
    const stdout =
      cause && typeof cause === "object" ? cause.stdout : undefined;
    if (typeof stdout === "string" && stdout.trim().length > 0) {
      return JSON.parse(stdout);
    }
    throw cause;
  }
}

const benchmarkReport = argumentValue("--benchmark-report");
const output = path.resolve(
  root,
  argumentValue("--output") ?? "validation/release-audit.json",
);
const result = createReleaseAudit({
  benchmark: benchmarkReport
    ? await json(path.resolve(root, benchmarkReport))
    : await benchmark(),
  portfolio: await json(
    path.join(root, "validation", "portfolio", "evaluations.json"),
  ),
  usability: await json(
    path.join(root, "validation", "usability", "evaluations.json"),
  ),
  generatedAt: new Date().toISOString(),
  revision: (
    await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    })
  ).stdout.trim(),
});
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, undefined, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
process.exitCode = result.conclusion.releaseReady ? 0 : 1;
