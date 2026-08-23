import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTypeScriptCompilerSession } from "../dist/index.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const baseRevision = "a".repeat(40);
const headRevision = "b".repeat(40);

async function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    typeof contents === "string"
      ? contents
      : `${JSON.stringify(contents, undefined, 2)}\n`,
  );
}

async function temporaryRepository(t, prefix = "bytesmith-symbols-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function contractNamed(analysis, name) {
  const contract = analysis.contracts.find(
    (candidate) => candidate.name === name,
  );
  assert.ok(contract, `Expected contract ${name}`);
  return contract;
}

async function analyzeChangeBenchSnapshot(t, fixture, snapshot, revision) {
  const root = await temporaryRepository(
    t,
    `bytesmith-changebench-${fixture}-${snapshot}-`,
  );
  await fs.cp(
    path.join(repositoryRoot, "changebench/fixtures", fixture, snapshot),
    root,
    { recursive: true },
  );
  await write(root, "tsconfig.json", {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["**/*.ts"],
  });
  return (
    await createTypeScriptCompilerSession({
      repositoryRoot: root,
      repositoryId: `repo.changebench-${fixture}`,
      revision,
    })
  ).analysis;
}

test("public symbols, signatures, shapes, re-exports, and package exports are structured", async (t) => {
  const root = await temporaryRepository(t);
  await write(root, "package.json", {
    name: "@fixture/contracts",
    private: true,
    type: "module",
    exports: {
      ".": "./src/index.ts",
      "./model": { types: "./src/model.ts", default: "./src/model.js" },
    },
  });
  await write(root, "tsconfig.json", {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
    },
    include: ["src/**/*.ts"],
  });
  await write(root, "src/model.ts", "export class Model { value = 1; }\n");
  await write(
    root,
    "src/index.ts",
    [
      "export interface User {",
      "  readonly id: string;",
      "  email?: string;",
      "  format(prefix: string): string;",
      "}",
      "export type UserId = string | number;",
      "export function greet<T extends User>(user: T, prefix?: string): string {",
      '  return `${prefix ?? "Hello"} ${user.id}`;',
      "}",
      "export const parse = (value: string, ...flags: boolean[]): UserId =>",
      "  flags.length > 0 ? Number(value) : value;",
      "export class Service {",
      '  public readonly name = "service";',
      '  private token = "secret";',
      "  get(id: UserId): Promise<User> {",
      "    void this.token;",
      "    return Promise.resolve({ id: String(id), format: (prefix) => prefix });",
      "  }",
      "}",
      'export { Model as PublicModel } from "./model.js";',
      "",
    ].join("\n"),
  );

  const session = await createTypeScriptCompilerSession({
    repositoryRoot: root,
    repositoryId: "repo.symbol-contracts",
    revision: baseRevision,
  });
  const { analysis } = session;
  assert.equal(analysis.status, "completed");
  assert.deepEqual(analysis.gaps, []);

  const user = analysis.symbols.find(
    (symbol) => symbol.name === "User" && symbol.kind === "interface",
  );
  assert.ok(user?.exported);
  const email = analysis.symbols.find(
    (symbol) => symbol.qualifiedName === "User.email",
  );
  assert.equal(email?.kind, "field");
  assert.equal(email?.optional, true);
  assert.equal(email?.exported, true);

  const privateToken = analysis.symbols.find(
    (symbol) => symbol.qualifiedName === "Service.token",
  );
  assert.equal(privateToken?.visibility, "private");
  assert.equal(privateToken?.exported, false);

  const greet = contractNamed(analysis, "greet");
  assert.equal(greet.kind, "function_signature");
  assert.equal(greet.exported, true);
  assert.deepEqual(greet.typeParameters, [{ name: "T", constraint: "User" }]);
  assert.deepEqual(
    greet.signatures[0].parameters.map((parameter) => [
      parameter.name,
      parameter.type,
      parameter.optional,
      parameter.rest,
    ]),
    [
      ["user", "T", false, false],
      ["prefix", "string | undefined", true, false],
    ],
  );
  assert.equal(greet.signatures[0].returnType, "string");

  const parse = contractNamed(analysis, "parse");
  assert.equal(parse.signatures[0].parameters[1].rest, true);
  assert.equal(parse.signatures[0].returnType, "UserId");

  const userShape = contractNamed(analysis, "User");
  assert.deepEqual(
    userShape.members.map((member) => [
      member.name,
      member.kind,
      member.optional,
      member.readonly,
    ]),
    [
      ["id", "field", false, true],
      ["email", "field", true, false],
      ["format", "method", false, false],
    ],
  );

  const publicModel = analysis.exports.find(
    (item) => item.exportName === "PublicModel",
  );
  assert.equal(publicModel?.kind, "re_export");
  assert.equal(publicModel?.targetPath, "src/model.ts");
  assert.ok(publicModel?.targetSymbolId);

  assert.deepEqual(
    analysis.packageExports.map((item) => [
      item.packageName,
      item.subpath,
      item.conditions,
      item.target,
    ]),
    [
      ["@fixture/contracts", ".", [], "./src/index.ts"],
      ["@fixture/contracts", "./model", ["default"], "./src/model.js"],
      ["@fixture/contracts", "./model", ["types"], "./src/model.ts"],
    ],
  );
  assert.equal(JSON.stringify(analysis).includes(root), false);
});

test("JavaScript ES declarations produce exported symbols and inferred contracts", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-symbols-js-");
  await write(root, "jsconfig.json", {
    compilerOptions: { checkJs: true, noEmit: true },
    files: ["math.js"],
  });
  await write(
    root,
    "math.js",
    [
      "/** @param {number} left @param {number} right */",
      "export function add(left, right) { return left + right; }",
      "",
    ].join("\n"),
  );
  const analysis = (
    await createTypeScriptCompilerSession({
      repositoryRoot: root,
      repositoryId: "repo.symbols-javascript",
      revision: baseRevision,
    })
  ).analysis;
  assert.equal(analysis.status, "completed");
  const add = contractNamed(analysis, "add");
  assert.equal(add.exported, true);
  assert.deepEqual(
    add.signatures[0].parameters.map((parameter) => parameter.type),
    ["number", "number"],
  );
  assert.equal(add.signatures[0].returnType, "number");
});

test("ChangeBench signatures distinguish contract edits but ignore implementation bodies", async (t) => {
  const safeBefore = await analyzeChangeBenchSnapshot(
    t,
    "safe-internal-change",
    "before",
    baseRevision,
  );
  const safeAfter = await analyzeChangeBenchSnapshot(
    t,
    "safe-internal-change",
    "after",
    headRevision,
  );
  assert.equal(
    contractNamed(safeBefore, "normalizeEmail").fingerprint,
    contractNamed(safeAfter, "normalizeEmail").fingerprint,
  );

  const requiredBefore = await analyzeChangeBenchSnapshot(
    t,
    "required-parameter-added",
    "before",
    baseRevision,
  );
  const requiredAfter = await analyzeChangeBenchSnapshot(
    t,
    "required-parameter-added",
    "after",
    headRevision,
  );
  const beforeSignature = contractNamed(requiredBefore, "createInvoice");
  const afterSignature = contractNamed(requiredAfter, "createInvoice");
  assert.notEqual(beforeSignature.fingerprint, afterSignature.fingerprint);
  assert.equal(beforeSignature.signatures[0].parameters.length, 1);
  assert.equal(afterSignature.signatures[0].parameters.length, 2);
  assert.equal(afterSignature.signatures[0].parameters[1].optional, false);

  const optionalAfter = await analyzeChangeBenchSnapshot(
    t,
    "optional-parameter-added",
    "after",
    headRevision,
  );
  assert.equal(
    contractNamed(optionalAfter, "createInvoice").signatures[0].parameters[1]
      .optional,
    true,
  );

  const returnBefore = await analyzeChangeBenchSnapshot(
    t,
    "exported-return-type-changed",
    "before",
    baseRevision,
  );
  const returnAfter = await analyzeChangeBenchSnapshot(
    t,
    "exported-return-type-changed",
    "after",
    headRevision,
  );
  assert.equal(
    contractNamed(returnBefore, "getBalance").signatures[0].returnType,
    "number",
  );
  assert.equal(
    contractNamed(returnAfter, "getBalance").signatures[0].returnType,
    "string",
  );

  const fieldAfter = await analyzeChangeBenchSnapshot(
    t,
    "optional-field-made-required",
    "after",
    headRevision,
  );
  const phone = contractNamed(fieldAfter, "Customer").members.find(
    (member) => member.name === "phone",
  );
  assert.equal(phone?.optional, false);
});

test("the ChangeBench package barrel exposes an exact export-name set", async (t) => {
  const before = await analyzeChangeBenchSnapshot(
    t,
    "package-export-removed",
    "before",
    baseRevision,
  );
  const after = await analyzeChangeBenchSnapshot(
    t,
    "package-export-removed",
    "after",
    headRevision,
  );
  assert.deepEqual(before.exports.map((item) => item.exportName).sort(), [
    "Order",
    "createOrder",
  ]);
  assert.deepEqual(after.exports.map((item) => item.exportName).sort(), [
    "Order",
  ]);
});

test("unsupported public structural signatures become required gaps", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-symbols-gaps-");
  await write(root, "package.json", {
    name: "unsupported-package",
    exports: { ".": 42 },
  });
  await write(root, "tsconfig.json", {
    compilerOptions: { strict: true, noEmit: true },
    files: ["dictionary.ts"],
  });
  await write(
    root,
    "dictionary.ts",
    "export interface Dictionary { [key: string]: string; }\n",
  );
  const analysis = (
    await createTypeScriptCompilerSession({
      repositoryRoot: root,
      repositoryId: "repo.symbols-unsupported",
      revision: baseRevision,
    })
  ).analysis;
  assert.equal(analysis.status, "incomplete");
  const gap = analysis.gaps.find(
    (candidate) => candidate.type === "unsupported_signature",
  );
  assert.ok(gap);
  assert.equal(gap.blockingRelevance, "required");
  assert.equal(gap.path, "dictionary.ts");
  assert.ok(gap.symbolId);
  const packageGap = analysis.gaps.find(
    (candidate) =>
      candidate.type === "unsupported_signature" &&
      candidate.path === "package.json",
  );
  assert.ok(packageGap?.summary.includes("Package export"));
});
