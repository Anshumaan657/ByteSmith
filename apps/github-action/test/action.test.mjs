import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { validateActionEnvironment, ActionError } from "../dist/index.js";

const actionRoot = path.resolve(new URL("..", import.meta.url).pathname);
const execFileAsync = promisify(execFile);

async function git(directory, ...arguments_) {
  const result = await execFileAsync("git", arguments_, {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return result.stdout.trim();
}

async function makeCleanRepository(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-action-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "--quiet");
  await git(directory, "config", "user.name", "ByteSmith Test");
  await git(directory, "config", "user.email", "test@bytesmith.invalid");
  await fs.writeFile(path.join(directory, "README.md"), "test\n");
  await git(directory, "add", "README.md");
  await git(directory, "commit", "--quiet", "-m", "initial");
  return directory;
}

async function makeEnvironment(t, overrides = {}) {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-action-env-"),
  );
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const eventPath = path.join(workspace, "event.json");
  await fs.writeFile(eventPath, '{"action":"opened"}\n');
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "example/project",
    GITHUB_SHA: "0".repeat(40),
    GITHUB_WORKSPACE: workspace,
    ...overrides,
  };
}

// --- Metadata tests ---

test("action metadata declares node20, typed inputs, outputs, and bundled entrypoint", async () => {
  const metadata = await fs.readFile(
    path.join(actionRoot, "action.yml"),
    "utf8",
  );
  assert.match(metadata, /using:\s*node20/u);
  assert.match(metadata, /main:\s*dist\/bundle\/index\.js/u);
  for (const input of [
    "base",
    "head",
    "config",
    "database",
    "use-cache",
    "publish",
  ]) {
    assert.match(metadata, new RegExp("  " + input + ":", "mu"));
  }
  for (const output of [
    "conclusion",
    "semantic-digest",
    "base-revision",
    "head-revision",
    "merge-base",
    "error-code",
  ]) {
    assert.match(metadata, new RegExp("  " + output + ":", "mu"));
  }
});

test("bundled entrypoint exists at dist/bundle/index.js", async () => {
  await fs.access(path.join(actionRoot, "dist", "bundle", "index.js"));
});

// --- Startup validation success ---

test("startup validation accepts a fully populated environment", async (t) => {
  const repository = await makeCleanRepository(t);
  const head = await git(repository, "rev-parse", "HEAD");

  // Write event.json outside the git repo so the working tree stays clean
  const eventDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytesmith-event-"));
  t.after(() => fs.rm(eventDir, { recursive: true, force: true }));
  const eventPath = path.join(eventDir, "event.json");
  await fs.writeFile(
    eventPath,
    JSON.stringify({
      action: "opened",
      pull_request: {
        number: 17,
        base: { sha: head },
        head: { sha: head, repo: { full_name: "example/project" } },
      },
    }),
  );

  const result = await validateActionEnvironment({
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "example/project",
    GITHUB_SHA: head,
    GITHUB_WORKSPACE: repository,
  });
  assert.equal(result.eventName, "pull_request");
  assert.equal(result.repository, "example/project");
  assert.equal(result.headCommit, head);
  assert.equal(result.pullRequest.number, 17);
  assert.equal(result.pullRequest.baseRevision, head);
  assert.equal(result.pullRequest.headRevision, head);
  assert.equal(result.pullRequest.mergeBaseRevision, head);
  assert.equal(result.pullRequest.fork, false);
  // Git resolves symlinks (macOS /var -> /private/var), so compare real paths
  assert.equal(result.workspace, await fs.realpath(repository));
});

test("startup validation rejects revision inputs that differ from the event", async (t) => {
  const repository = await makeCleanRepository(t);
  const head = await git(repository, "rev-parse", "HEAD");
  const eventDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytesmith-event-"));
  t.after(() => fs.rm(eventDir, { recursive: true, force: true }));
  const eventPath = path.join(eventDir, "event.json");
  await fs.writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        number: 1,
        base: { sha: head },
        head: { sha: head, repo: { full_name: "example/project" } },
      },
    }),
  );
  await assert.rejects(
    () =>
      validateActionEnvironment(
        {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: "example/project",
          GITHUB_SHA: head,
          GITHUB_WORKSPACE: repository,
        },
        { head: "f".repeat(40) },
      ),
    { code: "stale_revision" },
  );
});

// --- Missing environment diagnostics ---

test("missing GITHUB_ACTIONS rejects with missing_environment", async (t) => {
  const env = await makeEnvironment(t, { GITHUB_ACTIONS: undefined });
  await assert.rejects(() => validateActionEnvironment(env), {
    code: "missing_environment",
  });
});

test("missing GITHUB_EVENT_PATH rejects with missing_environment", async (t) => {
  const env = await makeEnvironment(t, { GITHUB_EVENT_PATH: undefined });
  await assert.rejects(() => validateActionEnvironment(env), {
    code: "missing_environment",
  });
});

test("missing GITHUB_SHA rejects with missing_environment", async (t) => {
  const env = await makeEnvironment(t, { GITHUB_SHA: undefined });
  await assert.rejects(() => validateActionEnvironment(env), {
    code: "missing_environment",
  });
});

test("missing GITHUB_WORKSPACE rejects with missing_environment", async (t) => {
  const env = await makeEnvironment(t, { GITHUB_WORKSPACE: undefined });
  await assert.rejects(() => validateActionEnvironment(env), {
    code: "missing_environment",
  });
});

test("missing GITHUB_REPOSITORY rejects with missing_environment", async (t) => {
  const env = await makeEnvironment(t, { GITHUB_REPOSITORY: undefined });
  await assert.rejects(() => validateActionEnvironment(env), {
    code: "missing_environment",
  });
});

// --- Unsupported event ---

test("unsupported event name rejects with unsupported_event", async (t) => {
  const env = await makeEnvironment(t, { GITHUB_EVENT_NAME: "push" });
  await assert.rejects(() => validateActionEnvironment(env), {
    code: "unsupported_event",
  });
});

test("schedule event rejects with unsupported_event", async (t) => {
  const env = await makeEnvironment(t, { GITHUB_EVENT_NAME: "schedule" });
  await assert.rejects(() => validateActionEnvironment(env), {
    code: "unsupported_event",
  });
});

// --- Invalid event payload ---

test("array event payload rejects with invalid_event_payload", async (t) => {
  const env = await makeEnvironment(t);
  await fs.writeFile(env.GITHUB_EVENT_PATH, "[]\n");
  await assert.rejects(() => validateActionEnvironment(env), {
    code: "invalid_event_payload",
  });
});

test("non-JSON event payload rejects with invalid_event_payload", async (t) => {
  const env = await makeEnvironment(t);
  await fs.writeFile(env.GITHUB_EVENT_PATH, "not json at all\n");
  await assert.rejects(() => validateActionEnvironment(env), {
    code: "invalid_event_payload",
  });
});

// --- Shallow repository detection ---

test("shallow repository rejects with shallow_repository", async (t) => {
  // Create a source repo with enough history
  const source = await makeCleanRepository(t);
  await fs.writeFile(path.join(source, "file2.txt"), "second\n");
  await git(source, "add", "file2.txt");
  await git(source, "commit", "--quiet", "-m", "second");

  // Create a shallow clone with depth=1
  const shallow = await fs.mkdtemp(
    path.join(os.tmpdir(), "bytesmith-shallow-"),
  );
  t.after(() => fs.rm(shallow, { recursive: true, force: true }));
  await git(shallow, "clone", "--depth", "1", "file://" + source, "repo");
  const shallowRepo = path.join(shallow, "repo");
  const head = await git(shallowRepo, "rev-parse", "HEAD");

  const eventDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytesmith-event-"));
  t.after(() => fs.rm(eventDir, { recursive: true, force: true }));
  const eventPath = path.join(eventDir, "event.json");
  await fs.writeFile(eventPath, '{"action":"opened"}\n');

  await assert.rejects(
    () =>
      validateActionEnvironment({
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: "example/project",
        GITHUB_SHA: head,
        GITHUB_WORKSPACE: shallowRepo,
      }),
    { code: "shallow_repository" },
  );
});

// --- ActionError structure ---

test("ActionError has correct name and code properties", () => {
  const error = new ActionError("test_code", "Test message");
  assert.equal(error.name, "ActionError");
  assert.equal(error.code, "test_code");
  assert.equal(error.message, "Test message");
  assert.ok(error instanceof Error);
});

test("ActionError preserves cause", () => {
  const cause = new Error("root cause");
  const error = new ActionError("test_code", "Wrapper", { cause });
  assert.equal(error.cause, cause);
});
