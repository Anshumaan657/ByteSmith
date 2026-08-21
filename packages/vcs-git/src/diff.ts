import { executeGitBytes } from "./command.js";
import {
  parseNumstat,
  parseRawDiff,
  type NumstatRecord,
  type RawDiffRecord,
} from "./diff-parser.js";
import { GitError } from "./errors.js";
import { compareGitPaths, normalizeGitPath } from "./path.js";
import { assertRevisionUnchanged, resolveGitRevision } from "./revision.js";
import type {
  GitChangeType,
  GitChangedFile,
  GitFileKind,
  GitObjectId,
  GitRepository,
  NormalizedGitDiff,
  ResolvedGitComparison,
} from "./types.js";

const absentMode = "000000";
const absentObjectIdPattern = /^(?:0{40}|0{64})$/u;
const exactObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const supportedStatuses = new Map<string, GitChangeType>([
  ["A", "added"],
  ["M", "modified"],
  ["D", "deleted"],
  ["R", "renamed"],
  ["C", "copied"],
  ["T", "type_changed"],
]);

const deterministicDiffOptions = [
  "-c",
  "diff.renames=copies",
  "-c",
  "diff.renameLimit=1000",
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--ignore-submodules=none",
  "--diff-algorithm=myers",
  "--find-renames=50%",
  "--find-copies=50%",
  "--find-copies-harder",
] as const;

function fileKind(mode: string): GitFileKind {
  if (mode === "100644") return "regular";
  if (mode === "100755") return "executable";
  if (mode === "120000") return "symlink";
  if (mode === "160000") return "submodule";
  return "unknown";
}

function optionalMode(mode: string): string | undefined {
  return mode === absentMode ? undefined : mode;
}

function optionalObjectId(value: string): string | undefined {
  return absentObjectIdPattern.test(value) ? undefined : value;
}

function normalizedPath(
  value: string,
  seenOriginals: Map<string, string>,
): string {
  const normalized = normalizeGitPath(value);
  const original = seenOriginals.get(normalized);
  if (original !== undefined && original !== value) {
    throw new GitError(
      "diff_path_collision",
      "Two Git paths normalize to the same repository path.",
      { operation: "normalize_git_diff" },
    );
  }
  seenOriginals.set(normalized, value);
  return normalized;
}

function normalizeNumstat(
  records: NumstatRecord[],
): Map<string, NumstatRecord> {
  const result = new Map<string, NumstatRecord>();
  const originals = new Map<string, string>();
  for (const record of records) {
    const path = normalizedPath(record.path, originals);
    const previousPath = record.previousPath
      ? normalizedPath(record.previousPath, originals)
      : undefined;
    if (result.has(path)) {
      throw new GitError(
        "diff_duplicate_path",
        "Git numstat output contained a duplicate path.",
        { operation: "normalize_git_diff" },
      );
    }
    result.set(path, {
      path,
      ...(previousPath ? { previousPath } : {}),
      binary: record.binary,
    });
  }
  return result;
}

function normalizeRecord(
  record: RawDiffRecord,
  stats: Map<string, NumstatRecord>,
  originals: Map<string, string>,
): GitChangedFile {
  const changeType = supportedStatuses.get(record.status);
  if (!changeType) {
    throw new GitError(
      "diff_status_unsupported",
      "Git returned an unsupported diff status.",
      { operation: "normalize_git_diff" },
    );
  }
  const path = normalizedPath(record.path, originals);
  const previousPath = record.previousPath
    ? normalizedPath(record.previousPath, originals)
    : undefined;
  const stat = stats.get(path);
  const oldAbsent = record.oldMode === absentMode;
  const newAbsent = record.newMode === absentMode;
  const oldObjectAbsent = absentObjectIdPattern.test(record.oldObjectId);
  const newObjectAbsent = absentObjectIdPattern.test(record.newObjectId);
  const validShape =
    oldAbsent === oldObjectAbsent &&
    newAbsent === newObjectAbsent &&
    (changeType === "added"
      ? oldAbsent && !newAbsent
      : changeType === "deleted"
        ? !oldAbsent && newAbsent
        : !oldAbsent && !newAbsent) &&
    (changeType !== "type_changed" || record.oldMode !== record.newMode);
  if (
    !stat ||
    !validShape ||
    stat.previousPath !== previousPath ||
    (changeType === "added" && record.oldMode !== absentMode) ||
    (changeType === "deleted" && record.newMode !== absentMode) ||
    (changeType === "renamed" || changeType === "copied") !==
      (previousPath !== undefined)
  ) {
    throw new GitError(
      "diff_metadata_mismatch",
      "Git raw and numstat diff metadata did not agree.",
      { operation: "normalize_git_diff" },
    );
  }
  const effectiveMode =
    record.newMode === absentMode ? record.oldMode : record.newMode;
  return {
    path,
    ...(previousPath ? { previousPath } : {}),
    changeType,
    ...(optionalMode(record.oldMode) ? { oldMode: record.oldMode } : {}),
    ...(optionalMode(record.newMode) ? { newMode: record.newMode } : {}),
    ...(optionalObjectId(record.oldObjectId)
      ? { oldObjectId: record.oldObjectId }
      : {}),
    ...(optionalObjectId(record.newObjectId)
      ? { newObjectId: record.newObjectId }
      : {}),
    fileKind: fileKind(effectiveMode),
    binary: stat.binary,
    ...(record.similarity === undefined
      ? {}
      : { similarity: record.similarity }),
  };
}

export function normalizeParsedDiff(
  rawRecords: RawDiffRecord[],
  numstatRecords: NumstatRecord[],
): GitChangedFile[] {
  const stats = normalizeNumstat(numstatRecords);
  const originals = new Map<string, string>();
  const paths = new Set<string>();
  const files = rawRecords.map((record) => {
    const file = normalizeRecord(record, stats, originals);
    if (paths.has(file.path)) {
      throw new GitError(
        "diff_duplicate_path",
        "Git raw diff output contained a duplicate path.",
        { operation: "normalize_git_diff" },
      );
    }
    paths.add(file.path);
    return file;
  });
  if (
    stats.size !== paths.size ||
    [...stats.keys()].some((path) => !paths.has(path))
  ) {
    throw new GitError(
      "diff_metadata_mismatch",
      "Git numstat contained paths absent from the raw diff.",
      { operation: "normalize_git_diff" },
    );
  }
  return files.sort((left, right) => {
    const pathOrder = compareGitPaths(left.path, right.path);
    if (pathOrder !== 0) return pathOrder;
    const typeOrder = compareGitPaths(left.changeType, right.changeType);
    if (typeOrder !== 0) return typeOrder;
    return compareGitPaths(left.previousPath ?? "", right.previousPath ?? "");
  });
}

function assertExactObjectId(value: string): void {
  if (!exactObjectIdPattern.test(value)) {
    throw new GitError(
      "revision_invalid",
      "Git diff requires exact commit identifiers.",
      { operation: "read_git_diff" },
    );
  }
}

export async function readGitDiff(
  repository: GitRepository,
  fromCommit: GitObjectId,
  toCommit: GitObjectId,
): Promise<NormalizedGitDiff> {
  assertExactObjectId(fromCommit);
  assertExactObjectId(toCommit);
  const [resolvedFrom, resolvedTo] = await Promise.all([
    resolveGitRevision(repository, fromCommit),
    resolveGitRevision(repository, toCommit),
  ]);
  const rangeArguments = [
    resolvedFrom.commit,
    resolvedTo.commit,
    "--",
  ] as const;
  const [rawResult, numstatResult] = await Promise.all([
    executeGitBytes(repository.rootPath, [
      ...deterministicDiffOptions,
      "--raw",
      "-z",
      "--no-abbrev",
      ...rangeArguments,
    ]),
    executeGitBytes(repository.rootPath, [
      ...deterministicDiffOptions,
      "--numstat",
      "-z",
      ...rangeArguments,
    ]),
  ]);
  if (rawResult.exitCode !== 0 || numstatResult.exitCode !== 0) {
    throw new GitError(
      "diff_failed",
      "Git could not produce the requested commit diff.",
      {
        operation: "read_git_diff",
        exitCode:
          rawResult.exitCode !== 0
            ? rawResult.exitCode
            : numstatResult.exitCode,
      },
    );
  }
  const files = normalizeParsedDiff(
    parseRawDiff(rawResult.stdout),
    parseNumstat(numstatResult.stdout),
  );
  return {
    fromCommit: resolvedFrom.commit,
    toCommit: resolvedTo.commit,
    totalChangedFiles: files.length,
    files,
  };
}

export async function readComparisonDiff(
  comparison: ResolvedGitComparison,
): Promise<NormalizedGitDiff> {
  await Promise.all([
    assertRevisionUnchanged(
      comparison.repository,
      comparison.base.requested,
      comparison.base.commit,
      "base",
    ),
    assertRevisionUnchanged(
      comparison.repository,
      comparison.head.requested,
      comparison.head.commit,
      "head",
    ),
  ]);
  const diff = await readGitDiff(
    comparison.repository,
    comparison.mergeBase,
    comparison.head.commit,
  );
  await Promise.all([
    assertRevisionUnchanged(
      comparison.repository,
      comparison.base.requested,
      comparison.base.commit,
      "base",
    ),
    assertRevisionUnchanged(
      comparison.repository,
      comparison.head.requested,
      comparison.head.commit,
      "head",
    ),
  ]);
  return diff;
}
