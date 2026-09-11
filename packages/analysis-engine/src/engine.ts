import { performance } from "node:perf_hooks";
import path from "node:path";
import { stableId } from "@bytesmith/canonicalization";
import {
  evaluateTypeScriptCallableRules,
  evaluateTypeScriptStructuralRules,
  runTypeScriptAnalyzerComparison,
  type TypeScriptAnalyzerRunResult,
} from "@bytesmith/contracts-typescript";
import {
  runOpenApiAnalyzerComparison,
  type OpenApiAnalyzerResult,
} from "@bytesmith/contracts-openapi";
import {
  analyzeOpenApiConsumers,
  analyzeTypeScriptConsumers,
  combineConsumerAnalysisResults,
  finalizeConsumerResult,
  type ConsumerAnalysisResult,
  type CombinedConsumerAnalysisResult,
} from "@bytesmith/consumer-analysis";
import {
  assembleImpactManifest,
  digestConfiguration,
  runPhase3Pipeline,
  type ImpactManifest,
  type ManifestAnalyzer,
} from "@bytesmith/impact-manifest";
import type { CanonicalIr } from "@bytesmith/ir";
import { createCanonicalIr } from "@bytesmith/ir";
import { assertImpactManifest } from "@bytesmith/manifest-validator";
import {
  runTestDiscoveryComparison,
  recommendTests,
  type TestDiscoveryComparisonResult,
  type TestRecommendationResult,
} from "@bytesmith/test-intelligence";
import {
  assertRevisionUnchanged,
  materializeGitSnapshot,
  resolveGitComparison,
  type ResolvedGitComparison,
} from "@bytesmith/vcs-git";
import { SQLiteStore, type CacheIdentity } from "@bytesmith/storage-sqlite";
import { loadConfiguration, normalizeByteSmithConfig } from "./config.js";
import {
  BYTE_SMITH_ENGINE_VERSION,
  BYTE_SMITH_RULE_SET_VERSION,
  BYTE_SMITH_SCHEMA_VERSION,
  type AnalysisEngineOptions,
  type AnalysisEngineResult,
  type ByteSmithConfigFile,
  type LoadedConfiguration,
} from "./types.js";

interface ContractOutputs {
  ir: CanonicalIr;
  changes: ImpactManifest["changes"];
  unknowns: ImpactManifest["unknowns"];
  evidence: ImpactManifest["evidence"];
  diagnostics: string[];
}

interface FamilyRuns {
  typescript?: {
    result: TypeScriptAnalyzerRunResult;
    contracts: ContractOutputs;
    analyzer: ManifestAnalyzer;
  };
  openapi?: {
    result: OpenApiAnalyzerResult | undefined;
    contracts: ContractOutputs;
    analyzer: ManifestAnalyzer;
  };
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Analysis was cancelled.", "AbortError");
  }
}

function configurationValue(
  input: AnalysisEngineOptions["config"],
): LoadedConfiguration | undefined {
  if (!input) return undefined;
  if ("config" in input && "digest" in input) return input;
  const config = normalizeByteSmithConfig(input);
  return {
    path: "<provided>",
    exists: true,
    config,
    digest: digestConfiguration(config),
  };
}

function analyzerDescriptor(
  id: string,
  config: { required: boolean; version: string },
  status: ManifestAnalyzer["status"],
  durationMs: number | undefined,
  diagnostics: readonly string[],
): ManifestAnalyzer {
  return {
    id,
    version: config.version,
    required: config.required,
    status,
    ...(durationMs === undefined
      ? {}
      : { durationMs: Math.max(0, Math.round(durationMs)) }),
    diagnostics: [...new Set(diagnostics)].sort(),
  };
}

function mergeById<T extends { id: string }>(values: readonly T[]): T[] {
  return [
    ...new Map(
      values.map((value) => [value.id, structuredClone(value)]),
    ).values(),
  ].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function mergeIrs(irs: readonly CanonicalIr[]): CanonicalIr {
  const first = irs[0];
  if (!first) throw new TypeError("At least one IR is required.");
  for (const ir of irs) {
    if (
      ir.repositoryId !== first.repositoryId ||
      ir.baseRevision !== first.baseRevision ||
      ir.headRevision !== first.headRevision
    ) {
      throw new TypeError(
        "Analysis IRs are not bound to one exact comparison.",
      );
    }
  }
  return createCanonicalIr(
    {
      repositoryId: first.repositoryId,
      baseRevision: first.baseRevision,
      headRevision: first.headRevision,
    },
    {
      evidence: mergeById(irs.flatMap((ir) => ir.evidence)),
      files: mergeById(irs.flatMap((ir) => ir.files)),
      symbols: mergeById(irs.flatMap((ir) => ir.symbols)),
      contracts: mergeById(irs.flatMap((ir) => ir.contracts)),
      relationships: mergeById(irs.flatMap((ir) => ir.relationships)),
      tests: mergeById(irs.flatMap((ir) => ir.tests)),
      gaps: mergeById(irs.flatMap((ir) => ir.gaps)),
    },
  );
}

function contractOutputs(
  result: {
    changes: ImpactManifest["changes"];
    unknowns: ImpactManifest["unknowns"];
    generatedEvidence: ImpactManifest["evidence"];
  },
  ir: CanonicalIr,
  diagnostics: readonly string[] = [],
): ContractOutputs {
  return {
    ir,
    changes: mergeById(result.changes),
    unknowns: mergeById(result.unknowns),
    evidence: mergeById([...ir.evidence, ...result.generatedEvidence]),
    diagnostics: [...diagnostics].sort(),
  };
}

async function evaluateTypeScriptContracts(
  result: TypeScriptAnalyzerRunResult,
  version: string,
): Promise<ContractOutputs> {
  const snapshot = result.snapshot;
  if (!snapshot) {
    return {
      ir: result.ir,
      changes: [],
      unknowns: result.manifestProjection.unknowns,
      evidence: result.ir.evidence,
      diagnostics: result.diagnostics,
    };
  }
  try {
    const [callable, structural] = await Promise.all([
      evaluateTypeScriptCallableRules({
        ir: result.ir,
        baseAnalysis: snapshot.baseAnalysis,
        headAnalysis: snapshot.headAnalysis,
        symbolAnalysis: snapshot.symbolAnalysis,
      }),
      evaluateTypeScriptStructuralRules({
        ir: result.ir,
        baseAnalysis: snapshot.baseAnalysis,
        headAnalysis: snapshot.headAnalysis,
        symbolAnalysis: snapshot.symbolAnalysis,
      }),
    ]);
    return contractOutputs(
      {
        changes: [...callable.changes, ...structural.changes],
        unknowns: [...callable.unknowns, ...structural.unknowns],
        generatedEvidence: [
          ...callable.generatedEvidence,
          ...structural.generatedEvidence,
        ],
      },
      result.ir,
      [
        ...result.diagnostics,
        `TypeScript contract rules evaluated with ${version}.`,
      ],
    );
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "TypeScript contract rules failed.";
    return {
      ir: result.ir,
      changes: [],
      unknowns: result.manifestProjection.unknowns,
      evidence: result.ir.evidence,
      diagnostics: [...result.diagnostics, message],
    };
  }
}

async function analyzeFamilies(
  comparison: ResolvedGitComparison,
  config: ByteSmithConfigFile,
  snapshots: { base: string; head: string },
  signal: AbortSignal | undefined,
): Promise<FamilyRuns> {
  checkAborted(signal);
  const output: FamilyRuns = {};
  const tasks: Promise<void>[] = [];
  if (config.analyzers.typescript.enabled) {
    tasks.push(
      (async () => {
        const started = performance.now();
        const result = await runTypeScriptAnalyzerComparison({
          repositoryId: comparison.identity.id,
          base: { directory: snapshots.base, revision: comparison.mergeBase },
          head: { directory: snapshots.head, revision: comparison.head.commit },
          analyzerVersion: config.analyzers.typescript.version,
        });
        const contracts = await evaluateTypeScriptContracts(
          result,
          config.analyzers.typescript.version,
        );
        output.typescript = {
          result,
          contracts,
          analyzer: analyzerDescriptor(
            "bytesmith.typescript",
            config.analyzers.typescript,
            result.status,
            Math.max(result.durationMs, performance.now() - started),
            contracts.diagnostics,
          ),
        };
      })(),
    );
  }
  if (config.analyzers.openapi.enabled) {
    tasks.push(
      (async () => {
        const started = performance.now();
        try {
          const result = await runOpenApiAnalyzerComparison({
            repositoryId: comparison.identity.id,
            base: { directory: snapshots.base, revision: comparison.mergeBase },
            head: {
              directory: snapshots.head,
              revision: comparison.head.commit,
            },
            analyzerVersion: config.analyzers.openapi.version,
          });
          const contracts = contractOutputs(result.rules, result.ir);
          output.openapi = {
            result,
            contracts,
            analyzer: analyzerDescriptor(
              "bytesmith.openapi",
              config.analyzers.openapi,
              result.rules.status,
              performance.now() - started,
              contracts.diagnostics,
            ),
          };
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : "OpenAPI analyzer failed.";
          const empty = createCanonicalIr(
            {
              repositoryId: comparison.identity.id,
              baseRevision: comparison.mergeBase,
              headRevision: comparison.head.commit,
            },
            {
              evidence: [],
              files: [],
              symbols: [],
              contracts: [],
              relationships: [],
              tests: [],
              gaps: [],
            },
          );
          output.openapi = {
            result: undefined,
            contracts: {
              ir: empty,
              changes: [],
              unknowns: [],
              evidence: [],
              diagnostics: [message],
            },
            analyzer: analyzerDescriptor(
              "bytesmith.openapi",
              config.analyzers.openapi,
              "error",
              performance.now() - started,
              [message],
            ),
          };
        }
      })(),
    );
  }
  await Promise.all(tasks);
  checkAborted(signal);
  return output;
}

async function sharedTestAndConsumerAnalysis(
  comparison: ResolvedGitComparison,
  config: ByteSmithConfigFile,
  families: FamilyRuns,
  snapshots: { base: string; head: string },
  signal: AbortSignal | undefined,
): Promise<{
  test?: TestRecommendationResult;
  discovery?: TestDiscoveryComparisonResult;
  consumers: ConsumerAnalysisResult | CombinedConsumerAnalysisResult;
  evidence: ImpactManifest["evidence"];
  impacts: ImpactManifest["impacts"];
  unknowns: ImpactManifest["unknowns"];
}> {
  const familyIrs = [
    families.typescript?.result.ir,
    families.openapi?.contracts.ir,
  ].filter((value): value is CanonicalIr => value !== undefined);
  const baseIr =
    familyIrs[0] ??
    createCanonicalIr(
      {
        repositoryId: comparison.identity.id,
        baseRevision: comparison.mergeBase,
        headRevision: comparison.head.commit,
      },
      {
        evidence: [],
        files: [],
        symbols: [],
        contracts: [],
        relationships: [],
        tests: [],
        gaps: [],
      },
    );
  const linkageIr = mergeIrs(familyIrs.length > 0 ? familyIrs : [baseIr]);
  const consumerResults: ConsumerAnalysisResult[] = [];
  if (families.typescript && families.typescript.result.snapshot) {
    consumerResults.push(
      analyzeTypeScriptConsumers({
        ir: families.typescript.result.ir,
        changes: families.typescript.contracts.changes,
        baseAnalysis: families.typescript.result.snapshot.baseAnalysis,
        headAnalysis: families.typescript.result.snapshot.headAnalysis,
        symbolAnalysis: families.typescript.result.snapshot.symbolAnalysis,
        limits: config.consumerLimits,
        analyzerVersion: config.analyzers.typescript.version,
      }),
    );
  }
  if (families.openapi && families.openapi.result) {
    consumerResults.push(
      await analyzeOpenApiConsumers({
        ir: families.openapi.contracts.ir,
        changes: families.openapi.contracts.changes,
        baseAnalysis: families.openapi.result.baseAnalysis,
        headAnalysis: families.openapi.result.headAnalysis,
        headDirectory: snapshots.head,
        limits: config.consumerLimits,
        analyzerVersion: config.analyzers.openapi.version,
      }),
    );
  }
  const consumers: ConsumerAnalysisResult | CombinedConsumerAnalysisResult =
    consumerResults.length === 0
      ? finalizeConsumerResult({
          ir: linkageIr,
          family: "typescript",
          analyzerVersion: "0.1.0",
          paths: [],
          impacts: [],
          unknowns: [],
          generatedEvidence: [],
        })
      : consumerResults.length === 1
        ? consumerResults[0]!
        : combineConsumerAnalysisResults(consumerResults);
  if (!config.analyzers.tests.enabled) {
    return {
      consumers,
      evidence: [...consumers.generatedEvidence],
      impacts: [...consumers.impacts],
      unknowns: [...consumers.unknowns],
    };
  }
  checkAborted(signal);
  const discovery = await runTestDiscoveryComparison({
    repositoryId: comparison.identity.id,
    base: { directory: snapshots.base, revision: comparison.mergeBase },
    head: { directory: snapshots.head, revision: comparison.head.commit },
    analyzerVersion: config.analyzers.tests.version,
  });
  const test = recommendTests({
    ir: linkageIr,
    testIr: discovery.ir,
    discovery: discovery.headDiscovery,
    consumers,
    limits: config.recommendationLimits,
    analyzerVersion: config.analyzers.tests.version,
  });
  return {
    test,
    discovery,
    consumers,
    evidence: mergeById([
      ...linkageIr.evidence,
      ...discovery.ir.evidence,
      ...consumers.generatedEvidence,
      ...test.evidence,
    ]),
    impacts: [...consumers.impacts],
    unknowns: mergeById([
      ...linkageIr.gaps.map((gap) => ({
        id: gap.id,
        type: gap.type,
        summary: gap.summary,
        locations: gap.locations,
        evidenceIds: gap.evidenceIds,
        blockingRelevance: gap.blockingRelevance,
      })),
      ...consumers.unknowns,
      ...test.unknowns,
    ]),
  };
}

function cacheIdentity(
  comparison: ResolvedGitComparison,
  config: ByteSmithConfigFile,
  configurationDigest: string,
): CacheIdentity {
  const analyzerVersions: Record<string, string> = {};
  if (config.analyzers.typescript.enabled)
    analyzerVersions["bytesmith.typescript"] =
      config.analyzers.typescript.version;
  if (config.analyzers.openapi.enabled)
    analyzerVersions["bytesmith.openapi"] = config.analyzers.openapi.version;
  if (config.analyzers.tests.enabled)
    analyzerVersions["bytesmith.test-intelligence"] =
      config.analyzers.tests.version;
  return {
    repositoryId: comparison.identity.id,
    baseRevision: comparison.base.commit,
    headRevision: comparison.head.commit,
    mergeBaseRevision: comparison.mergeBase,
    engineVersion: BYTE_SMITH_ENGINE_VERSION,
    analyzerVersions,
    ruleSetVersion: BYTE_SMITH_RULE_SET_VERSION,
    schemaVersion: BYTE_SMITH_SCHEMA_VERSION,
    analyzerSetId: stableId(
      "bytesmith-analyzer-set",
      Object.keys(analyzerVersions).sort(),
    ),
    configurationDigest,
  };
}

export async function analyzeRepository(
  options: AnalysisEngineOptions,
): Promise<AnalysisEngineResult> {
  const loaded =
    configurationValue(options.config) ??
    (await loadConfiguration(options.repositoryPath));
  const config = loaded.config;
  const comparison = await resolveGitComparison({
    repositoryPath: options.repositoryPath,
    base: options.base,
    head: options.head,
  });
  checkAborted(options.signal);
  const identity = cacheIdentity(comparison, config, loaded.digest.value);
  const cacheEnabled = options.useCache !== false && config.cache.enabled;
  const databasePath =
    options.databasePath ??
    (pathIsAbsolute(config.cache.databasePath)
      ? config.cache.databasePath
      : path.resolve(
          comparison.repository.rootPath,
          config.cache.databasePath,
        ));
  let store: SQLiteStore | undefined;
  let cacheState: AnalysisEngineResult["execution"]["cache"] = cacheEnabled
    ? "miss"
    : "disabled";
  if (cacheEnabled) {
    store = await SQLiteStore.open(databasePath);
    const cached = await store.getCachedManifest(identity);
    if (cached.state === "corrupt") cacheState = "corrupt";
    if (cached.state === "hit" && cached.manifest) {
      await assertRevisionUnchanged(
        comparison.repository,
        options.base,
        comparison.base.commit,
        "base",
      );
      await assertRevisionUnchanged(
        comparison.repository,
        options.head,
        comparison.head.commit,
        "head",
      );
      store.close();
      return {
        manifest: cached.manifest,
        comparison,
        configuration: loaded,
        execution: {
          cache: "hit",
          snapshots: "not_materialized",
          analyzerIds: Object.keys(identity.analyzerVersions),
        },
      };
    }
  }
  try {
    const phase3 = await runPhase3Pipeline({
      repositoryPath: comparison.repository.rootPath,
      base: options.base,
      head: options.head,
      inventoryPolicy: config.inventoryPolicy,
      analyzers: Object.entries(identity.analyzerVersions).map(
        ([id, version]) => ({
          id,
          version,
          required:
            id === "bytesmith.typescript"
              ? config.analyzers.typescript.required
              : id === "bytesmith.openapi"
                ? config.analyzers.openapi.required
                : false,
          status: "completed",
          diagnostics: [],
        }),
      ),
      producer: {
        id: "bytesmith.analysis-engine",
        version: BYTE_SMITH_ENGINE_VERSION,
      },
      engineVersion: BYTE_SMITH_ENGINE_VERSION,
      ruleSetVersion: BYTE_SMITH_RULE_SET_VERSION,
      ...(options.pullRequestId
        ? { pullRequestId: options.pullRequestId }
        : {}),
      expectedBaseRevision: comparison.base.commit,
      expectedHeadRevision: comparison.head.commit,
      ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    });
    checkAborted(options.signal);
    const baseSnapshot = await materializeGitSnapshot(
      comparison.repository,
      comparison.mergeBase,
    );
    try {
      const headSnapshot = await materializeGitSnapshot(
        comparison.repository,
        comparison.head.commit,
      );
      try {
        const families = await analyzeFamilies(
          comparison,
          config,
          { base: baseSnapshot.directory, head: headSnapshot.directory },
          options.signal,
        );
        const shared = await sharedTestAndConsumerAnalysis(
          comparison,
          config,
          families,
          { base: baseSnapshot.directory, head: headSnapshot.directory },
          options.signal,
        );
        await assertRevisionUnchanged(
          comparison.repository,
          options.base,
          comparison.base.commit,
          "base",
        );
        await assertRevisionUnchanged(
          comparison.repository,
          options.head,
          comparison.head.commit,
          "head",
        );
        const analyzers: ManifestAnalyzer[] = [
          ...(families.typescript ? [families.typescript.analyzer] : []),
          ...(families.openapi ? [families.openapi.analyzer] : []),
          ...(config.analyzers.tests.enabled
            ? [
                analyzerDescriptor(
                  "bytesmith.test-intelligence",
                  config.analyzers.tests,
                  shared.discovery?.baseDiscovery.status === "incomplete" ||
                    shared.discovery?.headDiscovery.status === "incomplete" ||
                    shared.test?.status === "incomplete"
                    ? "incomplete"
                    : "completed",
                  undefined,
                  shared.test?.diagnostics ??
                    shared.discovery?.headDiscovery.diagnostics.map(
                      (item) => item.summary,
                    ) ??
                    [],
                ),
              ]
            : []),
        ];
        const allEvidence = mergeById([
          ...phase3.snapshot.ir.evidence,
          ...(families.typescript?.contracts.evidence ?? []),
          ...(families.openapi?.contracts.evidence ?? []),
          ...shared.evidence,
        ]);
        const allChanges = mergeById([
          ...(families.typescript?.contracts.changes ?? []),
          ...(families.openapi?.contracts.changes ?? []),
        ]);
        const allUnknowns = mergeById([
          ...(families.typescript?.contracts.unknowns ?? []),
          ...(families.openapi?.contracts.unknowns ?? []),
          ...shared.unknowns,
        ]);
        const manifest = assembleImpactManifest({
          ...phase3.snapshot,
          manifestId: stableId("bytesmith-manifest", {
            repositoryId: comparison.identity.id,
            baseRevision: comparison.base.commit,
            headRevision: comparison.head.commit,
            configurationDigest: loaded.digest.value,
          }),
          generatedAt: options.generatedAt ?? new Date().toISOString(),
          engineVersion: BYTE_SMITH_ENGINE_VERSION,
          ruleSetVersion: BYTE_SMITH_RULE_SET_VERSION,
          comparison,
          configurationDigest: loaded.digest,
          scopeIr: phase3.snapshot.ir,
          analyzers,
          ...(options.pullRequestId
            ? { pullRequestId: options.pullRequestId }
            : {}),
          evidence: allEvidence,
          changes: allChanges,
          impacts: shared.impacts,
          testRecommendations: shared.test?.recommendations ?? [],
          testGaps: shared.test?.gaps ?? [],
          unknowns: allUnknowns,
        });
        await assertImpactManifest(manifest);
        if (store) {
          await store.putManifest(manifest, identity);
          store.close();
        }
        return {
          manifest,
          comparison,
          configuration: loaded,
          execution: {
            cache: cacheState,
            snapshots: "materialized",
            analyzerIds: analyzers.map((item) => item.id),
          },
        };
      } finally {
        await headSnapshot.cleanup();
      }
    } finally {
      await baseSnapshot.cleanup();
    }
  } catch (cause) {
    store?.close();
    throw cause;
  }
}

function pathIsAbsolute(value: string): boolean {
  return path.isAbsolute(value);
}
