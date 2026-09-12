import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as core from "@actions/core";
import {
  discoverGitRepository,
  executeGit,
  inspectWorkingTree,
} from "@bytesmith/vcs-git";
import {
  PullRequestContextError,
  resolvePullRequestContext,
  type PullRequestContext,
} from "./context.js";
import {
  ActionAnalysisError,
  executeActionAnalysis,
  parseBooleanInput,
} from "./analysis.js";
import {
  renderAdvisoryReport,
  publishAdvisoryReport,
  GitHubReportError,
} from "./report.js";
import type { ImpactManifest } from "@bytesmith/impact-manifest";

export * from "./analysis.js";
export * from "./context.js";
export * from "./report.js";

export interface ActionEnvironment {
  GITHUB_ACTIONS?: string;
  GITHUB_EVENT_NAME?: string;
  GITHUB_EVENT_PATH?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_SHA?: string;
  GITHUB_WORKSPACE?: string;
  GITHUB_API_URL?: string;
  GITHUB_STEP_SUMMARY?: string;
}

export interface ActionStartupContext {
  workspace: string;
  repository: string;
  eventName: "pull_request";
  event: Record<string, unknown>;
  headCommit: string;
  pullRequest: PullRequestContext;
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
  inputs: { base?: string; head?: string } = {},
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
  requiredEnvironment(environment, "GITHUB_SHA");

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
  const pullRequest = await resolvePullRequestContext({
    event,
    repositoryPath: gitRepository.rootPath,
    repository,
    ...(inputs.base ? { baseInput: inputs.base } : {}),
    ...(inputs.head ? { headInput: inputs.head } : {}),
  });
  return {
    workspace: gitRepository.rootPath,
    repository,
    eventName,
    event,
    headCommit: workingTree.headCommit,
    pullRequest,
  };
}

async function writeJobSummary(report: string): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(summaryPath, report, "utf8");
  } catch {
    // Best effort; ignore summary write failures.
  }
}

function parsePublishInput(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new ActionError(
    "invalid_input",
    "Action input publish must be true or false.",
  );
}

export async function runAction(
  environment: ActionEnvironment = process.env,
): Promise<void> {
  let reportState: "created" | "updated" | "summary" | "skipped" = "skipped";
  let reportError: Error | undefined;
  let manifest: ImpactManifest | undefined;

  try {
    const baseInput = core.getInput("base");
    const headInput = core.getInput("head");
    const useCache = parseBooleanInput(
      core.getInput("use-cache"),
      "use-cache",
      true,
    );
    const publish = parsePublishInput(core.getInput("publish"));
    const githubToken = core.getInput("github-token");

    const context = await validateActionEnvironment(environment, {
      ...(baseInput ? { base: baseInput } : {}),
      ...(headInput ? { head: headInput } : {}),
    });
    const execution = await executeActionAnalysis(context, {
      config: core.getInput("config"),
      database: core.getInput("database"),
      useCache,
    });
    manifest = execution.manifest;

    core.setOutput("conclusion", manifest.status.conclusion);
    core.setOutput("semantic-digest", manifest.integrity.semanticDigest.value);
    core.setOutput("base-revision", manifest.comparison.baseRevision);
    core.setOutput("head-revision", manifest.comparison.headRevision);
    core.setOutput("merge-base", manifest.comparison.mergeBaseRevision ?? "");
    core.setOutput("error-code", "");

    core.info(
      `ByteSmith ${manifest.status.conclusion}: ${manifest.changes.length} changes, ${manifest.impacts.length} impacts, ${manifest.unknowns.length} unknowns.`,
    );

    if (publish) {
      const report = renderAdvisoryReport(manifest, context.repository);
      const apiUrl = environment.GITHUB_API_URL;
      try {
        const result = await publishAdvisoryReport({
          repository: context.repository,
          pullRequestNumber: context.pullRequest.number,
          analyzedHead: manifest.comparison.headRevision,
          token: githubToken,
          body: report,
          ...(apiUrl ? { apiUrl } : {}),
        });
        reportState = result.state;
        core.info(`ByteSmith advisory report ${result.state}.`);
      } catch (cause) {
        reportError = cause instanceof Error ? cause : new Error(String(cause));
        if (cause instanceof GitHubReportError) {
          if (
            cause.code === "permission_denied" ||
            cause.code === "missing_github_token"
          ) {
            core.warning(
              `ByteSmith could not publish the advisory report (${cause.code}); writing to job summary instead.`,
            );
            await writeJobSummary(report);
            reportState = "summary";
          } else if (cause.code === "stale_analysis") {
            core.warning(cause.message);
            reportState = "skipped";
          } else {
            core.warning(
              `ByteSmith report publication failed (${cause.code}); writing to job summary instead.`,
            );
            await writeJobSummary(report);
            reportState = "summary";
          }
        } else {
          core.warning(
            "ByteSmith report publication failed unexpectedly; writing to job summary instead.",
          );
          await writeJobSummary(report);
          reportState = "summary";
        }
      }
    }
  } catch (cause) {
    const error =
      cause instanceof ActionError
        ? cause
        : cause instanceof ActionAnalysisError
          ? new ActionError(cause.code, cause.message, { cause })
          : cause instanceof PullRequestContextError
            ? new ActionError(cause.code, cause.message, { cause })
            : cause instanceof GitHubReportError
              ? new ActionError(cause.code, cause.message, { cause })
              : new ActionError(
                  "startup_error",
                  "ByteSmith Verify could not start safely.",
                  { cause },
                );

    core.setOutput("conclusion", "error");
    core.setOutput("error-code", error.code);
    core.setOutput("semantic-digest", "");
    core.setOutput("base-revision", "");
    core.setOutput("head-revision", "");
    core.setOutput("merge-base", "");
    core.setOutput("report-state", reportState);

    if (manifest) {
      core.setOutput(
        "semantic-digest",
        manifest.integrity.semanticDigest.value,
      );
      core.setOutput("base-revision", manifest.comparison.baseRevision);
      core.setOutput("head-revision", manifest.comparison.headRevision);
      core.setOutput("merge-base", manifest.comparison.mergeBaseRevision ?? "");
    }

    if (
      error.code === "stale_analysis" ||
      error.code === "permission_denied" ||
      error.code === "missing_github_token"
    ) {
      core.warning(`${error.code}: ${error.message}`);
    } else {
      core.setFailed(`${error.code}: ${error.message}`);
    }
    return;
  }

  core.setOutput("report-state", reportState);

  if (
    reportError &&
    !["permission_denied", "missing_github_token", "stale_analysis"].includes(
      reportError instanceof GitHubReportError ? reportError.code : "",
    )
  ) {
    core.setOutput("error-code", "report_publication_failed");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  void runAction();
}
