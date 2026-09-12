import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as core from "@actions/core";
import {
  discoverGitRepository,
  executeGit,
  inspectWorkingTree,
} from "@bytesmith/vcs-git";

export interface ActionEnvironment {
  GITHUB_ACTIONS?: string;
  GITHUB_EVENT_NAME?: string;
  GITHUB_EVENT_PATH?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_SHA?: string;
  GITHUB_WORKSPACE?: string;
}

export interface ActionStartupContext {
  workspace: string;
  repository: string;
  eventName: "pull_request";
  event: Record<string, unknown>;
  headCommit: string;
}

export class ActionError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ActionError";
    this.code = code;
  }
}

function requiredEnvironment(
  environment: ActionEnvironment,
  key: keyof ActionEnvironment,
): string {
  const value = environment[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ActionError(
      "missing_environment",
      `Required environment variable ${key} is missing.`,
    );
  }
  if (/[\0\r\n]/u.test(value)) {
    throw new ActionError(
      "invalid_environment",
      `Environment variable ${key} contains invalid characters.`,
    );
  }
  return value;
}

async function readEvent(eventPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(eventPath, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new TypeError("The GitHub event payload must be an object.");
    }
    return parsed as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof ActionError) throw cause;
    throw new ActionError(
      "invalid_event_payload",
      "The GitHub event payload could not be read as an object.",
      { cause },
    );
  }
}

function assertPullRequestEvent(
  eventName: string,
): asserts eventName is "pull_request" {
  if (eventName !== "pull_request") {
    throw new ActionError(
      "unsupported_event",
      `ByteSmith Verify 0.1 supports pull_request events only; received ${eventName}.`,
    );
  }
}

async function assertFullHistory(workspace: string): Promise<void> {
  const result = await executeGit(workspace, [
    "rev-parse",
    "--is-shallow-repository",
  ]);
  if (result.exitCode !== 0) {
    throw new ActionError(
      "git_check_failed",
      "Git could not determine repository history state.",
    );
  }
  if (result.stdout.trim() === "true") {
    throw new ActionError(
      "shallow_repository",
      "ByteSmith Verify requires a full Git history. Set actions/checkout fetch-depth: 0.",
    );
  }
  if (result.stdout.trim() !== "false") {
    throw new ActionError(
      "git_check_failed",
      "Git returned an invalid shallow-repository state.",
    );
  }
}

export async function validateActionEnvironment(
  environment: ActionEnvironment = process.env,
): Promise<ActionStartupContext> {
  requiredEnvironment(environment, "GITHUB_ACTIONS");
  const eventName = requiredEnvironment(environment, "GITHUB_EVENT_NAME");
  assertPullRequestEvent(eventName);
  const workspace = path.resolve(
    requiredEnvironment(environment, "GITHUB_WORKSPACE"),
  );
  const repository = requiredEnvironment(environment, "GITHUB_REPOSITORY");
  const eventPath = path.resolve(
    requiredEnvironment(environment, "GITHUB_EVENT_PATH"),
  );
  const expectedSha = requiredEnvironment(
    environment,
    "GITHUB_SHA",
  ).toLowerCase();

  try {
    await access(workspace);
    await access(eventPath);
  } catch (cause) {
    throw new ActionError(
      "invalid_environment",
      "The GitHub workspace or event payload path is not readable.",
      { cause },
    );
  }

  const event = await readEvent(eventPath);
  const gitRepository = await discoverGitRepository(workspace);
  await assertFullHistory(gitRepository.rootPath);
  const workingTree = await inspectWorkingTree(gitRepository);
  if (workingTree.dirty) {
    throw new ActionError(
      "dirty_repository",
      "ByteSmith refuses to analyze an uncommitted runner working tree.",
    );
  }
  if (workingTree.headCommit !== expectedSha) {
    throw new ActionError(
      "unexpected_checkout",
      "The checked-out commit does not match GITHUB_SHA; check out the exact pull-request revision.",
    );
  }
  return {
    workspace: gitRepository.rootPath,
    repository,
    eventName,
    event,
    headCommit: workingTree.headCommit,
  };
}

export async function runAction(
  environment: ActionEnvironment = process.env,
): Promise<void> {
  try {
    const context = await validateActionEnvironment(environment);
    core.setOutput("conclusion", "not_evaluated");
    core.setOutput("head-revision", context.headCommit);
    core.info(
      "ByteSmith Verify startup validation passed. Analysis is advisory in Verify 0.1.",
    );
  } catch (cause) {
    const error =
      cause instanceof ActionError
        ? cause
        : new ActionError(
            "startup_error",
            "ByteSmith Verify could not start safely.",
            { cause },
          );
    core.setOutput("conclusion", "error");
    core.setOutput("error-code", error.code);
    core.setFailed(`${error.code}: ${error.message}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await runAction();
}
