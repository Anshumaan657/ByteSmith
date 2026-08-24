import {
  normalizeNonEmptyText,
  validateExactGitRevision,
  validateStableId,
} from "@bytesmith/impact-types";
import { analyzeOpenApiRevision } from "./discovery.js";
import { OpenApiAnalyzerError } from "./errors.js";
import { createOpenApiCanonicalIr } from "./projection.js";
import { evaluateOpenApiContractRules } from "./rules.js";
import type {
  OpenApiAnalyzerResult,
  RunOpenApiAnalyzerOptions,
} from "./types.js";

export async function runOpenApiAnalyzerComparison(
  options: RunOpenApiAnalyzerOptions,
): Promise<OpenApiAnalyzerResult> {
  let repositoryId: string;
  let baseRevision: string;
  let headRevision: string;
  let analyzerVersion: string;
  try {
    repositoryId = validateStableId(options.repositoryId, "Repository ID");
    baseRevision = validateExactGitRevision(
      options.base.revision,
      "Base revision",
    );
    headRevision = validateExactGitRevision(
      options.head.revision,
      "Head revision",
    );
    analyzerVersion = normalizeNonEmptyText(
      options.analyzerVersion ?? "0.1.0",
      "OpenAPI analyzer version",
    );
  } catch (cause) {
    throw new OpenApiAnalyzerError(
      "analyzer_options_invalid",
      "OpenAPI analyzer options are invalid.",
      cause,
    );
  }
  const [baseAnalysis, headAnalysis] = await Promise.all([
    analyzeOpenApiRevision(repositoryId, {
      directory: options.base.directory,
      revision: baseRevision,
    }),
    analyzeOpenApiRevision(repositoryId, {
      directory: options.head.directory,
      revision: headRevision,
    }),
  ]);
  const ir = createOpenApiCanonicalIr({
    repositoryId,
    baseRevision,
    headRevision,
    analyzerVersion,
    baseAnalysis,
    headAnalysis,
  });
  const rules = await evaluateOpenApiContractRules({
    ir,
    baseAnalysis,
    headAnalysis,
  });
  return { baseAnalysis, headAnalysis, ir, rules };
}
