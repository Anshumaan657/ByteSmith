import { createHash } from "node:crypto";
import { compareCodePoints } from "@bytesmith/impact-types";
import type { CanonicalValue } from "./stable-id.js";

export const MANIFEST_CANONICALIZATION = "bytesmith-c14n-1" as const;
export const MANIFEST_DIGEST_ALGORITHM = "sha256" as const;

const runtimeRootFields = new Set(["manifestId", "generatedAt", "integrity"]);
const dateTimeField = /(?:At)$/u;

type Sorter = (left: CanonicalValue, right: CanonicalValue) => number;

function scalar(value: CanonicalValue | undefined): string {
  return value === undefined || value === null ? "" : String(value);
}

function compareScalar(left: CanonicalValue, right: CanonicalValue): number {
  return compareCodePoints(scalar(left), scalar(right));
}

function compareFields(...fields: string[]): Sorter {
  return (left, right) => {
    for (const field of fields) {
      const leftValue =
        typeof left === "object" && left !== null && !Array.isArray(left)
          ? left[field]
          : undefined;
      const rightValue =
        typeof right === "object" && right !== null && !Array.isArray(right)
          ? right[field]
          : undefined;
      const result = compareCodePoints(scalar(leftValue), scalar(rightValue));
      if (result !== 0) return result;
    }
    return 0;
  };
}

const arraySorters = new Map<string, Sorter>([
  ["/status/reasons", compareFields("code", "summary")],
  ["/scope/files", compareFields("path", "changeType")],
  ["/scope/files/*/analyzerIds", compareScalar],
  ["/analyzers", compareFields("id", "version")],
  ["/evidence", compareFields("id")],
  ["/changes", compareFields("id")],
  ["/changes/*/evidenceIds", compareScalar],
  ["/impacts", compareFields("id")],
  ["/impacts/*/sourceChangeIds", compareScalar],
  ["/impacts/*/affectedComponents", compareFields("id")],
  ["/impacts/*/evidenceIds", compareScalar],
  ["/tests/recommended", compareFields("id")],
  ["/tests/gaps", compareFields("id")],
  ["/unknowns", compareFields("id")],
  ["/unknowns/*/evidenceIds", compareScalar],
  ["/policies", compareFields("id")],
  ["/policies/*/findingIds", compareScalar],
  ["/policies/*/analysisGapIds", compareScalar],
  ["/dispositions", compareFields("id")],
  ["/appeals", compareFields("id")],
  ["/waivers", compareFields("id")],
  ["/suspensions", compareFields("id")],
  ["/dispositions/*/auditEventIds", compareScalar],
  ["/appeals/*/auditEventIds", compareScalar],
  ["/waivers/*/auditEventIds", compareScalar],
  ["/suspensions/*/auditEventIds", compareScalar],
  ["/auditEvents", compareFields("occurredAt", "id")],
]);

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function normalizeManifestPath(value: string): string {
  return value
    .normalize("NFC")
    .replaceAll("\\", "/")
    .replace(/\/{2,}/gu, "/")
    .replace(/^\.\//u, "");
}

function normalizeString(value: string, key: string): string {
  const normalized = value.normalize("NFC");
  if (key === "path" || key === "previousPath") {
    return normalizeManifestPath(normalized);
  }
  if (dateTimeField.test(key)) {
    const date = new Date(normalized);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return normalized;
}

function normalizeValue(
  value: unknown,
  pointer = "",
  key = "",
): CanonicalValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return normalizeString(value, key);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${pointer || "/"}.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((item) =>
      normalizeValue(item, `${pointer}/*`, ""),
    );
    const sorter = arraySorters.get(pointer);
    if (sorter) normalized.sort(sorter);
    return normalized;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`Value at ${pointer || "/"} is not JSON-compatible.`);
  }

  const entries = Object.entries(value).map(([rawKey, rawValue]) => {
    if (rawValue === undefined) {
      throw new TypeError(`Property ${pointer}/${rawKey} is undefined.`);
    }
    return [rawKey.normalize("NFC"), rawValue] as const;
  });
  entries.sort(([left], [right]) => compareCodePoints(left, right));
  const result: Record<string, CanonicalValue> = {};
  for (const [normalizedKey, rawValue] of entries) {
    if (pointer === "" && runtimeRootFields.has(normalizedKey)) continue;
    if (pointer === "/analyzers/*" && normalizedKey === "durationMs") continue;
    if (Object.hasOwn(result, normalizedKey)) {
      throw new TypeError(
        `Object at ${pointer || "/"} contains colliding normalized keys.`,
      );
    }
    result[normalizedKey] = normalizeValue(
      rawValue,
      `${pointer}/${escapePointer(normalizedKey)}`,
      normalizedKey,
    );
  }
  return result;
}

export function canonicalizeManifest(manifest: unknown): CanonicalValue {
  return normalizeValue(manifest);
}

export function canonicalManifestJson(manifest: unknown): string {
  return JSON.stringify(canonicalizeManifest(manifest));
}

export function canonicalManifestBytes(manifest: unknown): Buffer {
  return Buffer.from(canonicalManifestJson(manifest), "utf8");
}

export function computeSemanticDigest(manifest: unknown): string {
  return createHash("sha256")
    .update(canonicalManifestBytes(manifest))
    .digest("hex");
}

export function withSemanticDigest<T extends object>(
  manifest: T,
): T & {
  integrity: {
    canonicalization: typeof MANIFEST_CANONICALIZATION;
    semanticDigest: {
      algorithm: typeof MANIFEST_DIGEST_ALGORITHM;
      value: string;
    };
    signature?: string;
    keyId?: string;
  };
} {
  const source = manifest as T & {
    integrity?: { signature?: string; keyId?: string };
  };
  const result = structuredClone(manifest) as T;
  return Object.assign(result, {
    integrity: {
      canonicalization: MANIFEST_CANONICALIZATION,
      semanticDigest: {
        algorithm: MANIFEST_DIGEST_ALGORITHM,
        value: computeSemanticDigest(result),
      },
      ...(source.integrity?.signature
        ? { signature: source.integrity.signature }
        : {}),
      ...(source.integrity?.keyId ? { keyId: source.integrity.keyId } : {}),
    },
  });
}
