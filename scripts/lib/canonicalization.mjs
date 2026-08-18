import { createHash } from "node:crypto";

const runtimeRootFields = new Set(["manifestId", "generatedAt", "integrity"]);
const dateTimeField = /(?:At)$/u;

const arraySorters = new Map([
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
  ["/auditEvents", compareFields("occurredAt", "id")]
]);

function compareScalar(left, right) {
  return String(left).localeCompare(String(right), "en", { sensitivity: "variant" });
}

function compareFields(...fields) {
  return (left, right) => {
    for (const field of fields) {
      const result = compareScalar(left?.[field] ?? "", right?.[field] ?? "");
      if (result !== 0) return result;
    }
    return 0;
  };
}

function escapePointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function normalizeRepositoryPath(value) {
  return value
    .normalize("NFC")
    .replaceAll("\\", "/")
    .replace(/\/{2,}/gu, "/")
    .replace(/^\.\//u, "");
}

function normalizeString(value, key) {
  const normalized = value.normalize("NFC");
  if (key === "path" || key === "previousPath") {
    return normalizeRepositoryPath(normalized);
  }
  if (dateTimeField.test(key)) {
    const date = new Date(normalized);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return normalized;
}

function normalizeValue(value, path = "", key = "") {
  if (typeof value === "string") return normalizeString(value, key);
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`Non-finite number at ${path || "/"}`);
  }
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeValue(item, `${path}/*`, ""));
    const sorter = arraySorters.get(path);
    return sorter ? normalized.toSorted(sorter) : normalized;
  }

  const entries = [];
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const normalizedKey = rawKey.normalize("NFC");
    if (path === "" && runtimeRootFields.has(normalizedKey)) continue;
    if (path === "/analyzers/*" && normalizedKey === "durationMs") continue;
    const childPath = `${path}/${escapePointer(normalizedKey)}`;
    entries.push([
      normalizedKey,
      normalizeValue(rawValue, childPath, normalizedKey)
    ]);
  }

  entries.sort(([left], [right]) => compareScalar(left, right));
  return Object.fromEntries(entries);
}

export function canonicalizeManifest(manifest) {
  return normalizeValue(structuredClone(manifest));
}

export function canonicalBytes(manifest) {
  return Buffer.from(JSON.stringify(canonicalizeManifest(manifest)), "utf8");
}

export function computeSemanticDigest(manifest) {
  return createHash("sha256").update(canonicalBytes(manifest)).digest("hex");
}

export function withSemanticDigest(manifest) {
  const result = structuredClone(manifest);
  result.integrity = {
    canonicalization: "bytesmith-c14n-1",
    semanticDigest: {
      algorithm: "sha256",
      value: computeSemanticDigest(result)
    },
    ...(manifest.integrity?.signature ? { signature: manifest.integrity.signature } : {}),
    ...(manifest.integrity?.keyId ? { keyId: manifest.integrity.keyId } : {})
  };
  return result;
}
