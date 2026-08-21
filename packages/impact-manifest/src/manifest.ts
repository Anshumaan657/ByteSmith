import {
  canonicalJson,
  computeSemanticDigest,
  withSemanticDigest,
} from "@bytesmith/canonicalization";
import { createHash } from "node:crypto";
import { validateCanonicalIr } from "@bytesmith/ir";
import {
  compareCodePoints,
  normalizeNonEmptyText,
  validateStableId,
} from "@bytesmith/impact-types";
import { deriveResult } from "./result.js";
import type {
  Digest,
  ImpactManifest,
  ManifestAnalyzer,
  ManifestBuildInput,
  ManifestScopeFile,
} from "./types.js";

const digestPattern = /^[0-9a-f]{64}$/u;

export function digestConfiguration(configuration: unknown): Digest {
  return {
    algorithm: "sha256",
    value: createHash("sha256")
      .update(canonicalJson(configuration), "utf8")
      .digest("hex"),
  };
}

function validateDigest(digest: Digest): void {
  if (digest.algorithm !== "sha256" || !digestPattern.test(digest.value)) {
    throw new TypeError("Configuration digest must be lowercase SHA-256.");
  }
}

function normalizeDateTime(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) {
    throw new TypeError("Manifest generation time is invalid.");
  }
  return instant.toISOString();
}

function normalizeAnalyzer(analyzer: ManifestAnalyzer): ManifestAnalyzer {
  return {
    id: validateStableId(analyzer.id, "Analyzer ID"),
    version: normalizeNonEmptyText(analyzer.version, "Analyzer version"),
    required: analyzer.required,
    status: analyzer.status,
    ...(analyzer.durationMs === undefined
      ? {}
      : { durationMs: analyzer.durationMs }),
    diagnostics: analyzer.diagnostics.map((diagnostic) =>
      normalizeNonEmptyText(diagnostic, "Analyzer diagnostic"),
    ),
  };
}

function scopeFile(
  file: ManifestBuildInput["inventory"]["files"][number],
): ManifestScopeFile {
  return {
    path: file.path,
    ...(file.previousPath === undefined
      ? {}
      : { previousPath: file.previousPath }),
    changeType: file.changeType,
    coverageClass: file.coverageClass,
    ...(file.reason === undefined ? {} : { reason: file.reason }),
    analyzerIds: [...file.analyzerIds],
  };
}

function remoteUrl(locator: string): string | undefined {
  try {
    const url = new URL(locator);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString().replace(/\/$/u, "")
      : undefined;
  } catch {
    return undefined;
  }
}

export function createImpactManifest(
  input: ManifestBuildInput,
): ImpactManifest {
  validateDigest(input.configurationDigest);
  validateCanonicalIr(input.ir);
  const { comparison, inventory, ir } = input;
  if (
    inventory.fromCommit !== comparison.mergeBase ||
    inventory.toCommit !== comparison.head.commit ||
    ir.repositoryId !== comparison.identity.id ||
    ir.baseRevision !== comparison.mergeBase ||
    ir.headRevision !== comparison.head.commit
  ) {
    throw new TypeError(
      "Manifest inputs do not share one repository and revision binding.",
    );
  }
  if (
    inventory.files.length !== ir.files.length ||
    inventory.files.some(
      (file) => !ir.files.some((record) => record.location.path === file.path),
    )
  ) {
    throw new TypeError(
      "Manifest inventory and canonical IR denominators differ.",
    );
  }

  const analyzers = input.analyzers
    .map(normalizeAnalyzer)
    .sort((left, right) => compareCodePoints(left.id, right.id));
  if (new Set(analyzers.map((item) => item.id)).size !== analyzers.length) {
    throw new TypeError("Manifest analyzer IDs must be unique.");
  }
  const analyzerIds = new Set(analyzers.map((item) => item.id));
  for (const file of inventory.files) {
    for (const analyzerId of file.analyzerIds) {
      if (!analyzerIds.has(analyzerId)) {
        throw new TypeError(
          `Inventory references missing analyzer ${analyzerId}.`,
        );
      }
    }
  }

  const repositoryRemote = remoteUrl(comparison.identity.canonicalLocator);
  const unsealed = {
    schemaVersion: "1.0.0",
    manifestId: validateStableId(input.manifestId, "Manifest ID"),
    generatedAt: normalizeDateTime(input.generatedAt),
    engine: {
      name: "ByteSmith",
      version: normalizeNonEmptyText(input.engineVersion, "Engine version"),
      ruleSetVersion: normalizeNonEmptyText(
        input.ruleSetVersion,
        "Rule-set version",
      ),
    },
    repository: {
      id: comparison.identity.id,
      name: comparison.identity.name,
      vcs: "git",
      ...(repositoryRemote ? { remote: repositoryRemote } : {}),
    },
    comparison: {
      baseRevision: comparison.base.commit,
      headRevision: comparison.head.commit,
      mergeBaseRevision: comparison.mergeBase,
      ...(input.pullRequestId ? { pullRequestId: input.pullRequestId } : {}),
    },
    configurationDigest: input.configurationDigest,
    scope: {
      files: inventory.files.map(scopeFile),
      coverage: structuredClone(inventory.coverage),
    },
    analyzers,
    evidence: structuredClone(ir.evidence),
    changes: [],
    impacts: [],
    tests: { recommended: [], gaps: [] },
    unknowns: ir.gaps.map((gap) => ({
      id: gap.id,
      type: gap.type,
      summary: gap.summary,
      locations: structuredClone(gap.locations),
      evidenceIds: [...gap.evidenceIds],
      blockingRelevance: gap.blockingRelevance,
    })),
    policies: [],
    dispositions: [],
    appeals: [],
    waivers: [],
    suspensions: [],
    auditEvents: [],
  } satisfies Omit<ImpactManifest, "status" | "integrity">;
  const status = deriveResult(unsealed);
  return withSemanticDigest({ ...unsealed, status });
}

export function verifySemanticDigest(manifest: ImpactManifest): boolean {
  return (
    manifest.integrity.canonicalization === "bytesmith-c14n-1" &&
    manifest.integrity.semanticDigest.algorithm === "sha256" &&
    manifest.integrity.semanticDigest.value === computeSemanticDigest(manifest)
  );
}

export function serializeImpactManifest(
  manifest: ImpactManifest,
  options: { pretty?: boolean } = {},
): string {
  if (!verifySemanticDigest(manifest)) {
    throw new TypeError("Impact Manifest semantic digest is invalid.");
  }
  return options.pretty
    ? `${JSON.stringify(manifest, undefined, 2)}\n`
    : JSON.stringify(manifest);
}
