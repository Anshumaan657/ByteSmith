import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createRepositoryInventory,
  InventoryError,
  pathMatches,
  validateInventoryPolicy,
} from "../dist/index.js";
import {
  discoverGitRepository,
  readGitDiff,
} from "../../vcs-git/dist/index.js";

const execFileAsync = promisify(execFile);
const fromCommit = "a".repeat(40);
const toCommit = "b".repeat(40);

function changed(pathname, overrides = {}) {
  return {
    path: pathname,
    changeType: "modified",
    oldMode: "100644",
    newMode: "100644",
    oldObjectId: "c".repeat(40),
    newObjectId: "d".repeat(40),
    fileKind: "regular",
    binary: false,
    ...overrides,
  };
}

function diff(files, overrides = {}) {
  return {
    fromCommit,
    toCommit,
    totalChangedFiles: files.length,
    files,
    ...overrides,
  };
}

const policy = {
  analyzerClaims: [
    { analyzerId: "typescript", matcher: { extensions: [".ts", ".js"] } },
    { analyzerId: "openapi", matcher: { fileNames: ["openapi.yaml"] } },
  ],
  rules: [
    {
      id: "generated-clients",
      kind: "generated",
      reason: "client code is regenerated from its contract",
      matcher: { pathPrefixes: ["generated"] },
    },
    {
      id: "ignored-fixtures",
      kind: "ignored",
      reason: "repository configuration excludes these fixtures",
      matcher: { pathSegments: ["ignored"] },
    },
    {
      id: "excluded-vendor",
      kind: "excluded",
      reason: "vendored source is outside the selected scope",
      matcher: { pathPrefixes: ["vendor"] },
    },
    {
      id: "legacy-partial",
      kind: "partially_analyzed",
      reason: "the legacy syntax subset is only partially supported",
      matcher: { exactPaths: ["legacy/module.ts"] },
      analyzerIds: ["typescript"],
    },
    {
      id: "unsupported-config",
      kind: "unsupported",
      reason: "this configuration language is not in the MVP",
      matcher: { extensions: [".toml"] },
    },
  ],
};

test("inventory retains every changed path and assigns exactly one visible coverage class", () => {
  const source = diff([
    changed("vendor/library.ts"),
    changed("src/app.ts"),
    changed("openapi.yaml"),
    changed("generated/client.ts"),
    changed("ignored/fixture.ts"),
    changed("legacy/module.ts"),
    changed("settings.toml"),
    changed("README.md"),
    changed("image.bin", { binary: true }),
    changed("link.ts", { fileKind: "symlink", newMode: "120000" }),
    changed("modules/api", { fileKind: "submodule", newMode: "160000" }),
    changed("special/device", { fileKind: "unknown", newMode: "140000" }),
    changed("scripts/run.js", { fileKind: "executable", newMode: "100755" }),
  ]);

  const inventory = createRepositoryInventory(source, policy);
  assert.equal(inventory.fromCommit, fromCommit);
  assert.equal(inventory.toCommit, toCommit);
  assert.equal(inventory.files.length, source.totalChangedFiles);
  assert.deepEqual(inventory.coverage, {
    totalChangedFiles: 13,
    analyzed: 3,
    partiallyAnalyzed: 1,
    unsupported: 6,
    intentionallyExcluded: 3,
  });
  assert.deepEqual(
    inventory.files.map((file) => file.path),
    source.files.map((file) => file.path).sort(),
  );

  const byPath = new Map(inventory.files.map((file) => [file.path, file]));
  assert.deepEqual(byPath.get("src/app.ts").analyzerIds, ["typescript"]);
  assert.equal(byPath.get("src/app.ts").reason, undefined);
  assert.deepEqual(byPath.get("openapi.yaml").analyzerIds, ["openapi"]);
  assert.equal(
    byPath.get("legacy/module.ts").coverageClass,
    "partially_analyzed",
  );
  assert.match(byPath.get("legacy/module.ts").reason, /^Partially analyzed:/u);
  assert.match(byPath.get("generated/client.ts").reason, /^Generated file:/u);
  assert.match(byPath.get("ignored/fixture.ts").reason, /^Ignored by policy:/u);
  assert.match(
    byPath.get("vendor/library.ts").reason,
    /^Intentionally excluded:/u,
  );
  assert.match(byPath.get("settings.toml").reason, /^Unsupported input:/u);
  assert.match(byPath.get("README.md").reason, /^Unsupported path:/u);
  assert.match(byPath.get("image.bin").reason, /^Binary file:/u);
  assert.match(byPath.get("link.ts").reason, /^Symbolic link:/u);
  assert.match(byPath.get("modules/api").reason, /^Git submodule:/u);
  assert.match(
    byPath.get("special/device").reason,
    /^Unsupported Git file mode:/u,
  );
});

test("inventory preserves rename metadata and is deterministic for shuffled input", () => {
  const renamed = changed("src/new.ts", {
    previousPath: "src/old.ts",
    changeType: "renamed",
    similarity: 93,
  });
  const copied = changed("src/copied.ts", {
    previousPath: "src/source.ts",
    changeType: "copied",
    similarity: 100,
  });
  const first = createRepositoryInventory(
    diff([changed("src/z.ts"), renamed, copied, changed("src/a.ts")]),
    policy,
  );
  const second = createRepositoryInventory(
    diff([copied, changed("src/a.ts"), changed("src/z.ts"), renamed]),
    policy,
  );
  assert.deepEqual(second, first);
  const byPath = new Map(first.files.map((file) => [file.path, file]));
  assert.equal(byPath.get("src/new.ts").previousPath, "src/old.ts");
  assert.equal(byPath.get("src/new.ts").similarity, 93);
  assert.equal(byPath.get("src/copied.ts").previousPath, "src/source.ts");
  assert.equal(byPath.get("src/copied.ts").similarity, 100);
});

test("overlapping analyzer claims produce stable unique analyzer IDs", () => {
  const inventory = createRepositoryInventory(diff([changed("src/app.ts")]), {
    analyzerClaims: [
      { analyzerId: "zeta", matcher: { extensions: [".ts"] } },
      { analyzerId: "alpha", matcher: { exactPaths: ["src/app.ts"] } },
    ],
  });
  assert.deepEqual(inventory.files[0].analyzerIds, ["alpha", "zeta"]);
});

test("empty diffs produce an explicit zero denominator", () => {
  assert.deepEqual(
    createRepositoryInventory(diff([]), { analyzerClaims: [] }),
    {
      fromCommit,
      toCommit,
      files: [],
      coverage: {
        totalChangedFiles: 0,
        analyzed: 0,
        partiallyAnalyzed: 0,
        unsupported: 0,
        intentionallyExcluded: 0,
      },
    },
  );
});

test("binary and special-file safety takes precedence over path rules", () => {
  const inventory = createRepositoryInventory(
    diff([
      changed("generated/binary.ts", { binary: true }),
      changed("generated/link.ts", { fileKind: "symlink" }),
    ]),
    policy,
  );
  assert.equal(inventory.coverage.unsupported, 2);
  assert.equal(inventory.coverage.intentionallyExcluded, 0);
  assert.match(inventory.files[0].reason, /^Binary file:/u);
  assert.match(inventory.files[1].reason, /^Symbolic link:/u);
});

test("overlapping policy rules fail instead of silently choosing precedence", () => {
  const ambiguous = {
    analyzerClaims: policy.analyzerClaims,
    rules: [
      {
        id: "first",
        kind: "ignored",
        reason: "first rule",
        matcher: { extensions: [".ts"] },
      },
      {
        id: "second",
        kind: "excluded",
        reason: "second rule",
        matcher: { exactPaths: ["src/app.ts"] },
      },
    ],
  };
  assert.throws(
    () => createRepositoryInventory(diff([changed("src/app.ts")]), ambiguous),
    (error) =>
      error instanceof InventoryError &&
      error.code === "inventory_rule_ambiguous",
  );
});

test("invalid policies fail with one stable policy error", () => {
  const invalidPolicies = [
    {
      analyzerClaims: [
        { analyzerId: "typescript", matcher: { extensions: [".ts"] } },
        { analyzerId: "typescript", matcher: { extensions: [".js"] } },
      ],
    },
    {
      analyzerClaims: [
        { analyzerId: "bad id", matcher: { extensions: [".ts"] } },
      ],
    },
    { analyzerClaims: [{ analyzerId: "typescript", matcher: {} }] },
    {
      analyzerClaims: [],
      rules: [
        {
          id: "escape",
          kind: "excluded",
          reason: "invalid path",
          matcher: { exactPaths: ["../outside"] },
        },
      ],
    },
    {
      analyzerClaims: policy.analyzerClaims,
      rules: [
        {
          id: "partial",
          kind: "partially_analyzed",
          reason: "unknown analyzer",
          matcher: { extensions: [".ts"] },
          analyzerIds: ["missing"],
        },
      ],
    },
  ];
  for (const invalidPolicy of invalidPolicies) {
    assert.throws(
      () => validateInventoryPolicy(invalidPolicy),
      (error) =>
        error instanceof InventoryError &&
        error.code === "inventory_policy_invalid",
    );
  }
});

test("malformed diff denominators and paths fail closed", () => {
  const invalidDiffs = [
    diff([changed("src/app.ts")], { totalChangedFiles: 2 }),
    diff([changed("src/app.ts"), changed("src/app.ts")]),
    diff([changed("src/../app.ts")]),
    diff([changed("src/app.ts")], { fromCommit: "main" }),
    diff([changed("src/new.ts", { changeType: "renamed" })]),
  ];
  for (const invalidDiff of invalidDiffs) {
    assert.throws(
      () => createRepositoryInventory(invalidDiff, policy),
      (error) =>
        error instanceof InventoryError &&
        error.code === "inventory_diff_invalid",
    );
  }
});

test("path matchers use repository boundaries rather than substring guesses", () => {
  assert.equal(
    pathMatches("vendor/file.ts", { pathPrefixes: ["vendor"] }),
    true,
  );
  assert.equal(
    pathMatches("vendorized/file.ts", { pathPrefixes: ["vendor"] }),
    false,
  );
  assert.equal(
    pathMatches("src/generated/file.ts", { pathSegments: ["generated"] }),
    true,
  );
  assert.equal(
    pathMatches("src/my-generated/file.ts", { pathSegments: ["generated"] }),
    false,
  );
});

async function git(directory, ...arguments_) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", directory, ...arguments_],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    },
  );
  return stdout.trim();
}

async function write(directory, relativePath, content) {
  const filePath = path.join(directory, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function commitAll(directory, message) {
  await git(directory, "add", "-A");
  await git(directory, "commit", "-m", message);
  return git(directory, "rev-parse", "HEAD");
}

test("real Git diff integration keeps unsupported and excluded files in the denominator", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-inventory-"),
  );
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--initial-branch=main");
  await git(directory, "config", "user.name", "ByteSmith Test");
  await git(directory, "config", "user.email", "test@bytesmith.dev");
  await write(directory, "src/app.ts", "export const value = 1;\n");
  await write(directory, "README.md", "before\n");
  await write(directory, "asset.bin", Buffer.from([0, 1, 2]));
  const base = await commitAll(directory, "base");

  await write(directory, "src/app.ts", "export const value = 2;\n");
  await write(directory, "README.md", "after\n");
  await write(directory, "asset.bin", Buffer.from([0, 9, 2]));
  await write(directory, "generated/client.ts", "export const client = 1;\n");
  const head = await commitAll(directory, "head");

  const gitDiff = await readGitDiff(
    await discoverGitRepository(directory),
    base,
    head,
  );
  const inventory = createRepositoryInventory(gitDiff, policy);
  assert.deepEqual(inventory.coverage, {
    totalChangedFiles: 4,
    analyzed: 1,
    partiallyAnalyzed: 0,
    unsupported: 2,
    intentionallyExcluded: 1,
  });
  assert.equal(inventory.files.length, gitDiff.totalChangedFiles);
  assert.deepEqual(
    inventory.files.map((file) => file.path),
    ["README.md", "asset.bin", "generated/client.ts", "src/app.ts"],
  );
});
