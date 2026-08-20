import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const expectedWorkspaces = new Map([
  ["apps/cli", "bytesmith"],
  ["apps/github-action", "@bytesmith/github-action"],
  ["packages/analyzer-sdk", "@bytesmith/analyzer-sdk"],
  ["packages/canonicalization", "@bytesmith/canonicalization"],
  ["packages/changebench", "@bytesmith/changebench"],
  ["packages/consumer-analysis", "@bytesmith/consumer-analysis"],
  ["packages/contracts-openapi", "@bytesmith/contracts-openapi"],
  ["packages/contracts-typescript", "@bytesmith/contracts-typescript"],
  ["packages/evidence", "@bytesmith/evidence"],
  ["packages/impact-manifest", "@bytesmith/impact-manifest"],
  ["packages/impact-types", "@bytesmith/impact-types"],
  ["packages/ir", "@bytesmith/ir"],
  ["packages/manifest-validator", "@bytesmith/manifest-validator"],
  ["packages/repository-inventory", "@bytesmith/repository-inventory"],
  ["packages/storage-sqlite", "@bytesmith/storage-sqlite"],
  ["packages/test-intelligence", "@bytesmith/test-intelligence"],
  ["packages/vcs-git", "@bytesmith/vcs-git"],
]);

const deferredPaths = [
  "apps/mcp-server",
  "apps/self-hosted-api",
  "apps/web",
  "apps/worker",
  "infra",
  "packages/artifacts-local",
  "packages/artifacts-s3",
  "packages/contracts-events",
  "packages/contracts-graphql",
  "packages/contracts-prisma",
  "packages/framework-pack-sdk",
  "packages/graph",
  "packages/pack-jest",
  "packages/pack-nestjs",
  "packages/pack-nextjs",
  "packages/pack-playwright",
  "packages/pack-vitest",
  "packages/policy-engine",
  "packages/rule-engine",
  "packages/storage-postgres",
];

async function readJson(relativePath) {
  const contents = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  return JSON.parse(contents);
}

async function assertMissing(relativePath) {
  try {
    await access(path.join(repositoryRoot, relativePath));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`Deferred MVP path is still present: ${relativePath}`);
}

async function listWorkspaceDirectories(parent) {
  const entries = await readdir(path.join(repositoryRoot, parent), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parent}/${entry.name}`)
    .sort();
}

export async function validateWorkspace() {
  const rootPackage = await readJson("package.json");
  if (rootPackage.packageManager !== "pnpm@11.19.0") {
    throw new Error("The workspace must pin pnpm@11.19.0");
  }
  if (rootPackage.engines?.node !== ">=22.13.0") {
    throw new Error("The workspace must require Node.js >=22.13.0");
  }

  const discoveredWorkspaces = [
    ...(await listWorkspaceDirectories("apps")),
    ...(await listWorkspaceDirectories("packages")),
  ].sort();
  const expectedPaths = [...expectedWorkspaces.keys()].sort();
  if (JSON.stringify(discoveredWorkspaces) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      `Workspace directories differ from the MVP map.\nExpected: ${expectedPaths.join(", ")}\nActual: ${discoveredWorkspaces.join(", ")}`,
    );
  }

  const packageNames = new Set();
  for (const [workspacePath, expectedName] of expectedWorkspaces) {
    const manifest = await readJson(`${workspacePath}/package.json`);
    if (manifest.name !== expectedName) {
      throw new Error(`${workspacePath} must be named ${expectedName}`);
    }
    if (manifest.private !== true || manifest.type !== "module") {
      throw new Error(`${workspacePath} must be a private ESM workspace`);
    }
    if (packageNames.has(manifest.name)) {
      throw new Error(`Duplicate workspace package name: ${manifest.name}`);
    }
    packageNames.add(manifest.name);
    await access(path.join(repositoryRoot, workspacePath, "tsconfig.json"));
    await access(path.join(repositoryRoot, workspacePath, "src/index.ts"));
    await assertMissing(`${workspacePath}/.gitkeep`);
  }

  for (const deferredPath of deferredPaths) {
    await assertMissing(deferredPath);
  }

  const rootTsconfig = await readJson("tsconfig.json");
  const references = rootTsconfig.references
    .map((reference) => reference.path.replace(/^\.\//, ""))
    .sort();
  if (JSON.stringify(references) !== JSON.stringify(expectedPaths)) {
    throw new Error("Root TypeScript project references must match the MVP workspaces");
  }

  return {
    applications: 2,
    packages: expectedWorkspaces.size - 2,
    workspaces: expectedWorkspaces.size,
    deferredPaths: deferredPaths.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateWorkspace();
  console.log(
    `Validated ${result.workspaces} MVP workspaces (${result.applications} apps and ${result.packages} packages); ${result.deferredPaths} deferred paths are absent.`,
  );
}
