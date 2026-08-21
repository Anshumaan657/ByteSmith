import type { GitRevision, StableId } from "./types.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const exactGitRevisionPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export class ImpactTypeError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ImpactTypeError";
  }
}

export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeNonEmptyText(
  value: string,
  description: string,
): string {
  const normalized = value.normalize("NFC");
  if (normalized.trim().length === 0) {
    throw new ImpactTypeError(`${description} must not be empty.`);
  }
  return normalized;
}

export function validateStableId(value: string, description = "ID"): StableId {
  if (!identifierPattern.test(value) || value.normalize("NFC") !== value) {
    throw new ImpactTypeError(`${description} is not a valid stable ID.`);
  }
  return value;
}

export function validateExactGitRevision(
  value: string,
  description = "Git revision",
): GitRevision {
  if (!exactGitRevisionPattern.test(value)) {
    throw new ImpactTypeError(`${description} must be a full Git object ID.`);
  }
  return value;
}

export function normalizeRepositoryPath(value: string): string {
  const normalized = value.normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0")
  ) {
    throw new ImpactTypeError(
      "Repository path must be normalized and repository-relative.",
    );
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new ImpactTypeError(
      "Repository path contains an invalid or ambiguous segment.",
    );
  }
  return normalized;
}
