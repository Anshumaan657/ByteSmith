import type { RevisionBinding } from "@bytesmith/evidence";
import type {
  Digest,
  ManifestChange,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import type {
  ComponentRef,
  Evidence,
  SourceLocation,
} from "@bytesmith/impact-types";
import type { CanonicalIr } from "@bytesmith/ir";

export type ContractRuleFamily = "shared" | "typescript" | "openapi";
export type EvidenceRevisionRequirement = "base" | "head";
export type ContractRuleExecutionStatus = "completed" | "incomplete" | "error";
export type ContractComparisonStatus =
  "matched" | "added" | "removed" | "ambiguous";

export interface ContractArtifact<Value> {
  id: string;
  revision: string;
  logicalKey: string;
  value: Value;
  evidenceIds: readonly string[];
}

export interface ContractComparison<Value> {
  id: string;
  logicalKey: string;
  status: ContractComparisonStatus;
  base: ContractArtifact<Value>[];
  head: ContractArtifact<Value>[];
  evidenceIds: string[];
}

export interface CreateContractComparisonsInput<Value> {
  ir: CanonicalIr;
  artifacts: readonly ContractArtifact<Value>[];
}

export interface ContractRuleMetadata {
  id: string;
  version: string;
  family: ContractRuleFamily;
  description: string;
  required: boolean;
  defaultMode: "advisory";
  blockingEligible: false;
}

export interface ContractRuleFindingInput {
  kind: ManifestChange["kind"];
  summary: string;
  compatibility: ManifestChange["compatibility"];
  component: ComponentRef;
  evidenceIds: readonly string[];
  evidenceRequirements: readonly EvidenceRevisionRequirement[];
}

export interface ContractRuleUnknownInput {
  type: ManifestUnknown["type"];
  summary: string;
  locations: readonly SourceLocation[];
  evidenceIds: readonly string[];
  blockingRelevance: ManifestUnknown["blockingRelevance"];
}

export interface ContractRuleEvaluation {
  findings?: readonly ContractRuleFindingInput[];
  unknowns?: readonly ContractRuleUnknownInput[];
  diagnostics?: readonly string[];
}

export interface ContractRuleEvaluationContext<State> {
  binding: RevisionBinding;
  ir: Readonly<CanonicalIr>;
  state: Readonly<State>;
  rule: Readonly<ContractRuleMetadata>;
}

export interface ContractRuleDefinition<State> extends ContractRuleMetadata {
  evaluate(
    context: ContractRuleEvaluationContext<State>,
  ): ContractRuleEvaluation | Promise<ContractRuleEvaluation>;
}

export interface ContractRuleFinding {
  id: string;
  ruleId: string;
  ruleVersion: string;
  family: ContractRuleFamily;
  description: string;
  required: boolean;
  defaultMode: "advisory";
  blockingEligible: false;
  change: ManifestChange;
  evidenceRequirements: EvidenceRevisionRequirement[];
}

export interface ContractRuleExecution {
  ruleId: string;
  ruleVersion: string;
  family: ContractRuleFamily;
  required: boolean;
  status: ContractRuleExecutionStatus;
  changeIds: string[];
  unknownIds: string[];
  diagnostics: string[];
}

export interface ContractRuleExecutionInput<State> {
  ir: CanonicalIr;
  state: State;
}

export interface ContractRuleExecutionResult {
  schemaVersion: "1.0.0";
  binding: RevisionBinding;
  ruleSetId: string;
  status: ContractRuleExecutionStatus;
  executions: ContractRuleExecution[];
  findings: ContractRuleFinding[];
  changes: ManifestChange[];
  unknowns: ManifestUnknown[];
  generatedEvidence: Evidence[];
  semanticDigest: Digest;
}
