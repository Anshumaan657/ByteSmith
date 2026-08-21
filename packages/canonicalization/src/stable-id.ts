import { createHash } from "node:crypto";
import {
  compareCodePoints,
  validateStableId,
  type StableId,
} from "@bytesmith/impact-types";

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

const namespacePattern = /^[A-Za-z][A-Za-z0-9._-]*$/u;

function normalizeCanonicalValue(
  value: unknown,
  pointer: string,
): CanonicalValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Canonical value at ${pointer} is not finite.`);
    }
    return value;
  }
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      normalizeCanonicalValue(item, `${pointer}/${index}`),
    );
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(
      `Canonical value at ${pointer} is not JSON-compatible.`,
    );
  }

  const normalizedEntries = Object.entries(value).map(([key, item]) => {
    if (item === undefined) {
      throw new TypeError(
        `Canonical object property ${pointer}/${key} is undefined.`,
      );
    }
    return [key.normalize("NFC"), item] as const;
  });
  normalizedEntries.sort(([left], [right]) => compareCodePoints(left, right));
  const result: Record<string, CanonicalValue> = {};
  for (const [key, item] of normalizedEntries) {
    if (Object.hasOwn(result, key)) {
      throw new TypeError(
        `Canonical object at ${pointer} contains colliding normalized keys.`,
      );
    }
    result[key] = normalizeCanonicalValue(item, `${pointer}/${key}`);
  }
  return result;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalValue(value, ""));
}

export function stableId(namespace: string, semanticInput: unknown): StableId {
  if (!namespacePattern.test(namespace)) {
    throw new TypeError("Stable ID namespace is invalid.");
  }
  const digest = createHash("sha256")
    .update(canonicalJson(semanticInput), "utf8")
    .digest("hex");
  return validateStableId(`${namespace}:${digest}`, "Generated stable ID");
}

export function verifyStableId(
  value: string,
  namespace: string,
  semanticInput: unknown,
): boolean {
  validateStableId(value);
  return value === stableId(namespace, semanticInput);
}
