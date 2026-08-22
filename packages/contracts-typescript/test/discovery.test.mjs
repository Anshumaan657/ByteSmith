import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  discoverTypeScriptProjects,
  TypeScriptDiscoveryError,
} from "../dist/index.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

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

async function temporaryRepository(t, prefix = "bytesmith-discovery-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("pnpm monorepo discovery resolves projects, references, packages, aliases, and JavaScript", async (t) => {
  const root = await temporaryRepository(t);
  await write(root, "package.json", {
    name: "discovery-root",
    private: true,
    packageManager: "pnpm@11.19.0",
  });
  await write(
    root,
    "pnpm-workspace.yaml",
    "packages:\n  - 'packages/*'\n  - 'apps/*'\n  - '!packages/ignored'\n",
  );
  await write(root, "tsconfig.base.json", {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      baseUrl: ".",
      paths: { "@core/*": ["packages/core/src/*"] },
    },
  });
  await write(root, "packages/util/package.json", {
    name: "@fixture/util",
    version: "1.0.0",
    private: true,
    type: "module",
  });
  await write(root, "packages/util/tsconfig.json", {
    extends: "../../tsconfig.base.json",
    compilerOptions: { composite: true },
    include: ["src/**/*.ts"],
  });
  await write(root, "packages/util/src/index.ts", "export const value = 1;\n");
  await write(root, "packages/core/package.json", {
    name: "@fixture/core",
    version: "1.0.0",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
  });
  await write(root, "packages/core/tsconfig.json", {
    extends: "../../tsconfig.base.json",
    compilerOptions: { composite: true },
    references: [{ path: "../util" }],
    include: ["src/**/*.ts"],
  });
  await write(
    root,
    "packages/core/src/index.ts",
    "export const core = true;\n",
  );
  await write(root, "apps/web/package.json", {
    name: "@fixture/web",
    private: true,
  });
  await write(root, "apps/web/jsconfig.json", {
    extends: "../../tsconfig.base.json",
    include: ["src/**/*.js"],
  });
  await write(root, "apps/web/src/index.js", "export const web = true;\n");

  const first = await discoverTypeScriptProjects({
    repositoryRoot: root,
    repositoryId: "repo.discovery-pnpm",
  });
  const second = await discoverTypeScriptProjects({
    repositoryRoot: root,
    repositoryId: "repo.discovery-pnpm",
  });
  assert.deepEqual(second, first);
  assert.equal(first.status, "completed");
  assert.deepEqual(first.diagnostics, []);
  assert.equal(first.workspace.manager, "pnpm");
  assert.deepEqual(first.workspace.patterns, [
    "packages/*",
    "apps/*",
    "!packages/ignored",
  ]);
  assert.deepEqual(
    first.workspace.packages.map((item) => [
      item.directory,
      item.name,
      item.workspaceMember,
    ]),
    [
      [".", "discovery-root", false],
      ["apps/web", "@fixture/web", true],
      ["packages/core", "@fixture/core", true],
      ["packages/util", "@fixture/util", true],
    ],
  );
  assert.deepEqual(
    first.projects.map((project) => project.configPath),
    [
      "apps/web/jsconfig.json",
      "packages/core/tsconfig.json",
      "packages/util/tsconfig.json",
    ],
  );
  const core = first.projects.find(
    (project) => project.configPath === "packages/core/tsconfig.json",
  );
  assert.ok(core);
  assert.equal(core.language, "typescript");
  assert.deepEqual(core.sourceFiles, ["packages/core/src/index.ts"]);
  assert.deepEqual(core.projectReferences, ["packages/util/tsconfig.json"]);
  assert.deepEqual(core.extends, ["../../tsconfig.base.json"]);
  assert.deepEqual(core.resolvedExtends, ["tsconfig.base.json"]);
  assert.deepEqual(core.compilerOptions.paths, {
    "@core/*": ["packages/core/src/*"],
  });
  assert.equal(core.compilerOptions.baseUrl, ".");
  assert.equal(core.compilerOptions.strict, true);
  assert.equal(core.compilerOptions.composite, true);
  const corePackage = first.workspace.packages.find(
    (item) => item.name === "@fixture/core",
  );
  assert.equal(core.packageId, corePackage.id);

  const web = first.projects.find(
    (project) => project.configPath === "apps/web/jsconfig.json",
  );
  assert.ok(web);
  assert.equal(web.configKind, "jsconfig");
  assert.equal(web.language, "javascript");
  assert.equal(web.compilerOptions.allowJs, true);
});

test("npm and Yarn workspace forms are classified deterministically", async (t) => {
  const npmRoot = await temporaryRepository(t, "bytesmith-npm-");
  await write(npmRoot, "package.json", {
    name: "npm-root",
    private: true,
    packageManager: "npm@11.0.0",
    workspaces: { packages: ["modules/{alpha,beta}"] },
  });
  await write(npmRoot, "modules/alpha/package.json", { name: "alpha" });
  await write(npmRoot, "modules/beta/package.json", { name: "beta" });
  const npm = await discoverTypeScriptProjects({
    repositoryRoot: npmRoot,
    repositoryId: "repo.discovery-npm",
  });
  assert.equal(npm.workspace.manager, "npm");
  assert.deepEqual(
    npm.workspace.packages
      .filter((item) => item.workspaceMember)
      .map((item) => item.name),
    ["alpha", "beta"],
  );
  const alphaId = npm.workspace.packages.find(
    (item) => item.directory === "modules/alpha",
  ).id;
  await write(npmRoot, "modules/alpha/package.json", {
    name: "alpha-renamed",
  });
  const renamed = await discoverTypeScriptProjects({
    repositoryRoot: npmRoot,
    repositoryId: "repo.discovery-npm",
  });
  assert.equal(
    renamed.workspace.packages.find(
      (item) => item.directory === "modules/alpha",
    ).id,
    alphaId,
  );

  const yarnRoot = await temporaryRepository(t, "bytesmith-yarn-");
  await write(yarnRoot, "package.json", {
    name: "yarn-root",
    private: true,
    packageManager: "yarn@4.9.0",
    workspaces: ["packages/*"],
  });
  await write(yarnRoot, "yarn.lock", "# fixture\n");
  await write(yarnRoot, "packages/app/package.json", { name: "yarn-app" });
  const yarn = await discoverTypeScriptProjects({
    repositoryRoot: yarnRoot,
    repositoryId: "repo.discovery-yarn",
  });
  assert.equal(yarn.workspace.manager, "yarn");
  assert.equal(yarn.status, "completed");
  assert.deepEqual(yarn.diagnostics, []);
});

test("invalid manifests, missing references, and external source files remain explicit", async (t) => {
  const container = await temporaryRepository(t, "bytesmith-invalid-");
  const root = path.join(container, "repository");
  await fs.mkdir(root);
  await write(root, "package.json", {
    name: "root",
    private: true,
    workspaces: ["packages/*"],
  });
  await write(root, "packages/one/package.json", { name: "duplicate" });
  await write(root, "packages/two/package.json", { name: "duplicate" });
  await write(container, "outside.ts", "export const outside = true;\n");
  await write(root, "tsconfig.json", {
    extends: "./missing-base.json",
    files: ["../outside.ts"],
    references: [{ path: "./missing-project" }],
  });

  const result = await discoverTypeScriptProjects({
    repositoryRoot: root,
    repositoryId: "repo.discovery-invalid",
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.projects[0].status, "incomplete");
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "workspace_package_duplicate",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "config_reference_missing",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "config_path_outside_repository" &&
        diagnostic.severity === "error",
    ),
  );
  assert.equal(JSON.stringify(result).includes(container), false);
});

test("the TypeScript path-alias ChangeBench fixture is discovered without host data", async () => {
  const fixture = path.join(
    repositoryRoot,
    "changebench/fixtures/typescript-path-alias/after",
  );
  const result = await discoverTypeScriptProjects({
    repositoryRoot: fixture,
    repositoryId: "repo.changebench",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.projects.length, 1);
  assert.deepEqual(result.projects[0].sourceFiles, [
    "domain/product.ts",
    "ui/product.ts",
  ]);
  assert.deepEqual(result.projects[0].compilerOptions.paths, {
    "@domain/*": ["domain/*"],
  });
  assert.equal(JSON.stringify(result).includes(fixture), false);
  const otherRepository = await discoverTypeScriptProjects({
    repositoryRoot: fixture,
    repositoryId: "repo.other",
  });
  assert.notEqual(otherRepository.projects[0].id, result.projects[0].id);
});

test("ByteSmith discovers its own workspace without false package conflicts", async () => {
  const result = await discoverTypeScriptProjects({
    repositoryRoot,
    repositoryId: "repo.bytesmith",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.workspace.manager, "pnpm");
  assert.equal(result.workspace.packages.length, 18);
  assert.equal(
    result.workspace.packages.filter((item) => item.workspaceMember).length,
    17,
  );
  assert.equal(result.projects.length, 20);
  assert.deepEqual(result.diagnostics, []);
});

test("malformed package and pnpm workspace definitions fail visibly", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-malformed-");
  await write(root, "package.json", "{ invalid json\n");
  await write(root, "pnpm-workspace.yaml", "catalog:\n  typescript: 6.0.3\n");
  const result = await discoverTypeScriptProjects({
    repositoryRoot: root,
    repositoryId: "repo.discovery-malformed",
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.workspace.manager, "pnpm");
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "package_json_invalid",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === "workspace_definition_invalid",
    ),
  );
});

test("symbolic directories are visible but never followed", async (t) => {
  const container = await temporaryRepository(t, "bytesmith-symlink-");
  const root = path.join(container, "repository");
  const external = path.join(container, "external");
  await fs.mkdir(root);
  await write(external, "tsconfig.json", { include: ["*.ts"] });
  await write(external, "external.ts", "export const external = true;\n");
  try {
    await fs.symlink(external, path.join(root, "linked-project"), "dir");
  } catch (error) {
    if (error && (error.code === "EPERM" || error.code === "EACCES")) {
      t.skip("The host does not permit symbolic-link creation.");
      return;
    }
    throw error;
  }
  const result = await discoverTypeScriptProjects({
    repositoryRoot: root,
    repositoryId: "repo.discovery-symlink",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.projects.length, 0);
  assert.deepEqual(result.diagnostics, [
    {
      code: "filesystem_entry_unsupported",
      severity: "warning",
      path: "linked-project",
      summary:
        "Symbolic filesystem entries are not followed during project discovery.",
    },
  ]);
});

test("an empty repository is a valid explicit discovery result", async (t) => {
  const root = await temporaryRepository(t, "bytesmith-empty-");
  const result = await discoverTypeScriptProjects({
    repositoryRoot: root,
    repositoryId: "repo.discovery-empty",
  });
  assert.deepEqual(result, {
    schemaVersion: "1.0.0",
    repositoryId: "repo.discovery-empty",
    workspace: { manager: "none", patterns: [], packages: [] },
    projects: [],
    diagnostics: [],
    status: "completed",
  });
});

test("a missing repository fails with a stable discovery error", async () => {
  await assert.rejects(
    discoverTypeScriptProjects({
      repositoryRoot: path.join(os.tmpdir(), "bytesmith-does-not-exist"),
      repositoryId: "repo.discovery-missing",
    }),
    (error) =>
      error instanceof TypeScriptDiscoveryError &&
      error.code === "repository_unreadable",
  );
});

test("an invalid repository identity fails before filesystem discovery", async () => {
  await assert.rejects(
    discoverTypeScriptProjects({
      repositoryRoot: path.join(os.tmpdir(), "bytesmith-does-not-exist"),
      repositoryId: "invalid repository id",
    }),
    (error) =>
      error instanceof TypeScriptDiscoveryError &&
      error.code === "repository_identity_invalid",
  );
});
