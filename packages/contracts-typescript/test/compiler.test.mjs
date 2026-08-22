import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createTypeScriptCompilerSession,
  discoverTypeScriptProjects,
  TypeScriptDiscoveryError,
} from "../dist/index.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const revision = "a".repeat(40);

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

async function temporaryRepository(t, prefix = "bytesmith-compiler-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("Compiler API programs resolve aliases, ESM exports, and CommonJS requires", async (t) => {
  const root = await temporaryRepository(t);
  await write(root, "package.json", {
    name: "compiler-fixture",
    private: true,
  });
  await write(root, "tsconfig.json", {
    compilerOptions: {
      strict: true,
      noEmit: true,
      module: "Node16",
      moduleResolution: "Node16",
      baseUrl: ".",
      paths: { "@lib/*": ["src/*"] },
    },
    include: ["src/**/*.ts"],
  });
  await write(
    root,
    "src/internal.ts",
    "export interface Thing { value: number }\nexport const value = 1;\n",
  );
  await write(
    root,
    "src/node-fs.d.ts",
    'declare module "node:fs" { export const marker: number; }\n',
  );
  await write(
    root,
    "src/index.ts",
    [
      'import type { Thing } from "@lib/internal";',
      'export { value } from "@lib/internal";',
      'import legacyImport = require("@lib/internal");',
      'import { marker } from "node:fs";',
      "declare function require(value: string): unknown;",
      'const legacy = require("@lib/internal");',
      "void legacyImport;",
      "void marker;",
      "export const item: Thing = { value: Number(Boolean(legacy)) };",
      "",
    ].join("\n"),
  );

  const session = await createTypeScriptCompilerSession({
    repositoryRoot: root,
    repositoryId: "repo.compiler-modules",
    revision,
  });

  assert.equal(session.analysis.status, "completed");
  assert.deepEqual(session.analysis.diagnostics, []);
  assert.deepEqual(session.analysis.gaps, []);
  assert.deepEqual(
    session.analysis.moduleReferences.map((reference) => [
      reference.kind,
      reference.specifier,
      reference.resolution,
      reference.resolvedPath,
      reference.typeOnly,
    ]),
    [
      ["import", "@lib/internal", "resolved_internal", "src/internal.ts", true],
      [
        "export",
        "@lib/internal",
        "resolved_internal",
        "src/internal.ts",
        false,
      ],
      [
        "import_equals",
        "@lib/internal",
        "resolved_internal",
        "src/internal.ts",
        false,
      ],
      ["import", "node:fs", "resolved_external", undefined, false],
      [
        "require",
        "@lib/internal",
        "resolved_internal",
        "src/internal.ts",
        false,
      ],
    ],
  );
  assert.ok(session.getProgram(session.analysis.projects[0].projectId));
  assert.equal(JSON.stringify(session.analysis).includes(root), false);
});

test("the ChangeBench TypeScript path-alias fixture resolves without an unknown", async () => {
  const root = path.join(
    repositoryRoot,
    "changebench/fixtures/typescript-path-alias/after",
  );
  const session = await createTypeScriptCompilerSession({
    repositoryRoot: root,
    repositoryId: "repo.changebench-path-alias",
    revision,
  });
  const alias = session.analysis.moduleReferences.find(
    (reference) => reference.specifier === "@domain/product",
  );
  assert.ok(alias);
  assert.equal(alias.resolution, "resolved_internal");
  assert.equal(alias.resolvedPath, "domain/product.ts");
  assert.equal(
    session.analysis.gaps.some((gap) => gap.type === "unresolved_module"),
    false,
  );
});

test("jsconfig projects build JavaScript programs and resolve CommonJS modules", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-compiler-js-");
  await write(root, "jsconfig.json", {
    compilerOptions: { checkJs: false, noEmit: true },
    include: ["src/**/*.js"],
  });
  await write(root, "src/internal.js", "exports.value = 1;\n");
  await write(
    root,
    "src/index.js",
    'const internal = require("./internal.js");\nmodule.exports = internal;\n',
  );

  const session = await createTypeScriptCompilerSession({
    repositoryRoot: root,
    repositoryId: "repo.compiler-javascript",
    revision,
  });
  assert.equal(session.discovery.projects[0].configKind, "jsconfig");
  assert.equal(session.analysis.status, "completed");
  assert.equal(session.analysis.projects[0].rootFileCount, 2);
  assert.ok(session.getProgram(session.analysis.projects[0].projectId));
  assert.deepEqual(
    session.analysis.moduleReferences.map((reference) => [
      reference.kind,
      reference.resolution,
      reference.resolvedPath,
    ]),
    [["require", "resolved_internal", "src/internal.js"]],
  );
});

test("unresolved modules, computed imports, parse failures, and type errors remain explicit", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-compiler-gaps-");
  await write(root, "tsconfig.json", {
    compilerOptions: {
      strict: true,
      noEmit: true,
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["src/**/*.ts"],
  });
  await write(
    root,
    "src/index.ts",
    [
      'import { missing } from "./missing.js";',
      "export async function load(name: string) {",
      "  return import(`./${name}.js`);",
      "}",
      "export const wrong: string = 1;",
      "export { missing };",
      "",
    ].join("\n"),
  );
  await write(root, "src/broken.ts", "export const = 1;\n");

  const session = await createTypeScriptCompilerSession({
    repositoryRoot: root,
    repositoryId: "repo.compiler-gaps",
    revision,
  });
  assert.equal(session.analysis.status, "incomplete");
  assert.ok(
    session.analysis.gaps.some(
      (gap) => gap.type === "unresolved_module" && gap.path === "src/index.ts",
    ),
  );
  assert.ok(
    session.analysis.gaps.some(
      (gap) =>
        gap.type === "dynamic_import" &&
        gap.blockingRelevance === "required" &&
        gap.summary.includes("computed"),
    ),
  );
  assert.ok(session.analysis.gaps.some((gap) => gap.type === "parse_failure"));
  assert.ok(
    session.analysis.gaps.some((gap) => gap.type === "type_check_failure"),
  );
  assert.ok(
    session.analysis.moduleReferences.some(
      (reference) =>
        reference.kind === "dynamic_import" &&
        reference.resolution === "dynamic" &&
        reference.specifier === undefined,
    ),
  );
  assert.equal(JSON.stringify(session.analysis).includes(root), false);
});

test("compiler analysis is deterministic, revision-bound, and rejects mismatched inputs", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-compiler-identity-");
  await write(root, "tsconfig.json", {
    compilerOptions: { strict: true, noEmit: true },
    files: ["index.ts"],
  });
  await write(root, "index.ts", "export const value = 1;\n");
  const input = {
    repositoryRoot: root,
    repositoryId: "repo.compiler-identity",
    revision,
  };
  const first = await createTypeScriptCompilerSession(input);
  const second = await createTypeScriptCompilerSession(input);
  assert.deepEqual(second.analysis, first.analysis);

  const changedRevision = await createTypeScriptCompilerSession({
    ...input,
    revision: "b".repeat(40),
  });
  assert.notEqual(changedRevision.analysis.revision, first.analysis.revision);
  assert.notDeepEqual(changedRevision.analysis, first.analysis);

  await assert.rejects(
    createTypeScriptCompilerSession({ ...input, revision: "HEAD" }),
    (error) =>
      error instanceof TypeScriptDiscoveryError &&
      error.code === "revision_invalid",
  );
  const discovery = await discoverTypeScriptProjects({
    repositoryRoot: root,
    repositoryId: "repo.other-identity",
  });
  await assert.rejects(
    createTypeScriptCompilerSession({ ...input, discovery }),
    (error) =>
      error instanceof TypeScriptDiscoveryError &&
      error.code === "discovery_identity_mismatch",
  );
});
