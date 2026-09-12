import type {
  AnalyzerStatus,
  Digest,
  ImpactManifest,
  ManifestAnalyzer,
} from "@bytesmith/impact-manifest";
import type { InventoryPolicy } from "@bytesmith/repository-inventory";
import type { ResolvedGitComparison } from "@bytesmith/vcs-git";

export const BYTE_SMITH_CONFIG_VERSION = "1.0.0" as const;
export const BYTE_SMITH_SCHEMA_VERSION = "1.0.0" as const;
export const BYTE_SMITH_ENGINE_VERSION = "0.1.0" as const;
export const BYTE_SMITH_RULE_SET_VERSION = "0.1.0" as const;

export interface AnalyzerConfig {
  enabled: boolean;
  required: boolean;
  version: string;
}

export interface ByteSmithConfigFile {
  schemaVersion: typeof BYTE_SMITH_CONFIG_VERSION;
  analyzers: {
    typescript: AnalyzerConfig;
    openapi: AnalyzerConfig;
    tests: AnalyzerConfig;
  };
  inventoryPolicy: InventoryPolicy;
  consumerLimits: {
    maxDepth: number;
    maxConsumers: number;
    maxEdges: number;
  };
  recommendationLimits: {
    maxRecommendationsPerComponent: number;
  };
  cache: {
    enabled: boolean;
    databasePath: string;
  };
}

export interface LoadedConfiguration {
  path: string;
  exists: boolean;
  config: ByteSmithConfigFile;
  digest: Digest;
}

export interface AnalysisEngineOptions {
  repositoryPath: string;
  base: string;
  head: string;
  config?: LoadedConfiguration | ByteSmithConfigFile;
  databasePath?: string;
  useCache?: boolean;
  generatedAt?: string;
  pullRequestId?: string;
  signal?: AbortSignal;
}

export interface AnalysisExecution {
  cache: "hit" | "miss" | "disabled" | "corrupt";
  snapshots: "materialized" | "not_materialized";
  analyzerIds: string[];
}

export interface AnalysisEngineResult {
  manifest: ImpactManifest;
  comparison: ResolvedGitComparison;
  configuration: LoadedConfiguration;
  execution: AnalysisExecution;
}

export interface AnalyzerOutcome {
  analyzer: ManifestAnalyzer;
  status: AnalyzerStatus;
}
