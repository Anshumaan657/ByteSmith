import fs from "node:fs/promises";
import path from "node:path";
import Ajv2020Module, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ChangeBenchCase, LoadedChangeBenchCase } from "./types.js";

export interface LoadCasesOptions {
  fixturesDirectory: string;
  schemaDirectory: string;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    )
    .join("; ");
}

function resolveInside(directory: string, relativePath: string): string {
  const resolved = path.resolve(directory, relativePath);
  const relative = path.relative(directory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Snapshot path escapes its fixture directory: ${relativePath}`,
    );
  }
  return resolved;
}

async function assertSafeSnapshotTree(directory: string): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw new Error(
        `Snapshot must not contain symbolic links: ${path.join(directory, entry.name)}`,
      );
    if (entry.isDirectory())
      await assertSafeSnapshotTree(path.join(directory, entry.name));
  }
}

async function snapshotFiles(
  directory: string,
  baseDirectory = directory,
  files = new Map<string, Buffer>(),
): Promise<Map<string, Buffer>> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await snapshotFiles(entryPath, baseDirectory, files);
    } else {
      files.set(
        path.relative(baseDirectory, entryPath),
        await fs.readFile(entryPath),
      );
    }
  }
  return files;
}

async function countChangedFiles(
  beforeDirectory: string,
  afterDirectory: string,
): Promise<number> {
  const [before, after] = await Promise.all([
    snapshotFiles(beforeDirectory),
    snapshotFiles(afterDirectory),
  ]);
  const paths = new Set([...before.keys(), ...after.keys()]);
  let changed = 0;
  for (const filePath of paths) {
    const beforeBytes = before.get(filePath);
    const afterBytes = after.get(filePath);
    if (!beforeBytes || !afterBytes || !beforeBytes.equals(afterBytes))
      changed += 1;
  }
  return changed;
}

async function createValidator(
  schemaDirectory: string,
): Promise<ValidateFunction<ChangeBenchCase>> {
  const [typesText, caseText] = await Promise.all([
    fs.readFile(path.join(schemaDirectory, "impact-types.schema.json"), "utf8"),
    fs.readFile(
      path.join(schemaDirectory, "changebench-case.schema.json"),
      "utf8",
    ),
  ]);
  const Ajv2020 = Ajv2020Module as unknown as new (
    options: Record<string, unknown>,
  ) => {
    addSchema(schema: object): void;
    compile<T>(schema: object): ValidateFunction<T>;
  };
  const addFormats = addFormatsModule as unknown as (ajv: unknown) => void;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: true,
  });
  addFormats(ajv);
  ajv.addSchema(JSON.parse(typesText) as object);
  return ajv.compile<ChangeBenchCase>(JSON.parse(caseText) as object);
}

export async function loadChangeBenchCases(
  options: LoadCasesOptions,
): Promise<LoadedChangeBenchCase[]> {
  const validate = await createValidator(options.schemaDirectory);
  const entries = (
    await fs.readdir(options.fixturesDirectory, { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const cases: LoadedChangeBenchCase[] = [];

  for (const entry of entries) {
    const directory = path.join(options.fixturesDirectory, entry.name);
    const definition = JSON.parse(
      await fs.readFile(path.join(directory, "case.json"), "utf8"),
    ) as unknown;
    if (!validate(definition)) {
      throw new Error(
        `${entry.name}: invalid ChangeBench case: ${formatErrors(validate.errors)}`,
      );
    }
    if (definition.id !== entry.name)
      throw new Error(`${entry.name}: case id must match its directory.`);
    const beforeDirectory = resolveInside(
      directory,
      definition.snapshots.before,
    );
    const afterDirectory = resolveInside(directory, definition.snapshots.after);
    for (const snapshotDirectory of [beforeDirectory, afterDirectory]) {
      const stat = await fs.stat(snapshotDirectory);
      if (!stat.isDirectory())
        throw new Error(
          `${entry.name}: snapshot is not a directory: ${snapshotDirectory}`,
        );
      await assertSafeSnapshotTree(snapshotDirectory);
    }
    const coverage = definition.expected.coverage;
    const bucketTotal =
      coverage.analyzed +
      coverage.partiallyAnalyzed +
      coverage.unsupported +
      coverage.intentionallyExcluded;
    if (bucketTotal !== coverage.totalChangedFiles) {
      throw new Error(
        `${entry.name}: coverage buckets ${bucketTotal} do not equal total ${coverage.totalChangedFiles}.`,
      );
    }
    const changedFileCount = await countChangedFiles(
      beforeDirectory,
      afterDirectory,
    );
    if (changedFileCount !== coverage.totalChangedFiles) {
      throw new Error(
        `${entry.name}: expected ${coverage.totalChangedFiles} changed files but snapshots contain ${changedFileCount}.`,
      );
    }
    cases.push({ definition, directory, beforeDirectory, afterDirectory });
  }
  return cases;
}

export function validateMvpCoverage(cases: LoadedChangeBenchCase[]): void {
  const requiredTags = Array.from(
    { length: 20 },
    (_, index) => `mvp-${String(index + 1).padStart(2, "0")}`,
  );
  const counts = new Map(requiredTags.map((tag) => [tag, 0]));
  for (const loadedCase of cases) {
    for (const tag of loadedCase.definition.tags ?? []) {
      if (counts.has(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const invalid = [...counts].filter(([, count]) => count !== 1);
  if (invalid.length > 0) {
    throw new Error(
      `MVP coverage requires each mvp-01 through mvp-20 tag exactly once: ${JSON.stringify(invalid)}`,
    );
  }
}
