import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const actionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const entrypoint = path.join(actionRoot, "dist", "bundle", "index.js");
const source = await readFile(entrypoint, "utf8");
const runtimePrelude = [
  'import { createRequire as __bytesmithCreateRequire } from "node:module";',
  'import { fileURLToPath as __bytesmithFileURLToPath } from "node:url";',
  'import { dirname as __bytesmithDirname } from "node:path";',
  "const require = __bytesmithCreateRequire(import.meta.url);",
  "const __filename = __bytesmithFileURLToPath(import.meta.url);",
  "const __dirname = __bytesmithDirname(__filename);",
  'process.env.BYTESMITH_SCHEMA_DIRECTORY ??= __bytesmithDirname(__filename) + "/schemas";',
  "process.env.BYTESMITH_TYPESCRIPT_LIB_DIRECTORY ??= __bytesmithDirname(__filename);",
  "",
].join("\n");

if (!source.startsWith(runtimePrelude)) {
  await writeFile(entrypoint, `${runtimePrelude}${source}`, "utf8");
}

const bundleDirectory = path.dirname(entrypoint);
await rm(path.join(bundleDirectory, "typescript"), {
  recursive: true,
  force: true,
});
const workerAsset = (
  await Promise.all(
    (await readdir(bundleDirectory))
      .filter((name) => name.endsWith(".js") && name !== "index.js")
      .map(async (name) => ({
        name,
        source: await readFile(path.join(bundleDirectory, name), "utf8"),
      })),
  )
).find(({ source: candidate }) =>
  candidate.includes("TypeScript analyzer worker requires a parent port."),
);
if (!workerAsset) {
  throw new Error("ncc did not emit the TypeScript analyzer worker asset.");
}

const temporary = await mkdtemp(
  path.join(os.tmpdir(), "bytesmith-action-worker-"),
);
try {
  const ncc = path.join(actionRoot, "node_modules", ".bin", "ncc");
  const workerSource = path.resolve(
    actionRoot,
    "..",
    "..",
    "packages",
    "contracts-typescript",
    "dist",
    "analyzer-worker.js",
  );
  await execFileAsync(ncc, [
    "build",
    workerSource,
    "--out",
    temporary,
    "--minify",
    "--asset-builds",
  ]);
  const bundledWorker = await readFile(
    path.join(temporary, "index.js"),
    "utf8",
  );
  await writeFile(
    path.join(bundleDirectory, workerAsset.name),
    `${runtimePrelude}${bundledWorker}`,
    "utf8",
  );
  for (const name of await readdir(temporary)) {
    if (name !== "index.js" && name !== "package.json") {
      await copyFile(
        path.join(temporary, name),
        path.join(bundleDirectory, name),
      );
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const schemaOutput = path.join(actionRoot, "dist", "bundle", "schemas");
const schemaSource = path.resolve(actionRoot, "..", "..", "schemas");
await mkdir(schemaOutput, { recursive: true });
for (const name of [
  "impact-types.schema.json",
  "impact-manifest.schema.json",
]) {
  await copyFile(path.join(schemaSource, name), path.join(schemaOutput, name));
}

const typescriptOutput = path.join(actionRoot, "dist", "bundle");
const typescriptSource = path.resolve(
  actionRoot,
  "..",
  "..",
  "packages",
  "contracts-typescript",
  "node_modules",
  "typescript",
  "lib",
);
await mkdir(typescriptOutput, { recursive: true });
for (const name of await readdir(typescriptSource)) {
  if (name.startsWith("lib.") && name.endsWith(".d.ts")) {
    await copyFile(
      path.join(typescriptSource, name),
      path.join(typescriptOutput, name),
    );
  }
}
