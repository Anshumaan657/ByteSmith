import {
  compareGitPaths,
  normalizeGitPath,
  type GitChangedFile,
  type NormalizedGitDiff,
} from "@bytesmith/vcs-git";
import { InventoryError } from "./errors.js";
import { pathMatches, validateInventoryPolicy } from "./matcher.js";
import type {
  CoverageClass,
  CoverageSummary,
  InventoryFile,
  InventoryPolicy,
  InventoryRule,
  RepositoryInventory,
} from "./types.js";

const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function diffFailure(message: string): never {
  throw new InventoryError("inventory_diff_invalid", message);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareGitPaths);
}

function validateDiffPath(value: string): void {
  try {
    if (normalizeGitPath(value) !== value) {
      diffFailure("Git diff contains a non-normalized repository path.");
    }
  } catch (cause) {
    if (
      cause instanceof InventoryError &&
      cause.code === "inventory_diff_invalid"
    ) {
      throw cause;
    }
    diffFailure("Git diff contains an invalid repository path.");
  }
}

function validateDiff(diff: NormalizedGitDiff): void {
  if (
    !objectIdPattern.test(diff.fromCommit) ||
    !objectIdPattern.test(diff.toCommit)
  ) {
    diffFailure("Repository inventory requires exact Git commit identifiers.");
  }
  if (
    !Number.isSafeInteger(diff.totalChangedFiles) ||
    diff.totalChangedFiles < 0 ||
    diff.totalChangedFiles !== diff.files.length
  ) {
    diffFailure("Git diff total does not equal its changed-file list.");
  }
  const paths = new Set<string>();
  for (const file of diff.files) {
    validateDiffPath(file.path);
    if (paths.has(file.path)) {
      diffFailure("Git diff contains a duplicate changed path.");
    }
    paths.add(file.path);
    const needsPreviousPath =
      file.changeType === "renamed" || file.changeType === "copied";
    if (needsPreviousPath !== (file.previousPath !== undefined)) {
      diffFailure("Git diff contains inconsistent previous-path metadata.");
    }
    if (file.previousPath !== undefined) validateDiffPath(file.previousPath);
  }
}

function specialFileReason(file: GitChangedFile): string | undefined {
  if (file.binary) {
    return "Binary file: ByteSmith Verify 0.1 does not analyze binary content.";
  }
  if (file.fileKind === "symlink") {
    return "Symbolic link: ByteSmith records the path but does not analyze link targets.";
  }
  if (file.fileKind === "submodule") {
    return "Git submodule: cross-repository analysis is outside ByteSmith Verify 0.1.";
  }
  if (file.fileKind === "unknown") {
    return "Unsupported Git file mode: ByteSmith cannot safely analyze this file kind.";
  }
  return undefined;
}

function ruleReason(rule: InventoryRule): string {
  const labels = {
    generated: "Generated file",
    ignored: "Ignored by policy",
    excluded: "Intentionally excluded",
    unsupported: "Unsupported input",
    partially_analyzed: "Partially analyzed",
  } as const;
  return `${labels[rule.kind]}: ${rule.reason.trim()}`;
}

function fromRule(file: GitChangedFile, rule: InventoryRule): InventoryFile {
  const coverageClass: CoverageClass =
    rule.kind === "partially_analyzed"
      ? "partially_analyzed"
      : rule.kind === "unsupported"
        ? "unsupported"
        : "intentionally_excluded";
  return {
    ...file,
    coverageClass,
    reason: ruleReason(rule),
    analyzerIds:
      rule.kind === "partially_analyzed"
        ? sortedUnique(rule.analyzerIds ?? [])
        : [],
  };
}

function classifyFile(
  file: GitChangedFile,
  policy: InventoryPolicy,
): InventoryFile {
  const specialReason = specialFileReason(file);
  if (specialReason) {
    return {
      ...file,
      coverageClass: "unsupported",
      reason: specialReason,
      analyzerIds: [],
    };
  }

  const rules = (policy.rules ?? []).filter((rule) =>
    pathMatches(file.path, rule.matcher),
  );
  if (rules.length > 1) {
    throw new InventoryError(
      "inventory_rule_ambiguous",
      `Changed path ${file.path} matches multiple inventory rules.`,
    );
  }
  const rule = rules[0];
  if (rule) return fromRule(file, rule);

  const analyzerIds = sortedUnique(
    policy.analyzerClaims
      .filter((analyzer) => pathMatches(file.path, analyzer.matcher))
      .map((analyzer) => analyzer.analyzerId),
  );
  if (analyzerIds.length > 0) {
    return { ...file, coverageClass: "analyzed", analyzerIds };
  }
  return {
    ...file,
    coverageClass: "unsupported",
    reason: "Unsupported path: no configured analyzer accepts this file.",
    analyzerIds: [],
  };
}

function summarize(files: readonly InventoryFile[]): CoverageSummary {
  const coverage: CoverageSummary = {
    totalChangedFiles: files.length,
    analyzed: 0,
    partiallyAnalyzed: 0,
    unsupported: 0,
    intentionallyExcluded: 0,
  };
  for (const file of files) {
    if (file.coverageClass === "analyzed") coverage.analyzed += 1;
    else if (file.coverageClass === "partially_analyzed")
      coverage.partiallyAnalyzed += 1;
    else if (file.coverageClass === "unsupported") coverage.unsupported += 1;
    else coverage.intentionallyExcluded += 1;
  }
  return coverage;
}

export function createRepositoryInventory(
  diff: NormalizedGitDiff,
  policy: InventoryPolicy,
): RepositoryInventory {
  validateDiff(diff);
  validateInventoryPolicy(policy);
  const files = diff.files
    .map((file) => classifyFile(file, policy))
    .sort((left, right) => compareGitPaths(left.path, right.path));
  return {
    fromCommit: diff.fromCommit,
    toCommit: diff.toCommit,
    files,
    coverage: summarize(files),
  };
}
