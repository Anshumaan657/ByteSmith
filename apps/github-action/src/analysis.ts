import path from "node:path";
import {
  analyzeRepository,
  DEFAULT_CONFIG_RELATIVE_PATH,
  loadConfiguration,
  type AnalysisEngineResult,
  type LoadedConfiguration,
} from "@bytesmith/analysis-engine";
import type { ImpactManifest } from "@bytesmith/impact-manifest";
import type { ActionStartupContext } from "./index.js";

export interface ActionAnalysisInputs {
  config?: string;
  database?: string;
  useCache: boolean;
  signal?: AbortSignal;
}

export interface ActionAnalysisExecution {
  startup: ActionStartupContext;
  manifest: ImpactManifest;
  engine: AnalysisEngineResult["execution"];
  configuration: LoadedConfiguration;
}

export type AnalyzeRepository = typeof analyzeRepository;

export class ActionAnalysisError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ActionAnalysisError";
    this.code = code;
  }
}

export function parseBooleanInput(
  value: string,
  name: string,
  fallback: boolean,
): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new ActionAnalysisError(
    "invalid_input",
    `Action input ${name} must be true or false.`,
  );
}

function resolveInsideWorkspace(
  workspace: string,
  input: string | undefined,
  fallback?: string,
): string | undefined {
  const value = input?.trim() || fallback;
  if (!value) return undefined;
  if (/\0|\r|\n/u.test(value)) {
    throw new ActionAnalysisError(
      "invalid_input",
      "Action paths cannot contain control characters.",
    );
  }
  const resolved = path.resolve(workspace, value);
  const relative = path.relative(workspace, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new ActionAnalysisError(
      "invalid_input",
      `Action path ${value} is outside the checked-out repository.`,
    );
  }
  return resolved;
}

export async function executeActionAnalysis(
  startup: ActionStartupContext,
  inputs: ActionAnalysisInputs,
  analyze: AnalyzeRepository = analyzeRepository,
): Promise<ActionAnalysisExecution> {
  const configurationPath = resolveInsideWorkspace(
    startup.workspace,
    inputs.config,
    DEFAULT_CONFIG_RELATIVE_PATH,
  )!;
  const databasePath = resolveInsideWorkspace(
    startup.workspace,
    inputs.database,
  );
  let configuration: LoadedConfiguration;
  try {
    configuration = await loadConfiguration(
      startup.workspace,
      configurationPath,
    );
  } catch (cause) {
    throw new ActionAnalysisError(
      "invalid_configuration",
      "ByteSmith could not load the requested configuration.",
      { cause },
    );
  }

  try {
    const result = await analyze({
      repositoryPath: startup.workspace,
      base: startup.pullRequest.baseRevision,
      head: startup.pullRequest.headRevision,
      config: configuration,
      ...(databasePath ? { databasePath } : {}),
      useCache: inputs.useCache,
      pullRequestId: String(startup.pullRequest.number),
      ...(inputs.signal ? { signal: inputs.signal } : {}),
    });
    if (
      result.manifest.comparison.baseRevision !==
        startup.pullRequest.baseRevision ||
      result.manifest.comparison.headRevision !==
        startup.pullRequest.headRevision ||
      result.manifest.comparison.mergeBaseRevision !==
        startup.pullRequest.mergeBaseRevision
    ) {
      throw new ActionAnalysisError(
        "stale_analysis",
        "The analysis result is not bound to the current pull-request comparison.",
      );
    }
    return {
      startup,
      manifest: result.manifest,
      engine: result.execution,
      configuration: result.configuration,
    };
  } catch (cause) {
    if (cause instanceof ActionAnalysisError) throw cause;
    const code =
      cause instanceof DOMException && cause.name === "AbortError"
        ? "cancelled"
        : cause &&
            typeof cause === "object" &&
            "code" in cause &&
            typeof cause.code === "string"
          ? cause.code
          : "analysis_error";
    throw new ActionAnalysisError(
      code,
      cause instanceof Error
        ? cause.message
        : "ByteSmith analysis failed unexpectedly.",
      { cause },
    );
  }
}
