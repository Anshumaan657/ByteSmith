import { stableId } from "@bytesmith/canonicalization";
import { createEvidence } from "@bytesmith/evidence";
import {
  createCanonicalIr,
  createIrContract,
  createIrFile,
  createIrGap,
  createIrRelationship,
  createIrSymbol,
  type CanonicalIr,
  type IrContract,
  type IrFile,
  type IrGap,
  type IrRelationship,
  type IrSymbol,
} from "@bytesmith/ir";
import type { Evidence, EvidenceKind } from "@bytesmith/impact-types";
import type {
  AnalyzerFailureKind,
  TypeScriptCompilerAnalysis,
  TypeScriptManifestProjection,
} from "./types.js";

interface ProjectionContext {
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  analyzerVersion: string;
}

interface IrAccumulator {
  evidence: Evidence[];
  files: IrFile[];
  symbols: IrSymbol[];
  contracts: IrContract[];
  relationships: IrRelationship[];
  gaps: IrGap[];
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function gapEvidenceKind(type: string): EvidenceKind {
  if (type === "configuration_failure") return "configuration";
  if (type === "reflection" || type === "complex_dependency_injection") {
    return "runtime";
  }
  if (
    type === "dynamic_import" ||
    type === "unresolved_module" ||
    type === "unresolved_symbol"
  ) {
    return "import";
  }
  return "type";
}

function irGapType(type: string): IrGap["type"] {
  if (type === "dynamic_import") return "dynamic_import";
  if (type === "reflection") return "reflection";
  if (type === "generated_code") return "generated_code";
  if (type === "unresolved_module" || type === "unresolved_symbol") {
    return "unresolved_symbol";
  }
  return "analyzer_gap";
}

function fileKey(revision: string, path: string): string {
  return `${revision}\0${path}`;
}

function projectRevision(
  context: ProjectionContext,
  analysis: TypeScriptCompilerAnalysis,
  accumulator: IrAccumulator,
): void {
  const irContext = {
    repositoryId: context.repositoryId,
    baseRevision: context.baseRevision,
    headRevision: context.headRevision,
  };
  const evidenceContext = {
    ...irContext,
    producer: {
      id: "bytesmith.typescript",
      version: context.analyzerVersion,
    },
  };
  const filePaths = new Set(
    analysis.projects.flatMap((project) => project.sourceFiles),
  );
  for (const reference of analysis.moduleReferences) {
    if (
      reference.resolution === "resolved_internal" &&
      reference.resolvedPath
    ) {
      filePaths.add(reference.resolvedPath);
    }
  }
  for (const packageExport of analysis.packageExports) {
    filePaths.add(packageExport.manifestPath);
  }
  const files = new Map<string, IrFile>();
  for (const sourcePath of [...filePaths].sort()) {
    const evidence = createEvidence(evidenceContext, {
      kind: "syntax",
      revision: analysis.revision,
      path: sourcePath,
      summary: `TypeScript analyzer accepted ${sourcePath} as revision-owned source.`,
    });
    const file = createIrFile(irContext, {
      revision: analysis.revision,
      path: sourcePath,
      evidenceIds: [evidence.id],
    });
    accumulator.evidence.push(evidence);
    accumulator.files.push(file);
    files.set(fileKey(analysis.revision, sourcePath), file);
  }

  const irSymbols = new Map<string, IrSymbol>();
  const sourceSymbols = new Map(
    analysis.symbols.map((symbol) => [symbol.id, symbol]),
  );
  for (const symbol of analysis.symbols) {
    const file = files.get(fileKey(symbol.revision, symbol.path));
    if (!file) continue;
    const evidence = createEvidence(evidenceContext, {
      kind: "type",
      revision: symbol.revision,
      path: symbol.path,
      startLine: symbol.line,
      startColumn: symbol.column,
      endLine: symbol.endLine,
      endColumn: symbol.endColumn,
      summary: `TypeScript resolved ${symbol.kind} ${symbol.qualifiedName}.`,
    });
    const irSymbol = createIrSymbol(irContext, {
      revision: symbol.revision,
      path: symbol.path,
      startLine: symbol.line,
      startColumn: symbol.column,
      endLine: symbol.endLine,
      endColumn: symbol.endColumn,
      fileId: file.id,
      kind: symbol.kind,
      name: symbol.qualifiedName,
      exported: symbol.exported,
      evidenceIds: [evidence.id],
    });
    accumulator.evidence.push(evidence);
    accumulator.symbols.push(irSymbol);
    irSymbols.set(symbol.id, irSymbol);
  }

  for (const contract of analysis.contracts) {
    const source = sourceSymbols.get(contract.symbolId);
    const subject = irSymbols.get(contract.symbolId);
    if (!source || !subject) continue;
    const evidence = createEvidence(evidenceContext, {
      kind: "contract",
      revision: source.revision,
      path: source.path,
      startLine: source.line,
      startColumn: source.column,
      endLine: source.endLine,
      endColumn: source.endColumn,
      summary: `TypeScript derived ${contract.kind} for ${contract.name}.`,
    });
    const irContract = createIrContract(irContext, {
      revision: source.revision,
      path: source.path,
      startLine: source.line,
      startColumn: source.column,
      endLine: source.endLine,
      endColumn: source.endColumn,
      subjectId: subject.id,
      kind: contract.kind === "variable_type" ? "other" : contract.kind,
      name: contract.name,
      fingerprint: contract.fingerprint,
      evidenceIds: [evidence.id],
    });
    accumulator.evidence.push(evidence);
    accumulator.contracts.push(irContract);
  }

  for (const packageExport of analysis.packageExports) {
    const file = files.get(
      fileKey(packageExport.revision, packageExport.manifestPath),
    );
    if (!file) continue;
    const conditions =
      packageExport.conditions.length === 0
        ? "default"
        : packageExport.conditions.join(",");
    const name = `${packageExport.packageName ?? packageExport.packageId}#${packageExport.subpath}[${conditions}]`;
    const evidence = createEvidence(evidenceContext, {
      kind: "contract",
      revision: packageExport.revision,
      path: packageExport.manifestPath,
      summary: `Package export ${name} targets ${packageExport.target ?? "blocked"}.`,
    });
    const irContract = createIrContract(irContext, {
      revision: packageExport.revision,
      path: packageExport.manifestPath,
      subjectId: file.id,
      kind: "package_export",
      name,
      fingerprint: stableId("typescript-package-export-signature", {
        subpath: packageExport.subpath,
        conditions: packageExport.conditions,
        target: packageExport.target,
      }),
      evidenceIds: [evidence.id],
    });
    accumulator.evidence.push(evidence);
    accumulator.contracts.push(irContract);
  }

  const addRelationship = (
    kind: IrRelationship["kind"],
    fromId: string,
    toId: string,
    evidence: Evidence,
  ): void => {
    accumulator.evidence.push(evidence);
    accumulator.relationships.push(
      createIrRelationship(irContext, {
        revision: analysis.revision,
        kind,
        fromId,
        toId,
        authority: "authoritative",
        evidenceIds: [evidence.id],
      }),
    );
  };

  for (const reference of analysis.moduleReferences) {
    if (
      reference.resolution !== "resolved_internal" ||
      !reference.resolvedPath
    ) {
      continue;
    }
    const from = files.get(fileKey(reference.revision, reference.fromPath));
    const to = files.get(fileKey(reference.revision, reference.resolvedPath));
    if (!from || !to) continue;
    const evidence = createEvidence(evidenceContext, {
      kind: "import",
      revision: reference.revision,
      path: reference.fromPath,
      startLine: reference.line,
      startColumn: reference.column,
      summary: `${reference.kind} ${reference.specifier ?? "expression"} resolves to ${reference.resolvedPath}.`,
    });
    addRelationship(
      reference.kind === "export" ? "re_exports" : "imports",
      from.id,
      to.id,
      evidence,
    );
  }

  for (const binding of analysis.importBindings) {
    if (!binding.targetSymbolId) continue;
    const from = files.get(fileKey(binding.revision, binding.sourcePath));
    const to = irSymbols.get(binding.targetSymbolId);
    if (!from || !to) continue;
    const evidence = createEvidence(evidenceContext, {
      kind: "import",
      revision: binding.revision,
      path: binding.sourcePath,
      startLine: binding.line,
      startColumn: binding.column,
      summary: `Import ${binding.localName} resolves to ${to.name}.`,
    });
    addRelationship("imports", from.id, to.id, evidence);
  }

  for (const exported of analysis.exports) {
    const from = files.get(fileKey(exported.revision, exported.sourcePath));
    if (!from) continue;
    const evidence = createEvidence(evidenceContext, {
      kind: "import",
      revision: exported.revision,
      path: exported.sourcePath,
      summary: exported.targetSymbolId
        ? `Export ${exported.exportName} resolves to ${exported.targetName}.`
        : `Export ${exported.exportName} has an unresolved target ${exported.targetName}.`,
    });
    if (!exported.targetSymbolId) {
      accumulator.evidence.push(evidence);
      continue;
    }
    const to = irSymbols.get(exported.targetSymbolId);
    if (!to) continue;
    addRelationship(
      exported.kind === "re_export" ? "re_exports" : "exports",
      from.id,
      to.id,
      evidence,
    );
  }

  for (const relationship of analysis.relationships) {
    const from = relationship.fromSymbolId
      ? irSymbols.get(relationship.fromSymbolId)
      : files.get(fileKey(relationship.revision, relationship.fromPath));
    const to = irSymbols.get(relationship.toSymbolId);
    if (!from || !to) continue;
    const evidence = createEvidence(evidenceContext, {
      kind: relationship.kind === "call" ? "call" : "type",
      revision: relationship.revision,
      path: relationship.fromPath,
      startLine: relationship.line,
      startColumn: relationship.column,
      endLine: relationship.endLine,
      endColumn: relationship.endColumn,
      summary: `${relationship.kind} resolves to ${relationship.toName}.`,
    });
    addRelationship(
      relationship.kind === "call" ? "calls" : "references",
      from.id,
      to.id,
      evidence,
    );
  }

  const configByProject = new Map(
    analysis.projects.map((project) => [project.projectId, project.configPath]),
  );
  for (const gap of analysis.gaps) {
    const gapPath =
      gap.path ??
      (gap.projectId ? configByProject.get(gap.projectId) : undefined) ??
      "bytesmith-analyzer";
    const evidence = createEvidence(evidenceContext, {
      kind: gapEvidenceKind(gap.type),
      revision: gap.revision,
      path: gapPath,
      ...(gap.line ? { startLine: gap.line } : {}),
      ...(gap.column ? { startColumn: gap.column } : {}),
      summary: gap.summary,
    });
    const irGap = createIrGap(irContext, {
      revision: gap.revision,
      type: irGapType(gap.type),
      summary: gap.summary,
      locations: [
        {
          revision: gap.revision,
          path: gapPath,
          ...(gap.line ? { startLine: gap.line } : {}),
          ...(gap.column ? { startColumn: gap.column } : {}),
        },
      ],
      evidenceIds: [evidence.id],
      blockingRelevance: gap.blockingRelevance,
    });
    accumulator.evidence.push(evidence);
    accumulator.gaps.push(irGap);
  }
}

export function projectTypeScriptComparisonToIr(
  context: ProjectionContext,
  base: TypeScriptCompilerAnalysis,
  head: TypeScriptCompilerAnalysis,
): CanonicalIr {
  const accumulator: IrAccumulator = {
    evidence: [],
    files: [],
    symbols: [],
    contracts: [],
    relationships: [],
    gaps: [],
  };
  projectRevision(context, base, accumulator);
  projectRevision(context, head, accumulator);
  return createCanonicalIr(
    {
      repositoryId: context.repositoryId,
      baseRevision: context.baseRevision,
      headRevision: context.headRevision,
    },
    {
      evidence: uniqueById(accumulator.evidence),
      files: uniqueById(accumulator.files),
      symbols: uniqueById(accumulator.symbols),
      contracts: uniqueById(accumulator.contracts),
      relationships: uniqueById(accumulator.relationships),
      tests: [],
      gaps: uniqueById(accumulator.gaps),
    },
  );
}

export function createContainedTypeScriptIr(
  context: ProjectionContext,
  failureKind: AnalyzerFailureKind,
  summary: string,
): CanonicalIr {
  const irContext = {
    repositoryId: context.repositoryId,
    baseRevision: context.baseRevision,
    headRevision: context.headRevision,
  };
  const evidence = createEvidence(
    {
      ...irContext,
      producer: {
        id: "bytesmith.typescript",
        version: context.analyzerVersion,
      },
    },
    {
      kind: failureKind === "limit_exceeded" ? "configuration" : "runtime",
      revision: context.headRevision,
      path: "bytesmith-analyzer",
      summary,
    },
  );
  const gap = createIrGap(irContext, {
    revision: context.headRevision,
    type: "analyzer_gap",
    summary,
    locations: [
      {
        revision: context.headRevision,
        path: "bytesmith-analyzer",
      },
    ],
    evidenceIds: [evidence.id],
    blockingRelevance: "required",
  });
  return createCanonicalIr(irContext, {
    evidence: [evidence],
    files: [],
    symbols: [],
    contracts: [],
    relationships: [],
    tests: [],
    gaps: [gap],
  });
}

export function createTypeScriptManifestProjection(
  ir: CanonicalIr,
  analyzerVersion: string,
  status: "completed" | "incomplete" | "error",
  durationMs: number,
  diagnostics: readonly string[],
): TypeScriptManifestProjection {
  return {
    analyzer: {
      id: "bytesmith.typescript",
      version: analyzerVersion,
      required: true,
      status,
      durationMs,
      diagnostics: [...diagnostics],
    },
    evidence: structuredClone(ir.evidence),
    unknowns: ir.gaps.map((gap) => ({
      id: gap.id,
      type: gap.type,
      summary: gap.summary,
      locations: structuredClone(gap.locations),
      evidenceIds: [...gap.evidenceIds],
      blockingRelevance: gap.blockingRelevance,
    })),
  };
}
