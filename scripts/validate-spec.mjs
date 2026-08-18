import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createSchemaValidators, formatSchemaErrors } from "./lib/schema-validation.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const fixtureDirectory = path.join(root, "changebench", "fixtures");

const requiredSpecifications = [
  "product-invariants.md",
  "result-states.md",
  "vocabularies.md",
  "impact-manifest.md",
  "changebench.md",
  "rule-graduation.md",
  "canonicalization.md",
  "semantic-validation.md",
  "interface-reporting.md"
];

for (const name of requiredSpecifications) {
  await fs.access(path.join(root, "specs", name));
}

const { schemas, validators } = await createSchemaValidators(root);
const fixtureIds = (await fs.readdir(fixtureDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const fixtureId of fixtureIds) {
  const directory = path.join(fixtureDirectory, fixtureId);
  const fixture = JSON.parse(await fs.readFile(path.join(directory, "case.json"), "utf8"));

  if (!validators.changebenchCase(fixture)) {
    const details = formatSchemaErrors(validators.changebenchCase.errors).join("\n  ");
    throw new Error(`${fixtureId}: invalid ChangeBench case\n  ${details}`);
  }
  if (fixture.id !== fixtureId) {
    throw new Error(`${fixtureId}: case id must match its directory.`);
  }

  for (const snapshot of [fixture.snapshots.before, fixture.snapshots.after]) {
    const snapshotPath = path.join(directory, snapshot);
    const stat = await fs.stat(snapshotPath);
    if (!stat.isDirectory()) throw new Error(`${fixtureId}: ${snapshot} is not a directory.`);
  }

  const coverage = fixture.expected.coverage;
  const bucketTotal = coverage.analyzed
    + coverage.partiallyAnalyzed
    + coverage.unsupported
    + coverage.intentionallyExcluded;
  if (bucketTotal !== coverage.totalChangedFiles) {
    throw new Error(`${fixtureId}: coverage buckets ${bucketTotal} do not equal total ${coverage.totalChangedFiles}.`);
  }
}

const adrDirectory = path.join(root, "docs", "architecture-decisions");
const phaseZeroAdrs = (await fs.readdir(adrDirectory)).filter((name) => /^000\d-.*\.md$/u.test(name));
if (phaseZeroAdrs.length < 6) {
  throw new Error(`Expected at least 6 Phase 0 ADRs, found ${phaseZeroAdrs.length}.`);
}

process.stdout.write(
  `Validated ${Object.keys(schemas).length} Draft 2020-12 schemas, `
  + `${fixtureIds.length} ChangeBench cases, ${requiredSpecifications.length} normative specs, `
  + `and ${phaseZeroAdrs.length} Phase 0 ADRs.\n`
);
