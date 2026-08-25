import { createEvidence } from "@bytesmith/evidence";
import { createCanonicalIr, createIrGap, createIrTest } from "@bytesmith/ir";
import type { CanonicalIr, IrGap, IrTest } from "@bytesmith/ir";
import type { Evidence } from "@bytesmith/impact-types";
import { TestDiscoveryError } from "./errors.js";
import type { TestRevisionDiscovery } from "./types.js";

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

export function createTestDiscoveryCanonicalIr(input: {
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  analyzerVersion: string;
  baseDiscovery: TestRevisionDiscovery;
  headDiscovery: TestRevisionDiscovery;
}): CanonicalIr {
  const context = {
    repositoryId: input.repositoryId,
    baseRevision: input.baseRevision,
    headRevision: input.headRevision,
  };
  const evidence: Evidence[] = [];
  const tests: IrTest[] = [];
  const gaps: IrGap[] = [];
  for (const discovery of [input.baseDiscovery, input.headDiscovery]) {
    if (
      discovery.repositoryId !== input.repositoryId ||
      ![input.baseRevision, input.headRevision].includes(discovery.revision)
    ) {
      throw new TestDiscoveryError(
        "snapshot_binding_invalid",
        "Test discovery is not bound to the requested exact comparison.",
      );
    }
    const evidenceContext = {
      ...context,
      producer: {
        id: "bytesmith.test-intelligence",
        version: input.analyzerVersion,
      },
    };
    for (const testCase of discovery.testCases) {
      const record = createEvidence(evidenceContext, {
        kind: "syntax",
        revision: discovery.revision,
        path: testCase.path,
        startLine: testCase.line,
        startColumn: testCase.column,
        summary: `Discovered ${testCase.framework} test ${testCase.name}.`,
      });
      evidence.push(record);
      tests.push(
        createIrTest(context, {
          revision: discovery.revision,
          path: testCase.path,
          startLine: testCase.line,
          startColumn: testCase.column,
          framework: testCase.framework,
          name: testCase.name,
          evidenceIds: [record.id],
        }),
      );
    }
    for (const diagnostic of discovery.diagnostics) {
      const record = createEvidence(evidenceContext, {
        kind: "configuration",
        revision: discovery.revision,
        path: diagnostic.path,
        ...(diagnostic.line === undefined
          ? {}
          : { startLine: diagnostic.line }),
        ...(diagnostic.column === undefined
          ? {}
          : { startColumn: diagnostic.column }),
        summary: diagnostic.summary,
      });
      evidence.push(record);
      gaps.push(
        createIrGap(context, {
          revision: discovery.revision,
          type: "analyzer_gap",
          summary: diagnostic.summary,
          locations: [
            {
              revision: discovery.revision,
              path: diagnostic.path,
              ...(diagnostic.line === undefined
                ? {}
                : { startLine: diagnostic.line }),
              ...(diagnostic.column === undefined
                ? {}
                : { startColumn: diagnostic.column }),
            },
          ],
          evidenceIds: [record.id],
          blockingRelevance: "possible",
        }),
      );
    }
  }
  return createCanonicalIr(context, {
    evidence: uniqueById(evidence),
    files: [],
    symbols: [],
    contracts: [],
    relationships: [],
    tests: uniqueById(tests),
    gaps: uniqueById(gaps),
  });
}
