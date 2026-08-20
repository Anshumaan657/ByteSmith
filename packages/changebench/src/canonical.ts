import { createHash } from "node:crypto";

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const runtimeRootFields = new Set(["manifestId", "generatedAt", "integrity"]);
const semanticSetPaths = new Map<string, string[]>([
  ["/status/reasons", ["code", "summary"]],
  ["/scope/files", ["path", "changeType"]],
  ["/scope/files/*/analyzerIds", []],
  ["/analyzers", ["id", "version"]],
  ["/evidence", ["id"]],
  ["/changes", ["id"]],
  ["/changes/*/evidenceIds", []],
  ["/impacts", ["id"]],
  ["/impacts/*/sourceChangeIds", []],
  ["/impacts/*/affectedComponents", ["id"]],
  ["/impacts/*/evidenceIds", []],
  ["/tests", ["id"]],
  ["/tests/recommended", ["id"]],
  ["/tests/gaps", ["id"]],
  ["/unknowns", ["id"]],
  ["/unknowns/*/evidenceIds", []],
  ["/policies", ["id"]],
  ["/policies/*/findingIds", []],
  ["/policies/*/analysisGapIds", []],
  ["/dispositions", ["id"]],
  ["/dispositions/*/auditEventIds", []],
  ["/appeals", ["id"]],
  ["/appeals/*/auditEventIds", []],
  ["/waivers", ["id"]],
  ["/waivers/*/auditEventIds", []],
  ["/suspensions", ["id"]],
  ["/suspensions/*/auditEventIds", []],
  ["/auditEvents", ["occurredAt", "id"]],
]);

function normalizePath(parts: string[]): string {
  return `/${parts.map((part) => (/^\d+$/u.test(part) ? "*" : part)).join("/")}`;
}

function compareValues(
  left: JsonValue,
  right: JsonValue,
  keys: string[],
): number {
  if (keys.length === 0)
    return compareStrings(JSON.stringify(left), JSON.stringify(right));
  for (const key of keys) {
    const leftValue =
      typeof left === "object" && left !== null && !Array.isArray(left)
        ? left[key]
        : undefined;
    const rightValue =
      typeof right === "object" && right !== null && !Array.isArray(right)
        ? right[key]
        : undefined;
    const comparison = compareStrings(
      JSON.stringify(leftValue),
      JSON.stringify(rightValue),
    );
    if (comparison !== 0) return comparison;
  }
  return compareStrings(JSON.stringify(left), JSON.stringify(right));
}

function compareStrings(
  left: string | undefined,
  right: string | undefined,
): number {
  const leftValue = left ?? "";
  const rightValue = right ?? "";
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function normalize(value: unknown, parts: string[]): JsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.normalize("NFC");
    const key = parts.at(-1) ?? "";
    if (key === "path" || key === "previousPath") {
      return normalized
        .replaceAll("\\", "/")
        .replace(/\/{2,}/gu, "/")
        .replace(/^\.\//u, "");
    }
    if (/(?:At)$/u.test(key)) {
      const date = new Date(normalized);
      if (!Number.isNaN(date.valueOf())) return date.toISOString();
    }
    return normalized;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((item, index) =>
      normalize(item, [...parts, String(index)]),
    );
    const keys = semanticSetPaths.get(normalizePath(parts));
    return keys === undefined
      ? normalized
      : [...normalized].sort((left, right) => compareValues(left, right, keys));
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`Unsupported canonical value: ${String(value)}`);
  }

  const record = value as Record<string, unknown>;
  const result: Record<string, JsonValue> = {};
  for (const rawKey of Object.keys(record).sort(compareStrings)) {
    const key = rawKey.normalize("NFC");
    if (parts.length === 0 && runtimeRootFields.has(key)) continue;
    if (
      parts.length === 2 &&
      parts[0] === "analyzers" &&
      /^\d+$/u.test(parts[1] ?? "") &&
      key === "durationMs"
    ) {
      continue;
    }
    if (record[rawKey] !== undefined)
      result[key] = normalize(record[rawKey], [...parts, key]);
  }
  return result;
}

export function canonicalizeSemanticOutput(value: unknown): string {
  return JSON.stringify(normalize(value, []));
}

export function semanticDigest(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeSemanticOutput(value), "utf8")
    .digest("hex");
}
