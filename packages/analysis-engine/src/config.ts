import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { digestConfiguration } from "@bytesmith/impact-manifest";
import { validateInventoryPolicy } from "@bytesmith/repository-inventory";
import type { InventoryPolicy } from "@bytesmith/repository-inventory";
import {
  BYTE_SMITH_CONFIG_VERSION,
  type AnalyzerConfig,
  type ByteSmithConfigFile,
  type LoadedConfiguration,
} from "./types.js";

export const DEFAULT_CONFIG_RELATIVE_PATH = ".bytesmith/config.json";
export const DEFAULT_DATABASE_RELATIVE_PATH = ".bytesmith/bytesmith.sqlite";

const defaultInventoryPolicy: InventoryPolicy = {
  analyzerClaims: [
    {
      analyzerId: "bytesmith.typescript",
      matcher: {
        extensions: [
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mts",
          ".cts",
          ".mjs",
          ".cjs",
        ],
      },
    },
    {
      analyzerId: "bytesmith.openapi",
      matcher: {
        fileNames: [
          "openapi.json",
          "openapi.yaml",
          "openapi.yml",
          "swagger.json",
          "swagger.yaml",
          "swagger.yml",
        ],
      },
    },
  ],
};

const defaultAnalyzer = (required: boolean): AnalyzerConfig => ({
  enabled: true,
  required,
  version: "0.1.0",
});

export function defaultByteSmithConfig(): ByteSmithConfigFile {
  return {
    schemaVersion: BYTE_SMITH_CONFIG_VERSION,
    analyzers: {
      typescript: defaultAnalyzer(true),
      openapi: defaultAnalyzer(false),
      tests: defaultAnalyzer(false),
    },
    inventoryPolicy: structuredClone(defaultInventoryPolicy),
    consumerLimits: { maxDepth: 8, maxConsumers: 10_000, maxEdges: 50_000 },
    recommendationLimits: { maxRecommendationsPerComponent: 3 },
    cache: { enabled: true, databasePath: DEFAULT_DATABASE_RELATIVE_PATH },
  };
}

function record(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${description} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function positive(value: unknown, description: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${description} must be a positive safe integer.`);
  }
  return value as number;
}

function text(value: unknown, description: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new TypeError(`${description} must be non-empty text.`);
  }
  return value.normalize("NFC");
}

function boolean(value: unknown, description: string): boolean {
  if (typeof value !== "boolean")
    throw new TypeError(`${description} must be boolean.`);
  return value;
}

function assertKeys(
  candidate: Record<string, unknown>,
  allowed: readonly string[],
  description: string,
): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(candidate)) {
    if (!accepted.has(key))
      throw new TypeError(`${description}.${key} is not supported.`);
  }
}

function analyzerConfig(
  value: unknown,
  description: string,
  fallback: AnalyzerConfig,
): AnalyzerConfig {
  if (value === undefined) return fallback;
  const candidate = record(value, description);
  for (const key of Object.keys(candidate)) {
    if (!new Set(["enabled", "required", "version"]).has(key)) {
      throw new TypeError(`${description}.${key} is not supported.`);
    }
  }
  return {
    enabled:
      candidate.enabled === undefined
        ? fallback.enabled
        : boolean(candidate.enabled, `${description}.enabled`),
    required:
      candidate.required === undefined
        ? fallback.required
        : boolean(candidate.required, `${description}.required`),
    version:
      candidate.version === undefined
        ? fallback.version
        : text(candidate.version, `${description}.version`),
  };
}

function normalizePolicy(
  value: unknown,
  enabledIds: ReadonlySet<string>,
): InventoryPolicy {
  if (value === undefined)
    return {
      analyzerClaims: defaultInventoryPolicy.analyzerClaims.filter((claim) =>
        enabledIds.has(claim.analyzerId),
      ),
    };
  const candidate = record(value, "inventoryPolicy");
  assertKeys(candidate, ["analyzerClaims", "rules"], "inventoryPolicy");
  const claims = candidate.analyzerClaims;
  if (!Array.isArray(claims))
    throw new TypeError("inventoryPolicy.analyzerClaims must be an array.");
  const policy: InventoryPolicy = {
    analyzerClaims: claims.map((item) =>
      structuredClone(item),
    ) as InventoryPolicy["analyzerClaims"],
  };
  if (candidate.rules !== undefined) {
    if (!Array.isArray(candidate.rules))
      throw new TypeError("inventoryPolicy.rules must be an array.");
    policy.rules = structuredClone(candidate.rules) as NonNullable<
      InventoryPolicy["rules"]
    >;
  }
  validateInventoryPolicy(policy);
  for (const claim of policy.analyzerClaims) {
    if (!enabledIds.has(claim.analyzerId)) {
      throw new TypeError(
        `inventoryPolicy references disabled or unknown analyzer ${claim.analyzerId}.`,
      );
    }
  }
  return policy;
}

export function normalizeByteSmithConfig(value: unknown): ByteSmithConfigFile {
  const defaults = defaultByteSmithConfig();
  const candidate = value === undefined ? {} : record(value, "Configuration");
  for (const key of Object.keys(candidate)) {
    if (
      !new Set([
        "schemaVersion",
        "analyzers",
        "inventoryPolicy",
        "consumerLimits",
        "recommendationLimits",
        "cache",
      ]).has(key)
    ) {
      throw new TypeError(`Configuration property ${key} is not supported.`);
    }
  }
  if (
    candidate.schemaVersion !== undefined &&
    candidate.schemaVersion !== BYTE_SMITH_CONFIG_VERSION
  ) {
    throw new TypeError(
      `Unsupported ByteSmith configuration schema ${String(candidate.schemaVersion)}.`,
    );
  }
  const analyzers = record(candidate.analyzers ?? {}, "analyzers");
  for (const key of Object.keys(analyzers)) {
    if (!new Set(["typescript", "openapi", "tests"]).has(key))
      throw new TypeError(`Unsupported analyzer ${key}.`);
  }
  const normalizedAnalyzers = {
    typescript: analyzerConfig(
      analyzers.typescript,
      "analyzers.typescript",
      defaults.analyzers.typescript,
    ),
    openapi: analyzerConfig(
      analyzers.openapi,
      "analyzers.openapi",
      defaults.analyzers.openapi,
    ),
    tests: analyzerConfig(
      analyzers.tests,
      "analyzers.tests",
      defaults.analyzers.tests,
    ),
  };
  const enabledIds = new Set<string>([
    ...(normalizedAnalyzers.typescript.enabled ? ["bytesmith.typescript"] : []),
    ...(normalizedAnalyzers.openapi.enabled ? ["bytesmith.openapi"] : []),
  ]);
  const limits = record(candidate.consumerLimits ?? {}, "consumerLimits");
  assertKeys(
    limits,
    ["maxDepth", "maxConsumers", "maxEdges"],
    "consumerLimits",
  );
  const recommendations = record(
    candidate.recommendationLimits ?? {},
    "recommendationLimits",
  );
  assertKeys(
    recommendations,
    ["maxRecommendationsPerComponent"],
    "recommendationLimits",
  );
  const cache = record(candidate.cache ?? {}, "cache");
  assertKeys(cache, ["enabled", "databasePath"], "cache");
  const normalized: ByteSmithConfigFile = {
    schemaVersion: BYTE_SMITH_CONFIG_VERSION,
    analyzers: normalizedAnalyzers,
    inventoryPolicy: normalizePolicy(candidate.inventoryPolicy, enabledIds),
    consumerLimits: {
      maxDepth:
        limits.maxDepth === undefined
          ? defaults.consumerLimits.maxDepth
          : positive(limits.maxDepth, "consumerLimits.maxDepth"),
      maxConsumers:
        limits.maxConsumers === undefined
          ? defaults.consumerLimits.maxConsumers
          : positive(limits.maxConsumers, "consumerLimits.maxConsumers"),
      maxEdges:
        limits.maxEdges === undefined
          ? defaults.consumerLimits.maxEdges
          : positive(limits.maxEdges, "consumerLimits.maxEdges"),
    },
    recommendationLimits: {
      maxRecommendationsPerComponent:
        recommendations.maxRecommendationsPerComponent === undefined
          ? defaults.recommendationLimits.maxRecommendationsPerComponent
          : positive(
              recommendations.maxRecommendationsPerComponent,
              "recommendationLimits.maxRecommendationsPerComponent",
            ),
    },
    cache: {
      enabled:
        cache.enabled === undefined
          ? defaults.cache.enabled
          : boolean(cache.enabled, "cache.enabled"),
      databasePath:
        cache.databasePath === undefined
          ? defaults.cache.databasePath
          : text(cache.databasePath, "cache.databasePath"),
    },
  };
  return normalized;
}

export async function loadConfiguration(
  repositoryRoot: string,
  configurationPath = path.join(repositoryRoot, DEFAULT_CONFIG_RELATIVE_PATH),
): Promise<LoadedConfiguration> {
  const resolved = path.resolve(configurationPath);
  try {
    const parsed = JSON.parse(await readFile(resolved, "utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "schemaVersion" in parsed &&
      parsed.schemaVersion !== BYTE_SMITH_CONFIG_VERSION
    ) {
      const error = new Error(
        `Unsupported ByteSmith configuration schema ${String(parsed.schemaVersion)}.`,
      );
      Object.assign(error, { code: "unsupported_schema" });
      throw error;
    }
    const config = normalizeByteSmithConfig(parsed);
    return {
      path: resolved,
      exists: true,
      config,
      digest: digestConfiguration(config),
    };
  } catch (cause) {
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause as { code?: unknown }).code === "unsupported_schema"
    ) {
      throw cause;
    }
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause as { code?: unknown }).code === "ENOENT"
    ) {
      const config = normalizeByteSmithConfig(undefined);
      return {
        path: resolved,
        exists: false,
        config,
        digest: digestConfiguration(config),
      };
    }
    const error = new TypeError(
      `ByteSmith configuration at ${resolved} is invalid.`,
      { cause },
    );
    Object.assign(error, { code: "invalid_configuration" });
    throw error;
  }
}

export async function writeDefaultConfiguration(
  repositoryRoot: string,
): Promise<LoadedConfiguration> {
  const resolved = path.join(repositoryRoot, DEFAULT_CONFIG_RELATIVE_PATH);
  const config = defaultByteSmithConfig();
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(config, undefined, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  }).catch((cause: unknown) => {
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause as { code?: unknown }).code === "EEXIST"
    ) {
      const error = new Error(`Configuration already exists at ${resolved}.`);
      Object.assign(error, { code: "invalid_configuration" });
      throw error;
    }
    throw cause;
  });
  return {
    path: resolved,
    exists: true,
    config,
    digest: digestConfiguration(config),
  };
}
