import { stableId } from "@bytesmith/canonicalization";
import { createEvidence } from "@bytesmith/evidence";
import {
  createCanonicalIr,
  createIrFile,
  createIrGap,
  validateCanonicalIr,
} from "@bytesmith/ir";
import { compareCodePoints } from "@bytesmith/impact-types";
import { createRepositoryInventory } from "@bytesmith/repository-inventory";
import {
  assertRevisionUnchanged,
  readComparisonDiff,
  resolveGitComparison,
} from "@bytesmith/vcs-git";
import { createImpactManifest, digestConfiguration } from "./manifest.js";
import type {
  Phase3PipelineOptions,
  Phase3PipelineResult,
  Phase3SemanticSnapshot,
} from "./types.js";

function assertExpectedRevisions(
  options: Phase3PipelineOptions,
  baseRevision: string,
  headRevision: string,
): void {
  if (
    (options.expectedBaseRevision !== undefined &&
      options.expectedBaseRevision !== baseRevision) ||
    (options.expectedHeadRevision !== undefined &&
      options.expectedHeadRevision !== headRevision)
  ) {
    throw new Error(
      "stale_revision: resolved comparison differs from expectation.",
    );
  }
}

function snapshotMatches(
  snapshot: Phase3SemanticSnapshot | undefined,
  repositoryId: string,
  baseRevision: string,
  headRevision: string,
  mergeBaseRevision: string,
  configurationDigest: Phase3SemanticSnapshot["configurationDigest"],
): snapshot is Phase3SemanticSnapshot {
  return (
    snapshot !== undefined &&
    snapshot.repositoryId === repositoryId &&
    snapshot.baseRevision === baseRevision &&
    snapshot.headRevision === headRevision &&
    snapshot.mergeBaseRevision === mergeBaseRevision &&
    snapshot.configurationDigest.algorithm === configurationDigest.algorithm &&
    snapshot.configurationDigest.value === configurationDigest.value
  );
}

function revisionForFile(
  changeType: string,
  baseRevision: string,
  headRevision: string,
): string {
  return changeType === "deleted" ? baseRevision : headRevision;
}

export async function runPhase3Pipeline(
  options: Phase3PipelineOptions,
): Promise<Phase3PipelineResult> {
  const comparison = await resolveGitComparison({
    repositoryPath: options.repositoryPath,
    base: options.base,
    head: options.head,
  });
  assertExpectedRevisions(
    options,
    comparison.base.commit,
    comparison.head.commit,
  );
  const configurationDigest = digestConfiguration({
    inventoryPolicy: options.inventoryPolicy,
    analyzers: options.analyzers.map((analyzer) => ({
      id: analyzer.id,
      version: analyzer.version,
      required: analyzer.required,
    })),
    producer: options.producer,
    engineVersion: options.engineVersion,
    ruleSetVersion: options.ruleSetVersion,
  });

  let snapshot: Phase3SemanticSnapshot;
  let execution: "clean" | "incremental";
  if (
    snapshotMatches(
      options.incrementalSeed,
      comparison.identity.id,
      comparison.base.commit,
      comparison.head.commit,
      comparison.mergeBase,
      configurationDigest,
    )
  ) {
    validateCanonicalIr(options.incrementalSeed.ir);
    const reconstructed = createRepositoryInventory(
      options.incrementalSeed.diff,
      options.inventoryPolicy,
    );
    if (
      JSON.stringify(reconstructed) !==
      JSON.stringify(options.incrementalSeed.inventory)
    ) {
      throw new TypeError(
        "Incremental snapshot inventory is not reproducible.",
      );
    }
    snapshot = structuredClone(options.incrementalSeed);
    execution = "incremental";
  } else {
    const diff = await readComparisonDiff(comparison);
    const inventory = createRepositoryInventory(diff, options.inventoryPolicy);
    const context = {
      repositoryId: comparison.identity.id,
      baseRevision: comparison.mergeBase,
      headRevision: comparison.head.commit,
    };
    const evidence = inventory.files.map((file) => {
      const revision = revisionForFile(
        file.changeType,
        comparison.mergeBase,
        comparison.head.commit,
      );
      return createEvidence(
        { ...context, producer: options.producer },
        {
          kind: "coverage",
          revision,
          path: file.path,
          summary: `${file.coverageClass}: ${file.reason ?? "accepted by configured analyzer"}`,
        },
      );
    });
    const evidenceByPath = new Map(
      evidence.map((record) => [record.location.path, record]),
    );
    const files = inventory.files.map((file) => {
      const record = evidenceByPath.get(file.path);
      if (!record) throw new TypeError("Inventory evidence is missing.");
      return createIrFile(context, {
        revision: record.location.revision,
        path: file.path,
        evidenceIds: [record.id],
      });
    });
    const gaps = inventory.files
      .filter(
        (file) =>
          file.coverageClass === "unsupported" ||
          file.coverageClass === "partially_analyzed",
      )
      .map((file) => {
        const record = evidenceByPath.get(file.path);
        if (!record) throw new TypeError("Inventory gap evidence is missing.");
        return createIrGap(context, {
          revision: record.location.revision,
          type:
            file.coverageClass === "unsupported"
              ? "unsupported_file"
              : "analyzer_gap",
          summary: file.reason ?? "Analyzer reported partial coverage.",
          locations: [{ revision: record.location.revision, path: file.path }],
          evidenceIds: [record.id],
          blockingRelevance: "possible",
        });
      });
    const ir = createCanonicalIr(context, {
      evidence,
      files,
      symbols: [],
      contracts: [],
      relationships: [],
      tests: [],
      gaps,
    });
    snapshot = {
      repositoryId: comparison.identity.id,
      baseRevision: comparison.base.commit,
      headRevision: comparison.head.commit,
      mergeBaseRevision: comparison.mergeBase,
      configurationDigest,
      diff,
      inventory,
      ir,
    };
    execution = "clean";
  }

  await Promise.all([
    assertRevisionUnchanged(
      comparison.repository,
      options.base,
      comparison.base.commit,
      "base",
    ),
    assertRevisionUnchanged(
      comparison.repository,
      options.head,
      comparison.head.commit,
      "head",
    ),
  ]);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const analyzers = [...options.analyzers].sort((left, right) =>
    compareCodePoints(left.id, right.id),
  );
  const manifest = createImpactManifest({
    manifestId: stableId("manifest", {
      repositoryId: comparison.identity.id,
      baseRevision: comparison.base.commit,
      headRevision: comparison.head.commit,
      generatedAt,
    }),
    generatedAt,
    engineVersion: options.engineVersion,
    ruleSetVersion: options.ruleSetVersion,
    comparison,
    configurationDigest,
    inventory: snapshot.inventory,
    ir: snapshot.ir,
    analyzers,
    ...(options.pullRequestId ? { pullRequestId: options.pullRequestId } : {}),
  });
  return { manifest, snapshot, execution };
}
