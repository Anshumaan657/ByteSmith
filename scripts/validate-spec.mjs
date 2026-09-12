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
const portfolio = JSON.parse(
  await fs.readFile(
    path.join(root, "validation", "portfolio", "evaluations.json"),
    "utf8",
  ),
);
if (!validators.validationPortfolio(portfolio)) {
  const details = formatSchemaErrors(
    validators.validationPortfolio.errors,
  ).join("\n  ");
  throw new Error(`Invalid validation portfolio\n  ${details}`);
}
const requiredProfiles = [
  "ordinary-typescript",
  "monorepo",
  "api-backend",
  "openapi",
  "older-inconsistent",
];
for (const profile of requiredProfiles) {
  const matches = portfolio.evaluations.filter(
    (evaluation) => evaluation.profile === profile,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Validation portfolio requires exactly one ${profile} evaluation.`,
    );
  }
}
const fixtureIds = (await fs.readdir(fixtureDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const mvpTagCounts = new Map(
  Array.from({ length: 20 }, (_, index) => [`mvp-${String(index + 1).padStart(2, "0")}`, 0])
);

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
  for (const tag of fixture.tags ?? []) {
    if (mvpTagCounts.has(tag)) mvpTagCounts.set(tag, mvpTagCounts.get(tag) + 1);
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

const invalidMvpTags = [...mvpTagCounts].filter(([, count]) => count !== 1);
if (invalidMvpTags.length > 0) {
  throw new Error(`Each MVP case tag mvp-01 through mvp-20 must occur exactly once: ${JSON.stringify(invalidMvpTags)}`);
}

const adrDirectory = path.join(root, "docs", "architecture-decisions");
const phaseZeroAdrs = (await fs.readdir(adrDirectory)).filter((name) => /^000\d-.*\.md$/u.test(name));
if (phaseZeroAdrs.length < 6) {
  throw new Error(`Expected at least 6 Phase 0 ADRs, found ${phaseZeroAdrs.length}.`);
}

process.stdout.write(
  `Validated ${Object.keys(schemas).length} Draft 2020-12 schemas, `
  + `${fixtureIds.length} ChangeBench cases (all 20 MVP behaviors), ${requiredSpecifications.length} normative specs, `
  + `and ${phaseZeroAdrs.length} Phase 0 ADRs.\n`
);
