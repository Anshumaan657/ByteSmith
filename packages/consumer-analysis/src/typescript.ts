import { stableId } from "@bytesmith/canonicalization";
import type {
  CrossRevisionSymbolAnalysis,
  RepositoryProjectDiscovery,
  TypeScriptCompilerAnalysis,
  TypeScriptSymbol,
} from "@bytesmith/contracts-typescript";
import type {
  ManifestChange,
  ManifestImpact,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import {
  compareCodePoints,
  type ComponentRef,
  type SourceLocation,
} from "@bytesmith/impact-types";
import type {
  CanonicalIr,
  IrFile,
  IrRelationship,
  IrSymbol,
} from "@bytesmith/ir";
import { ConsumerAnalysisError } from "./errors.js";
import {
  consumerAnalyzerVersion,
  createConsumerImpact,
  finalizeConsumerResult,
  normalizeConsumerLimits,
  relevantChanges,
  validateConsumerIr,
} from "./pipeline.js";
import type {
  ConsumerAnalysisResult,
  ConsumerPath,
  ConsumerPathEdge,
  TypeScriptConsumerAnalysisInput,
} from "./types.js";

interface SymbolMaps {
  typescriptByIr: Map<string, TypeScriptSymbol>;
  irByTypeScript: Map<string, IrSymbol>;
  equivalentIr: Map<string, string>;
}

interface TraversalState {
  nodeId: string;
  edges: IrRelationship[];
  visited: Set<string>;
}

function validateBindings(
  ir: CanonicalIr,
  base: TypeScriptCompilerAnalysis,
  head: TypeScriptCompilerAnalysis,
  matches: CrossRevisionSymbolAnalysis,
): void {
  if (
    base.repositoryId !== ir.repositoryId ||
    head.repositoryId !== ir.repositoryId ||
    matches.repositoryId !== ir.repositoryId ||
    base.revision !== ir.baseRevision ||
    head.revision !== ir.headRevision ||
    matches.baseRevision !== ir.baseRevision ||
    matches.headRevision !== ir.headRevision
  ) {
    throw new ConsumerAnalysisError(
      "binding_mismatch",
      "TypeScript consumer inputs belong to a different exact comparison.",
    );
  }
}

function findIrSymbol(
  ir: CanonicalIr,
  symbol: TypeScriptSymbol,
): IrSymbol | undefined {
  const candidates = ir.symbols.filter(
    (candidate) =>
      candidate.revision === symbol.revision &&
      candidate.location.path === symbol.path &&
      candidate.kind === symbol.kind &&
      candidate.name === symbol.qualifiedName,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function createSymbolMaps(
  ir: CanonicalIr,
  base: TypeScriptCompilerAnalysis,
  head: TypeScriptCompilerAnalysis,
  matches: CrossRevisionSymbolAnalysis,
): SymbolMaps {
  const typescriptByIr = new Map<string, TypeScriptSymbol>();
  const irByTypeScript = new Map<string, IrSymbol>();
  for (const symbol of [...base.symbols, ...head.symbols]) {
    const projected = findIrSymbol(ir, symbol);
    if (!projected) continue;
    typescriptByIr.set(projected.id, symbol);
    irByTypeScript.set(symbol.id, projected);
  }
  const equivalentIr = new Map<string, string>();
  for (const match of matches.matches) {
    const baseIr = irByTypeScript.get(match.baseSymbolId);
    const headIr = irByTypeScript.get(match.headSymbolId);
    if (!baseIr || !headIr) continue;
    equivalentIr.set(baseIr.id, headIr.id);
    equivalentIr.set(headIr.id, baseIr.id);
  }
  return { typescriptByIr, irByTypeScript, equivalentIr };
}

function nodeLocation(
  node: IrSymbol | IrFile | undefined,
): SourceLocation | undefined {
  return node ? structuredClone(node.location) : undefined;
}

function preferredNode(
  ir: CanonicalIr,
  nodeId: string,
  maps: SymbolMaps,
): IrSymbol | IrFile | undefined {
  const symbols = new Map(ir.symbols.map((symbol) => [symbol.id, symbol]));
  const files = new Map(ir.files.map((file) => [file.id, file]));
  const node = symbols.get(nodeId) ?? files.get(nodeId);
  if (node?.revision === ir.headRevision) return node;
  const equivalent = maps.equivalentIr.get(nodeId);
  return (equivalent ? symbols.get(equivalent) : undefined) ?? node;
}

function componentForNode(
  ir: CanonicalIr,
  nodeId: string,
  maps: SymbolMaps,
): ComponentRef | undefined {
  const node = preferredNode(ir, nodeId, maps);
  if (!node) return undefined;
  return {
    id: node.id,
    kind: "name" in node ? "symbol" : "file",
    name: "name" in node ? node.name : node.location.path,
    location: structuredClone(node.location),
  };
}

function targetIdsForChange(
  ir: CanonicalIr,
  change: ManifestChange,
  maps: SymbolMaps,
): Set<string> {
  const targets = new Set<string>();
  const symbol = ir.symbols.find(
    (candidate) => candidate.id === change.component.id,
  );
  const contract = ir.contracts.find(
    (candidate) => candidate.id === change.component.id,
  );
  if (symbol) targets.add(symbol.id);
  if (contract) targets.add(contract.subjectId);
  if (!symbol && !contract && change.component.location) {
    for (const candidate of ir.symbols) {
      if (
        candidate.location.path === change.component.location.path &&
        (candidate.name === change.component.name ||
          candidate.name.endsWith(`.${change.component.name}`))
      ) {
        targets.add(candidate.id);
      }
    }
  }
  for (const target of [...targets]) {
    const equivalent = maps.equivalentIr.get(target);
    if (equivalent) targets.add(equivalent);
  }
  return targets;
}

function edgeValue(relationship: IrRelationship): ConsumerPathEdge {
  return {
    relationshipId: relationship.id,
    fromId: relationship.fromId,
    toId: relationship.toId,
    evidenceIds: [...relationship.evidenceIds],
  };
}

function pathRecord(
  change: ManifestChange,
  componentId: string,
  depth: number,
  edges: readonly IrRelationship[],
  category: ConsumerPath["category"],
): ConsumerPath {
  const normalizedEdges = edges.map(edgeValue);
  const evidenceIds = [
    ...new Set(edges.flatMap((edge) => edge.evidenceIds)),
  ].sort(compareCodePoints);
  const record = {
    sourceChangeId: change.id,
    category,
    affectedComponentId: componentId,
    depth,
    edges: normalizedEdges,
    evidenceIds,
  };
  return { id: stableId("consumer-path", record), ...record };
}

function incomingRelationships(
  ir: CanonicalIr,
  revision: string,
): Map<string, IrRelationship[]> {
  const byTarget = new Map<string, IrRelationship[]>();
  for (const relationship of ir.relationships) {
    if (
      relationship.revision !== revision ||
      relationship.authority !== "authoritative" ||
      !new Set(["calls", "references", "imports"]).has(relationship.kind)
    ) {
      continue;
    }
    const values = byTarget.get(relationship.toId) ?? [];
    values.push(relationship);
    byTarget.set(relationship.toId, values);
  }
  for (const values of byTarget.values()) {
    values.sort((left, right) =>
      compareCodePoints(
        `${left.kind}:${left.fromId}:${left.id}`,
        `${right.kind}:${right.fromId}:${right.id}`,
      ),
    );
  }
  return byTarget;
}

function semanticIncoming(
  incoming: ReadonlyMap<string, IrRelationship[]>,
  nodeId: string,
): IrRelationship[] {
  const values = incoming.get(nodeId) ?? [];
  const semantic = values.filter(
    (relationship) =>
      relationship.kind === "calls" || relationship.kind === "references",
  );
  return semantic.length > 0
    ? semantic
    : values.filter((relationship) => relationship.kind === "imports");
}

function truncationUnknown(
  ir: CanonicalIr,
  change: ManifestChange,
  relationship: IrRelationship,
  reason: string,
): ManifestUnknown {
  const nodes = new Map<string, IrSymbol | IrFile>([
    ...ir.files.map((file) => [file.id, file] as const),
    ...ir.symbols.map((symbol) => [symbol.id, symbol] as const),
  ]);
  const location = nodeLocation(nodes.get(relationship.fromId));
  const evidenceIds = [...relationship.evidenceIds].sort(compareCodePoints);
  const summary = `${reason} while tracing consumers of ${change.component.name}.`;
  const record = {
    type: "analyzer_gap" as const,
    summary,
    locations: location ? [location] : [],
    evidenceIds,
    blockingRelevance: "possible" as const,
  };
  return { id: stableId("consumer-unknown", record), ...record };
}

function graphGaps(
  ir: CanonicalIr,
  reachedPaths: ReadonlySet<string>,
): ManifestUnknown[] {
  return ir.gaps
    .filter(
      (gap) =>
        (gap.type === "dynamic_import" || gap.type === "unresolved_symbol") &&
        gap.locations.some((location) => reachedPaths.has(location.path)),
    )
    .map((gap) => ({
      id: gap.id,
      type: gap.type,
      summary: gap.summary,
      locations: structuredClone(gap.locations),
      evidenceIds: [...gap.evidenceIds],
      blockingRelevance: gap.blockingRelevance,
    }));
}

function packageForProject(
  discovery: RepositoryProjectDiscovery,
  projectId: string,
) {
  const project = discovery.projects.find(
    (candidate) => candidate.id === projectId,
  );
  if (!project?.packageId) return undefined;
  return discovery.workspace.packages.find(
    (candidate) => candidate.id === project.packageId,
  );
}

function workspaceImpact(
  ir: CanonicalIr,
  discovery: RepositoryProjectDiscovery,
  maps: SymbolMaps,
  change: ManifestChange,
  path: ConsumerPath,
): ManifestImpact | undefined {
  const first = path.edges[0];
  const last = path.edges[path.edges.length - 1];
  if (!first || !last) return undefined;
  const sourceSymbol = maps.typescriptByIr.get(first.fromId);
  const targetSymbol = maps.typescriptByIr.get(last.toId);
  if (
    !sourceSymbol ||
    !targetSymbol ||
    sourceSymbol.projectId === targetSymbol.projectId
  ) {
    return undefined;
  }
  const sourcePackage = packageForProject(discovery, sourceSymbol.projectId);
  const targetPackage = packageForProject(discovery, targetSymbol.projectId);
  if (
    !sourcePackage ||
    !targetPackage ||
    sourcePackage.id === targetPackage.id
  ) {
    return undefined;
  }
  const component: ComponentRef = {
    id: sourcePackage.id,
    kind: "package",
    name: sourcePackage.name ?? sourcePackage.directory,
    location: {
      repository: ir.repositoryId,
      revision: ir.headRevision,
      path: sourcePackage.manifestPath,
    },
  };
  return createConsumerImpact({
    ruleId: "typescript.workspace-dependent",
    category: "contract",
    change,
    component,
    evidenceIds: path.evidenceIds,
    depth: path.depth,
  });
}

export function analyzeTypeScriptConsumers(
  input: TypeScriptConsumerAnalysisInput,
): ConsumerAnalysisResult {
  validateConsumerIr(input.ir);
  validateBindings(
    input.ir,
    input.baseAnalysis,
    input.headAnalysis,
    input.symbolAnalysis,
  );
  const limits = normalizeConsumerLimits(input.limits);
  const analyzerVersion = consumerAnalyzerVersion(input.analyzerVersion);
  const changes = relevantChanges(input.changes);
  const maps = createSymbolMaps(
    input.ir,
    input.baseAnalysis,
    input.headAnalysis,
    input.symbolAnalysis,
  );
  const nodes = new Map<string, IrSymbol | IrFile>([
    ...input.ir.files.map((file) => [file.id, file] as const),
    ...input.ir.symbols.map((symbol) => [symbol.id, symbol] as const),
  ]);
  const incomingByRevision = new Map([
    [
      input.ir.baseRevision,
      incomingRelationships(input.ir, input.ir.baseRevision),
    ],
    [
      input.ir.headRevision,
      incomingRelationships(input.ir, input.ir.headRevision),
    ],
  ]);
  const paths: ConsumerPath[] = [];
  const impacts: ManifestImpact[] = [];
  const unknowns: ManifestUnknown[] = [];
  const reachedPaths = new Set<string>();
  let inspectedEdges = 0;
  let consumerCount = 0;

  for (const change of changes) {
    const targets = targetIdsForChange(input.ir, change, maps);
    const headTargets = [...targets].filter(
      (id) => nodes.get(id)?.revision === input.ir.headRevision,
    );
    const selectedTargets =
      headTargets.length > 0
        ? headTargets
        : [...targets].filter(
            (id) => nodes.get(id)?.revision === input.ir.baseRevision,
          );
    const revision =
      headTargets.length > 0 ? input.ir.headRevision : input.ir.baseRevision;
    const incoming = incomingByRevision.get(revision)!;
    const queue: TraversalState[] = selectedTargets
      .sort(compareCodePoints)
      .map((nodeId) => ({ nodeId, edges: [], visited: new Set([nodeId]) }));
    const seenConsumers = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const nextRelationships = semanticIncoming(incoming, current.nodeId);
      for (const relationship of nextRelationships) {
        inspectedEdges += 1;
        if (inspectedEdges > limits.maxEdges) {
          unknowns.push(
            truncationUnknown(
              input.ir,
              change,
              relationship,
              `Consumer traversal reached the ${limits.maxEdges}-edge limit`,
            ),
          );
          queue.length = 0;
          break;
        }
        if (current.visited.has(relationship.fromId)) continue;
        const edges = [relationship, ...current.edges];
        const depth = edges.length;
        if (depth > limits.maxDepth) {
          unknowns.push(
            truncationUnknown(
              input.ir,
              change,
              relationship,
              `Consumer traversal reached the ${limits.maxDepth}-depth limit`,
            ),
          );
          continue;
        }
        const component = componentForNode(input.ir, relationship.fromId, maps);
        if (!component) continue;
        const category = depth === 1 ? "direct" : "transitive";
        const logicalConsumer =
          maps.equivalentIr.get(component.id) ?? component.id;
        const isNewConsumer = !seenConsumers.has(logicalConsumer);
        if (isNewConsumer) {
          consumerCount += 1;
          if (consumerCount > limits.maxConsumers) {
            unknowns.push(
              truncationUnknown(
                input.ir,
                change,
                relationship,
                `Consumer traversal reached the ${limits.maxConsumers}-consumer limit`,
              ),
            );
            queue.length = 0;
            break;
          }
          seenConsumers.add(logicalConsumer);
          const consumerPath = pathRecord(
            change,
            component.id,
            depth,
            edges,
            category,
          );
          paths.push(consumerPath);
          if (component.location) reachedPaths.add(component.location.path);
        }
        if (!isNewConsumer) continue;
        const continuations =
          relationship.kind === "imports"
            ? []
            : semanticIncoming(incoming, relationship.fromId).filter(
                (candidate) =>
                  candidate.kind !== "imports" &&
                  !current.visited.has(candidate.fromId) &&
                  candidate.fromId !== relationship.fromId,
              );
        if (continuations.length === 0) {
          const terminalPath = paths.find(
            (path) =>
              path.sourceChangeId === change.id &&
              path.affectedComponentId === component.id,
          );
          if (terminalPath) {
            impacts.push(
              createConsumerImpact({
                ruleId:
                  depth === 1
                    ? "typescript.direct-consumer"
                    : "typescript.transitive-consumer",
                category,
                change,
                component,
                evidenceIds: terminalPath.evidenceIds,
                depth,
              }),
            );
            if (input.headDiscovery) {
              const packageImpact = workspaceImpact(
                input.ir,
                input.headDiscovery,
                maps,
                change,
                terminalPath,
              );
              if (packageImpact) impacts.push(packageImpact);
            }
          }
        }
        if (relationship.kind !== "imports" && continuations.length > 0) {
          queue.push({
            nodeId: relationship.fromId,
            edges,
            visited: new Set([...current.visited, relationship.fromId]),
          });
        }
      }
    }
  }

  unknowns.push(...graphGaps(input.ir, reachedPaths));
  return finalizeConsumerResult({
    ir: input.ir,
    analyzerVersion,
    family: "typescript",
    paths,
    impacts,
    unknowns,
    generatedEvidence: [],
  });
}
